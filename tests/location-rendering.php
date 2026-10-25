<?php
/** Run with PHP and a Zabbix ui directory. No database or login session required. */
$modules = $argv[1] ?? dirname(__DIR__, 2);
$ui = $argv[2] ?? '/usr/share/zabbix';
require $ui.'/include/classes/core/CAutoloader.php';
$loader = new CAutoloader();
$paths = [];
foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($ui.'/include/classes', FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::SELF_FIRST) as $entry) {
	if ($entry->isDir()) { $paths[] = $entry->getPathname(); }
}
$loader->addNamespace('', $paths);
$loader->register();

foreach (['VMwareMonitoring' => ['zabbix-module-wmvare-monitoring', 'vmware-monitoring', 'vmware-location'],
    'MonitorDocker' => ['zabbix-module-docker', 'docker', 'docker-location'],
    'NetAppMonitoring' => ['zabbix-module-netapp-monitoring', 'netapp-monitoring', 'location']] as $namespace => [$directory, $prefix, $data]) {
	require $modules.'/'.$directory.'/includes/common/LocationHierarchy.php';
	require $modules.'/'.$directory.'/includes/common/LocationRows.php';
	require $modules.'/'.$directory.'/includes/common/SearchControl.php';
	$hierarchy = 'Modules\\'.$namespace.'\\Includes\\Common\\LocationHierarchy';
	$rows = 'Modules\\'.$namespace.'\\Includes\\Common\\LocationRows';
	$search = 'Modules\\'.$namespace.'\\Includes\\Common\\SearchControl';
	$parent = $hierarchy::key(['CH']);
	$branches = $hierarchy::branches(['CH', '<script>']);
	$leaf = end($branches);
	$html = (string) $rows::header($leaf, '2 hosts', ['metric'], 2, [$parent => ['collapsed' => true]]);
	foreach (['class="'.$prefix.'-location-row', 'data-'.$data.'-ancestors', 'colspan="2"', 'hidden', '&lt;script&gt;'] as $expected) {
		if (strpos($html, $expected) === false) { throw new RuntimeException('Missing group markup: '.$expected); }
	}
	if (strpos($html, '<script>') !== false) { throw new RuntimeException('Unescaped location label'); }
	$input = (string) $search::input('Find "items"', '<script>', ['name' => 'search', 'id' => 'search-box']);
	foreach (['type="search"', 'autocomplete="off"', 'aria-label=', 'name="search"', 'id="search-box"', '&lt;script&gt;'] as $expected) {
		if (strpos($input, $expected) === false) { throw new RuntimeException('Missing search markup: '.$expected); }
	}
	if ($hierarchy::pathFromMacros([['macro' => '{$LOCATION}', 'value' => 'secret', 'type' => 1]], '{$LOCATION}') !== []) {
		throw new RuntimeException('Secret macro exposed');
	}
}
echo "Shared group rows, descendant visibility, search controls and escaped labels passed in all three namespaces.\n";
