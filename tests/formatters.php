<?php
/** Regression checks for all bundled adapters in one PHP process, without Zabbix. */
$root = $argv[1] ?? dirname(__DIR__, 2);
require $root.'/zabbix-module-wmvare-monitoring/includes/VMwareFormatter.php';
require $root.'/zabbix-module-docker/includes/DockerFormatter.php';
require $root.'/zabbix-module-netapp-monitoring/includes/NetAppFormatter.php';

use Modules\VMwareMonitoring\Includes\VMwareFormatter as VMware;
use Modules\MonitorDocker\Includes\DockerFormatter as Docker;
use Modules\NetAppMonitoring\Includes\NetAppFormatter as NetApp;

function same($actual, $expected): void {
	if ($actual !== $expected) {
		throw new RuntimeException(var_export($actual, true).' !== '.var_export($expected, true));
	}
}
same(VMware::bytes(null), '-');
same(VMware::bytes(''), '-');
same(VMware::bytes(-42), '0 B');
same(VMware::bytes(1024), '1.0 KB');
same(VMware::bytes(1024 * 1024, 2), '1.00 MB');
same(NetApp::bytes(1024), '1.0 KiB');
same(NetApp::bytes('invalid'), '-');
same(NetApp::bytes(0.5), '1 B');
same(NetApp::rate(1024), '1.0 KiB/s');
same(Docker::rate(null), '0 B/s');
same(Docker::rate(-1024), '0 B/s');
same(Docker::rate(1024), '1.0 KB/s');
same(Docker::rate(1024 ** 4), '1024.0 GB/s');
foreach ([0 => '0m', 59 => '0m', 60 => '1m', 3660 => '1h 1m', 90000 => '1d 1h'] as $seconds => $text) {
	same(VMware::duration($seconds), $text);
	same(NetApp::duration($seconds), $text);
}
same(VMware::duration(null), '-');
same(NetApp::duration('invalid'), '-');
foreach (['VMwareMonitoring', 'MonitorDocker', 'NetAppMonitoring'] as $namespace) {
	if (!class_exists('Modules\\'.$namespace.'\\Includes\\Common\\Formatting', false)) {
		throw new RuntimeException('Missing isolated namespace: '.$namespace);
	}
}
echo "Shared formatting adapters and simultaneous namespace loading passed.\n";
