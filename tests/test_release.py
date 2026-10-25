"""Exercise the real local release workflow against disposable Git remotes."""
import importlib.util
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

COMMON = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("release", COMMON / "tools/release.py")
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="zabbix-common-release-test-")
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name).resolve()
        self.source = self.base / "zabbix-module-common"
        self.source.mkdir()
        for name in ["common.json", ".gitignore", ".gitattributes"]:
            shutil.copy2(COMMON / name, self.source / name)
        for name in ["templates", "tools"]:
            shutil.copytree(COMMON / name, self.source / name)
        self.initialize(self.source)
        self.commit(self.source)
        self.module = self.base / "module"
        self.module.mkdir()
        self.initialize(self.module)
        (self.module / "Module.php").write_text("<?php\n", encoding="utf-8")
        (self.module / "README.md").write_text("Standalone fixture\n", encoding="utf-8")
        (self.module / ".gitignore").write_text("/dist/\n.env\n__pycache__/\n", encoding="utf-8")
        shutil.copy2(COMMON / ".gitattributes", self.module / ".gitattributes")
        config = {"source_directory": "zabbix-module-common", "tokens": {
            "CSS_PREFIX": "fixture", "BORDER": "fixture-border", "MUTED": "fixture-muted",
            "TEXT": "fixture-text", "STRONG": "fixture-strong"}}
        self.save("common.config.json", config)
        self.save("manifest.json", {"id": "fixture", "namespace": "Fixture", "version": "1.0.0",
                                    "assets": {"css": ["common.css"]}})
        self.commit(self.module)
        self.remote = self.base / "origin.git"
        self.git(self.base, "init", "--bare", str(self.remote))
        self.git(self.module, "remote", "add", "origin", str(self.remote))

    def git(self, root, *args):
        return subprocess.run(["git", *args], cwd=root, check=True, capture_output=True,
                              text=True, encoding="utf-8").stdout.strip()

    def initialize(self, root):
        self.git(root, "init", "-b", "main")
        self.git(root, "config", "user.name", "Release Test")
        self.git(root, "config", "user.email", "release@example.invalid")
        self.git(root, "config", "core.autocrlf", "false")
        self.git(root, "config", "commit.gpgsign", "false")
        self.git(root, "config", "tag.gpgsign", "false")

    def commit(self, root):
        self.git(root, "add", "--all")
        self.git(root, "commit", "-m", "Fixture")

    def save(self, name, value):
        (self.module / name).write_text(json.dumps(value) + "\n", encoding="utf-8")

    def command(self, *args, success=True, embedded=False):
        engine = self.module / "tools/release.py" if embedded else COMMON / "tools/release.py"
        result = subprocess.run([sys.executable, str(engine), "--module-root", str(self.module), *args],
                                capture_output=True, text=True, encoding="utf-8")
        if success:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0, result.stdout)
        return result

    def test_preview_is_standalone_and_does_not_commit_or_push(self):
        before = self.git(self.module, "rev-parse", "HEAD")
        for name in ["dev/secret.txt", "tests/check.py", ".env"]:
            path = self.module / name
            path.parent.mkdir(exist_ok=True)
            path.write_text("Excluded\n", encoding="utf-8")
        self.command("1.0.1", "--local-only")
        archive = self.module / "dist/fixture-1.0.1.zip"
        with zipfile.ZipFile(archive) as bundle:
            names = set(bundle.namelist())
            self.assertIn("fixture/includes/common/Formatting.php", names)
            self.assertIn("fixture/assets/css/common.css", names)
            self.assertFalse(any("/tools/" in name or "/dev/" in name or "/tests/" in name for name in names))
            self.assertNotIn("fixture/.env", names)
            self.assertEqual(json.loads(bundle.read("fixture/manifest.json"))["version"], "1.0.1")
            self.assertIn(b"Modules\\Fixture\\Includes\\Common", bundle.read("fixture/includes/common/Formatting.php"))
        self.assertEqual(before, self.git(self.module, "rev-parse", "HEAD"))
        self.assertEqual("", self.git(self.module, "tag"))
        self.assertEqual("", self.git(self.module, "ls-remote", "origin"))

    def test_publish_pushes_bundled_commit_and_tag_and_can_retry(self):
        self.command("1.0.1")
        head = self.git(self.module, "rev-parse", "HEAD")
        self.assertEqual(head, self.git(self.remote, "rev-parse", "refs/heads/main"))
        self.assertEqual(head, self.git(self.remote, "rev-parse", "refs/tags/v1.0.1^{}"))
        self.assertIn("includes/common/Formatting.php", self.git(self.remote, "ls-tree", "-r", "--name-only", "main"))
        self.assertNotIn("dist/", self.git(self.remote, "ls-tree", "-r", "--name-only", "main"))
        archive = (self.module / "dist/fixture-1.0.1.zip").read_bytes()
        self.command("1.0.1")
        self.assertEqual(head, self.git(self.module, "rev-parse", "HEAD"))
        self.assertEqual(archive, (self.module / "dist/fixture-1.0.1.zip").read_bytes())

    def test_module_can_publish_without_common_checkout(self):
        self.command("--sync-only")
        config = json.loads((self.module / "common.config.json").read_text())
        config["source_directory"] = "not-installed"
        self.save("common.config.json", config)
        self.command("1.0.1", embedded=True)
        self.assertEqual("", self.git(self.module, "status", "--porcelain"))

    def test_dirty_common_stops_before_module_changes(self):
        before = (self.module / "manifest.json").read_bytes()
        with (self.source / "templates/common.css.in").open("a") as stream:
            stream.write("\n/* New shared change */\n")
        result = self.command("1.0.1", success=False)
        self.assertIn("Commit changes in zabbix-module-common", result.stderr)
        self.assertEqual(before, (self.module / "manifest.json").read_bytes())
        self.assertFalse((self.module / "common.lock.json").exists())

    def test_changed_generated_file_is_rejected_when_using_bundle(self):
        self.command("--sync-only")
        (self.module / "assets/css/common.css").write_text("tampered", encoding="utf-8")
        result = self.command("1.0.1", "--local-only", "--bundled", success=False)
        self.assertIn("Generated file was changed", result.stderr)

    def test_new_common_change_is_imported_by_next_release(self):
        self.command("1.0.1")
        with (self.source / "templates/common.css.in").open("a") as stream:
            stream.write("\n.fixture-new { display: block; }\n")
        self.commit(self.source)
        self.command("1.0.2")
        self.assertIn("fixture-new", (self.module / "assets/css/common.css").read_text())
        lock = json.loads((self.module / "common.lock.json").read_text())
        self.assertEqual(self.git(self.source, "rev-parse", "HEAD"), lock["source_commit"])
        self.assertFalse(lock["source_dirty"])

    def test_conflicting_tag_is_rejected_without_changing_manifest(self):
        self.command("1.0.1")
        self.git(self.module, "tag", "v1.0.2")
        before = (self.module / "manifest.json").read_bytes()
        self.command("1.0.2", success=False)
        self.assertEqual(before, (self.module / "manifest.json").read_bytes())

    def test_atomic_push_does_not_publish_tag_when_branch_is_rejected(self):
        self.command("1.0.1")
        other = self.base / "other"
        self.git(self.base, "clone", str(self.remote), str(other))
        self.git(other, "config", "user.name", "Other")
        self.git(other, "config", "user.email", "other@example.invalid")
        self.git(other, "checkout", "main")
        (other / "README.md").write_text("Remote changed\n", encoding="utf-8")
        self.commit(other)
        self.git(other, "push", "origin", "main")
        result = self.command("1.0.2", success=False)
        self.assertIn("git push --atomic", result.stderr)
        self.assertEqual("", self.git(self.module, "ls-remote", "origin", "refs/tags/v1.0.2"))
        self.assertEqual("", self.git(self.module, "status", "--porcelain"))

    def test_required_asset_is_checked_before_version_update(self):
        manifest = json.loads((self.module / "manifest.json").read_text())
        manifest["assets"]["js"] = ["missing.js"]
        self.save("manifest.json", manifest)
        result = self.command("1.0.1", "--local-only", success=False)
        self.assertIn("Required module file is missing", result.stderr)
        self.assertEqual("1.0.0", json.loads((self.module / "manifest.json").read_text())["version"])

    def test_safe_path_rejects_traversal(self):
        with self.assertRaises(release.ReleaseError):
            release.safe_path(self.module, "../outside.txt")

    def test_local_preview_does_not_need_a_reachable_remote(self):
        self.git(self.module, "remote", "set-url", "origin", "https://127.0.0.1:9/not-used.git")
        self.command("1.0.1", "--local-only")

    def test_bundle_hashes_survive_a_windows_style_clone(self):
        self.command("1.0.1")
        clone = self.base / "windows-clone"
        self.git(self.base, "clone", "-b", "main", "--config", "core.autocrlf=true", str(self.remote), str(clone))
        result = subprocess.run([sys.executable, str(clone / "tools/release.py"), "1.0.1",
                                 "--bundled", "--local-only"], cwd=clone,
                                capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
