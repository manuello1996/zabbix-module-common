# Shared Zabbix module components

The source repository for reusable components used by VMware Monitoring, Docker
Monitoring and NetApp Monitoring. It is a developer dependency. Installed modules
contain their own generated copies and never load files from this repository.

Shared components include complete reusable renderers and their styles and
browser behavior. Collection, permissions, routes, state mapping and domain table
content remain in their respective modules. Module adapters preserve
different unit labels, missing-value policies, search delays and storage rules.

| Source | Responsibility | Current callers |
| --- | --- | --- |
| `templates/LocationHierarchy.php.in` | Macro parsing, stable keys, ancestors, tree sorting, pre-pagination aggregation and page headers | VMware and NetApp main inventories |
| `templates/LocationRows.php.in` | Group buttons, counts, indentation and descendant row visibility | VMware and NetApp main inventories |
| `templates/SearchControl.php.in` | Complete NetApp-standard search bar: label, native input, Clear button, hint and live status | VMware tabs, Docker containers/images/graphs, NetApp tabs |
| `templates/common.js.in` | Debounced input events, IME, clear/Escape/submit and nested collapse presentation | All three modules |
| `templates/Formatting.php.in` | Byte, duration and rate formatting | All three modules |
| `templates/Summary.php.in` | Summary strips/cards, values, units, live IDs and optional charts/bars | All three modules, including Docker tab summaries |
| `templates/Breadcrumbs.php.in` | Accessible breadcrumb navigation, separators and current page | All three detail views; VMware compatibility adapter |
| `templates/ProblemBadges.php.in` | Severity ordering, native badge metadata, scoped problem links and unavailable/empty states | All three modules; Docker asynchronous problem loader |
| `templates/CapacityBar.php.in` | Bounded progress bars, accessibility, warning/critical/stale presentation | VMware capacity, Docker memory, NetApp capacity |
| `templates/SortableHeader.php.in` | Native server sorting and accessible client controls | All three modules; VMware tabs and Docker containers/images |
| `templates/Sparkline.php.in` | History placeholders and metadata | VMware hypervisors and Docker containers/summaries |
| `templates/ItemActions.php.in` | Native Zabbix item-menu links with item IDs and return URLs | VMware and NetApp value adapters |
| `templates/Pager.php.in` | Native pagination, total-based pagination, AJAX navigation and client controls | All three modules |
| `templates/components.js.in` | Sparkline drawing, keyboard/direction sorting, client paging and live badges | VMware and Docker |
| `templates/components.css.in` | Complete shared component styles, light/dark themes and reduced motion | All three modules |

VMware keeps CProfile persistence, ordered save requests and pending-write replay.
NetApp keeps its per-user browser-tab collapse state and permission-aware problem
aggregation. Docker's main inventory retains its existing host-group filtering;
the extraction does not add location grouping where none existed. Search request
URLs, response validation, cache lifetimes and stale-response guards remain with
the caller. Paging markup and client slicing are shared; modules retain their
server queries, page preferences, filters and request state.

Use `Summary::card()` and `Summary::strip()` for summaries; values can be native
Zabbix links/tags. `Breadcrumbs::make()` supplies separators automatically.
`CapacityBar::render()` accepts thresholds, tone and stale status while callers
retain their measurement labels and source-item links. `ItemActions::link()`
receives a caller-built return URL so detail/tab/search context is preserved.
`SortableHeader::native()` delegates server headers to Zabbix; `render()` and
the shared JavaScript helper support client sorting without changing comparators.
`Pager` retains native `CPagerHelper` behavior and adds `forTotal()`, `ajax()` and
`controls()`. Its JavaScript helper bounds page numbers, slices filtered rows and
updates counts/buttons. VMware's percentage sparklines and Docker's automatic
scales, disabled states and history fetching remain configured by their adapters.

The manifest loads `common.css`, `components.css`, then the module themes, and
`common.js`, `components.js`, then module integration scripts. Module themes do
not redefine shared component selectors. Each module loads its own bundled
`includes/common/bootstrap.php`; no runtime sibling repository is required.

Use `SearchControl::bar($hint, $value, $input_attributes, $options)` for tab
searches. Its markup and styles are shared, including native square text inputs,
260px input width, card spacing, clear controls and light/dark theme colors.
Module-specific input styles are deliberately excluded from this component.
`input()` is only the low-level field factory, not the complete tab-search UI.
The shared event handler scopes each Clear button to its own bar, including tabs
with multiple search fields. Optional labels, status hooks and extra controls
preserve module-specific filtering without replacing the standard presentation.

## Local layout

Keep these Git repositories alongside each other:

```text
modules/
  zabbix-module-common/
  zabbix-module-wmvare-monitoring/
  zabbix-module-docker/
  zabbix-module-netapp-monitoring/
```

The VMware repository's existing spelling is intentional here.

Edit files in `templates/` to update shared runtime components. Edit
`tools/release.py` and `tools/release.ps1` to update the
release tooling. Each module's `common.config.json` supplies its prefixes and CSS
variables. Generated PHP classes live under that module's own namespace, and CSS
selectors keep its existing prefix, so installed modules can use different common
versions together.

## Preview a shared change

From any module directory, using Windows PowerShell:

```powershell
.\release.ps1 -SyncOnly
.\release.ps1 -Version 1.2.1 -LocalOnly
```

`-SyncOnly` refreshes the generated files without changing the module version or
Git history. `-LocalOnly` also updates the local manifest version and builds the
ZIP in `dist/`, without committing, tagging, pushing or contacting GitHub. Choose
a version appropriate to that module; `1.2.1` is only an example.

## Publish a module from your machine

Requirements: Git, Python 3.10 or newer, a configured Git author, and Git push
access to the module's existing `origin`. No PHP, npm, Composer or build tools are
required on the release machine. Zabbix still supplies PHP at runtime.

First commit shared changes in this repository. Increment `common.json`'s version
when releasing a new common-library version. The exact source commit and source
content hash are recorded independently in every module's `common.lock.json`.
Source text is normalized to LF before hashing and generation, preserving bundle
checksums across Windows and Linux clones.
The common repository can be pushed separately with normal Git commands; module
release scripts do not push other repositories.

Then, inside the module to publish:

```powershell
.\release.ps1 -Version 1.2.1
```

This command:

1. Imports the committed local common source, including the latest release tools.
2. Verifies the bundled files, routes and registered assets.
3. Updates the module manifest and creates `dist/<module-id>-1.2.1.zip`.
4. Commits **all nonignored changes in that module repository**.
5. Creates annotated tag `v1.2.1` and atomically pushes the current branch and tag
   to that module's `origin`.

Review your module changes before releasing. Nothing is force-pushed. A Git error
stops the command; the local commit, tag and ZIP are retained. After a temporary
network/authentication failure, the same command can retry an unchanged local
release. A branch divergence must be resolved with normal Git tools; if resolving
it changes the tagged commit, use a new version or deliberately recreate the local
unpublished tag.

For a GitHub Release with the ZIP attached, install GitHub CLI, authenticate with
`gh auth login`, then run:

```powershell
.\release.ps1 -Version 1.2.1 -GitHubRelease
```

The optional CLI/authentication check runs before the module is modified. Normal
branch/tag publishing does not need `gh`.

Python is an alternative entry point, including on Linux/macOS:

```text
python tools/release.py 1.2.1 --local-only
python tools/release.py 1.2.1
python tools/release.py --sync-only
```

Use `-CommonPath C:\path\to\zabbix-module-common` (Python: `--common-path`) for a
different local layout. If the sibling common repository is absent, the script
uses the verified, already-bundled version. `-UseBundled` (Python: `--bundled`)
explicitly selects it even when local common sources exist. Publishing refuses a
bundle produced from uncommitted common changes.

## Standalone distribution

Both the pushed module checkout and its ZIP contain all common runtime files.
There are no submodules, symlinks, external runtime fetches or shared Zabbix-module
dependencies. Each ZIP has one top-level directory named after the manifest ID;
extract it under Zabbix's `modules/`, scan the directory and enable the module.
Release tools, developer fixtures, Git metadata and local configuration are
excluded from deployment ZIPs. Module templates, Agent 2 configuration and images
are included when present and tracked or unignored in the module repository.

To put this new local common repository on GitHub, create an empty
`zabbix-module-common` repository in the intended account, add its URL as `origin`,
and push `main`. No remote repository is assumed or created by the module scripts.

## Verification

```text
python -m unittest discover -s tests -p "test_*.py" -v
php tests/formatters.php /path/to/modules
php tests/location-rendering.php /path/to/modules /path/to/zabbix/ui
php tests/components.php /path/to/modules /path/to/zabbix/ui
node tests/interactions.mjs
node tests/components.mjs
```

Release integration tests use temporary Git repositories and a local bare remote.
They exercise actual commits, tags and pushes without contacting GitHub.
The interaction suite loads the generated assets and the actual module adapters,
including Docker's lazy graph/image controls and VMware's tab search behavior.
It checks all three namespaces together. Node is needed only for this test suite,
not for publishing or installing a module.
