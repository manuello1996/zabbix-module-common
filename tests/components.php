<?php
/** Native Zabbix HTML contracts, simultaneous module namespaces, no database/session. */
$modules = $argv[1] ?? dirname(__DIR__, 2);
$ui = $argv[2] ?? '/usr/share/zabbix';
set_error_handler(static function ($severity, $message, $file, $line) {
	throw new ErrorException($message, 0, $severity, $file, $line);
});
if (!function_exists('_')) { function _($text) { return $text; } }
function _s($text, ...$args) { return sprintf($text, ...$args); }
function _x($text, $context) { return $text; }
function _n($one, $many, $count) { return $count === 1 ? $one : $many; }
function zbx_formatDomId($value) { return str_replace(['[', ']'], ['_', ''], $value); }
function zbx_cleanHashes(&$value) { if (is_array($value)) { $value = array_values($value); } return $value; }
function zbx_value2array(&$value) { if (!is_array($value)) { $value = [$value]; } }
function timeUnitToSeconds($value) { return 86400; }
class CSettingsHelper {
	public const SEVERITY_NAME_0 = 'Not classified', SEVERITY_NAME_1 = 'Information', SEVERITY_NAME_2 = 'Warning',
		SEVERITY_NAME_3 = 'Average', SEVERITY_NAME_4 = 'High', SEVERITY_NAME_5 = 'Disaster',
		HISTORY_PERIOD = 'history_period', SEARCH_LIMIT = 'search_limit';
	public static function get($name) { return match ($name) { 'history_period' => '1d', 'search_limit' => 10000, default => $name }; }
}
class CWebUser { public static $data = ['rows_per_page' => 10]; }
require $ui.'/include/defines.inc.php';
require $ui.'/include/classes/core/CAutoloader.php';
$loader = new CAutoloader();
$paths = [];
foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($ui.'/include/classes', FilesystemIterator::SKIP_DOTS),
		RecursiveIteratorIterator::SELF_FIRST) as $entry) {
	if ($entry->isDir()) { $paths[] = $entry->getPathname(); }
}
$loader->addNamespace('', $paths);
$loader->register();
preg_match('/function make_sorting_header\([\s\S]+?\n\}/', file_get_contents($ui.'/include/func.inc.php'), $native);
eval($native[0]);
$checks = 0;
function check(bool $value, string $message): void {
	global $checks;
	$checks++;
	if (!$value) { throw new RuntimeException($message); }
}
function xpath($content): DOMXPath {
	$document = new DOMDocument();
	$document->loadHTML('<!doctype html><html><body>'.$content.'</body></html>', LIBXML_NOERROR | LIBXML_NOWARNING);
	return new DOMXPath($document);
}
$css_standard = null;
foreach (['VMwareMonitoring' => ['zabbix-module-wmvare-monitoring', 'vmware-monitoring'],
	'MonitorDocker' => ['zabbix-module-docker', 'docker'],
	'NetAppMonitoring' => ['zabbix-module-netapp-monitoring', 'netapp-monitoring']] as $namespace => [$repo, $prefix]) {
	require_once $modules.'/'.$repo.'/includes/common/bootstrap.php';
	$class = static fn(string $name): string => 'Modules\\'.$namespace.'\\Includes\\Common\\'.$name;
	$summary = $class('Summary'); $breadcrumbs = $class('Breadcrumbs'); $badges = $class('ProblemBadges');
	$capacity = $class('CapacityBar'); $sorting = $class('SortableHeader'); $sparkline = $class('Sparkline');
	$items = $class('ItemActions'); $pager = $class('Pager');
	$details = $class('RowDetails');
	$refresh = $class('AutoRefresh');
	check($refresh::interval(0) === 60 && $refresh::interval(5) === 10 && $refresh::interval(120) === 120, 'Shared refresh interval policy');
	$refresh_id = $prefix.'-auto-refresh';
	$tree = xpath($refresh::control($refresh_id, 30));
	check($tree->query('//input[@id="'.$refresh_id.'" and @type="checkbox" and not(@checked)]')->length === 1, 'Auto-refresh is off by default');
	check($tree->query('//input[@data-refresh-interval="30" and @data-updated-at and @data-auto-refresh-enabled]')->length === 1, 'Refresh control supplies interval and translated labels');
	$tree = xpath($refresh::status($refresh_id.'-status'));
	check($tree->query('//*[@role="status" and @aria-live="polite"]')->length === 1, 'Refresh status is accessible');
	$detail_id = 'detail-'.strtolower($namespace);
	$detail_table = (new CTableInfo())->setHeader(['Metric', 'Latest value'])->addRow(['<metric>', new CLink('12', 'history.php?itemid=9')]);
	$toggle = $details::toggle('Metrics (1)', $detail_id, false, ['aria-label' => 'Metrics: <resource>']);
	$parent = new CRow([$details::name('<resource>', $toggle), 'online']);
	$child = $details::row($detail_id, 2, $details::grid([$details::group('IOPS', $detail_table)]));
	$html = (string) $details::table((new CTableInfo())->addRow($parent)->addRow($child));
	$tree = xpath($html);
	check($tree->query('//button[@type="button" and @aria-expanded="false" and @aria-controls="'.$detail_id.'"]')->length === 1, 'Explicit native expand control');
	check($tree->query('//tr[@id="'.$detail_id.'" and @hidden]/td[@colspan="2"]')->length === 1, 'Collapsed details span the complete table');
	check($tree->query('//*[@role="region" and @aria-labelledby="'.$detail_id.'-toggle"]')->length === 1, 'Detail region is labelled by its control');
	check($tree->query('//div[@class="'.$prefix.'-metric-group"]/h5[text()="IOPS"]')->length === 1, 'NetApp-standard group heading');
	check($tree->query('//div[@class="'.$prefix.'-metric-group"]/table//a[contains(@href,"itemid=9")]')->length === 1, 'Nested tables retain native metric links');
	check(str_contains($html, '&lt;resource&gt;') && str_contains($html, '&lt;metric&gt;'), 'Detail labels are escaped');
	check(!str_contains((string) $details::row($detail_id.'-open', 2, 'content', true), 'hidden'), 'Search can render an initially expanded detail row');
	$card = (string) $summary::strip([$summary::card('<VMs>', new CLink('12', 'zabbix.php?action=inventory'),
		['value_id' => 'live-count', 'unit' => '%', 'aside' => $capacity::render(42)])], ['id' => 'summary']);
	$tree = xpath($card);
	check($tree->query('//div[@id="summary"]//div[@id="live-count"]/a')->length === 1, 'Summary preserves live IDs and links');
	check(str_contains((string) $card, '&lt;VMs&gt;'), 'Summary escapes labels');
	check($tree->query('//div[@class="'.$prefix.'-statseg-aside"]//*[@role="progressbar"]')->length === 1, 'Summary includes shared aside');
	$nav = (string) $breadcrumbs::make([['label' => '<home>', 'url' => 'zabbix.php?action=list'], 'Parent', 'Current']);
	$tree = xpath($nav);
	check($tree->query('//nav[@aria-label="Breadcrumb"]//*[@aria-current="page"]')->length === 1, 'One current breadcrumb');
	check($tree->query('//*[@class="'.$prefix.'-breadcrumb-sep" and @aria-hidden="true"]')->length === 2, 'Automatic separators');
	check(str_contains((string) $nav, '&lt;home&gt;'), 'Breadcrumb escapes labels');
	$metadata = $badges::metadata([0 => 2, 2 => 0, 5 => 1]);
	check(array_column($metadata, 'title') === ['Disaster', 'Not classified'], 'Severity ordering retains severity zero and excludes zero counts');
	$link = $badges::link([5 => 1, 0 => 2], ['41', '42']);
	$tree = xpath($link); $href = $tree->query('//a')->item(0)->getAttribute('href');
	parse_str(parse_url($href, PHP_URL_QUERY), $query);
	check($query['hostids'] === ['41', '42'] && $query['action'] === 'problem.view', 'Problem links retain exact scope');
	check(str_contains((string) $badges::link([0 => 0], []), 'None'), 'No positive counts displays None');
	check(str_contains((string) $badges::link([], [], ['available' => false]), 'Unavailable'), 'Unavailable differs from no problems');
	$tree = xpath($badges::link([], [], ['empty_link' => true]));
	check(str_contains($tree->query('//a')->item(0)->getAttribute('href'), 'hostids%5B0%5D=0'), 'Empty scope cannot become an unfiltered problem query');
	foreach ([-9 => '0', 120 => '100'] as $value => $expected) {
		$tree = xpath($capacity::render($value));
		check($tree->query('//*[@role="progressbar"]')->item(0)->getAttribute('aria-valuenow') === $expected, 'Capacity clamps to accessible bounds');
	}
	$tree = xpath($capacity::render(null));
	check($tree->query('//*[@aria-valuetext="Unavailable" and not(@aria-valuenow)]')->length === 1, 'Missing capacity is unavailable');
	check(str_contains((string) $capacity::render(95, ['stale' => true]), 'data-tone="stale"'), 'Stale capacity overrides critical tone');
	check(str_contains((string) $capacity::render(100, ['tone' => 'warning', 'threshold' => 101]), 'data-tone="warning"'), 'Caller thresholds are retained');
	$tree = xpath($sorting::render('CPU', 'cpu', 'cpu', 'DESC', ['attribute' => 'data-sort']));
	check($tree->query('//*[@role="button" and @tabindex="0" and @data-sort="cpu"]')->length === 1, 'Client sorting keyboard control');
	check($tree->query('//*[@aria-hidden="true" and contains(@class,"arrow-down")]')->length === 1, 'Active sort direction');
	$native_header = $sorting::native('CPU', 'cpu', 'cpu', ZBX_SORT_UP, 'zabbix.php?action=list&hostid=42&search=needle');
	check($native_header instanceof CColHeader, 'Native sorting keeps table header semantics');
	$tree = xpath('<table><tr>'.$native_header.'</tr></table>');
	parse_str(parse_url($tree->query('//a')->item(0)->getAttribute('href'), PHP_URL_QUERY), $query);
	check($query['hostid'] === '42' && $query['search'] === 'needle' && $query['sortorder'] === ZBX_SORT_DOWN, 'Native sorting retains filters and toggles direction');
	$tree = xpath($sparkline::holder(['data-itemid' => '9'], 'restarting'));
	check($tree->query('//*[@data-itemid="9" and @aria-label="Loading history"]')->length === 1, 'History placeholder retains caller metadata');
	$backurl = 'zabbix.php?action=detail&hostid=42&tab=hardware&search=cpu';
	$tree = xpath($items::link('45%', '99', $backurl, ['class' => $prefix.'-value']));
	$menu = json_decode($tree->query('//*[@data-menu-popup]')->item(0)->getAttribute('data-menu-popup'), true, 512, JSON_THROW_ON_ERROR);
	check($menu['data']['itemid'] === '99' && $menu['data']['backurl'] === $backurl, 'Native item menu retains item ID and exact return URL');
	check($items::link('Unavailable', null, $backurl) === 'Unavailable', 'Missing items remain plain labels');
	$tree = xpath($pager::controls('previous', 'info', 'next'));
	check($tree->query('//button[@type="button" and @aria-label]')->length === 2, 'Pager buttons never submit forms');
	check($tree->query('//*[@id="info" and @aria-live="polite"]')->length === 1, 'Pager announces counts');
	$html = (string) $pager::ajax(['total' => 200, 'per_page' => 10, 'page' => 20], 'data-page');
	$tree = xpath($html);
	check($tree->query('//a[@data-page="1"]')->length === 1, 'Last page retains first-page navigation');
	check($tree->query('//a[@data-page="20" and @aria-current="true"]')->length === 1, 'Current page is accessible');
	check(str_contains($html, '191 to 200 of 200'), 'Page bounds and totals');
	check(str_contains((string) $pager::ajax(['total' => 0, 'per_page' => 0, 'page' => 99], 'data-page'), '0 of 0'), 'Empty pager handles invalid page size');
	$tree = xpath($pager::forTotal(99, 21, 10, new CUrl('zabbix.php?action=list&hostid=42')));
	check($tree->query('//a[@aria-current="true"]')->item(0)->textContent === '3', 'Native pager bounds excessive page numbers');
	$rows = range(1, 21); $pager::paginate(2, $rows, ZBX_SORT_UP, new CUrl('zabbix.php?action=list'));
	check(array_values($rows) === range(11, 20), 'Native pager trims actual caller data');
	$css = str_replace($prefix, 'module', file_get_contents($modules.'/'.$repo.'/assets/css/components.css'));
	check($css_standard === null || $css === $css_standard, 'Complete shared styling is identical across namespaces');
	$css_standard = $css;
}
// Exercise the actual Docker view factory used by CPU and memory cells.
preg_match('/^\$makeSparkline = static function.*?^};/ms',
	file_get_contents($modules.'/zabbix-module-docker/views/docker.view.php'), $factory);
eval('use Modules\\MonitorDocker\\Includes\\Common\\Sparkline;'.$factory[0]);
$tree = xpath($makeSparkline(['99'], 'up', 'single', 1024));
check($tree->query('//*[@data-spark-total="1024" and @data-spark-itemids="99"]')->length === 1, 'Memory holder supplies the normalization capacity');
check(str_contains($tree->query('//*[@data-spark-total]')->item(0)->getAttribute('title'), 'node memory'), 'Memory normalization basis is visible');
$tree = xpath($makeSparkline(['98'], 'up'));
check($tree->query('//*[@data-spark-itemids="98" and not(@data-spark-total)]')->length === 1, 'CPU percentages are not converted again');
require_once $modules.'/zabbix-module-wmvare-monitoring/includes/VMwareFormatter.php';
require_once $modules.'/zabbix-module-wmvare-monitoring/includes/VMwareItemMenu.php';
require_once $modules.'/zabbix-module-wmvare-monitoring/includes/VMwareTabRenderer.php';
$renderer = 'Modules\\VMwareMonitoring\\Includes\\VMwareTabRenderer';
$empty = ['rows' => [], 'page' => 1, 'per_page' => 50, 'total' => 0, 'search' => ''];
foreach (['hypervisors' => $empty, 'vms' => $empty, 'datastores' => ['unique' => $empty],
	'clusters' => [], 'alarms' => [], 'dvswitches' => ['enabled' => false]] as $tab => $fixture) {
	check(xpath($renderer::render($tab, $fixture))->query('//h4')->length === 0, 'VMware '.$tab.' has no redundant tab heading');
}
$datastore = ['identity' => 'uuid:ds1', 'name' => '<datastore>', 'type' => 'VMFS', 'uuid' => 'ds1',
	'vcenter_hostid' => '42', 'total' => 4096, 'free_pct' => 50, 'hypervisors' => ['hypervisor-1'], 'attachments' => 1];
$html = $renderer::render('datastores', ['unique' => array_replace($empty, ['rows' => [$datastore], 'total' => 1])]);
$tree = xpath($html);
check($tree->query('//button[@data-vmware-monitoring-datastore-toggle and @aria-expanded="false"]')->length === 1, 'Datastore uses an explicit expand button');
check($tree->query('//tr[@role="button"]')->length === 0, 'Datastore rows retain native table semantics');
check($tree->query('//tr[@data-vmware-monitoring-datastore-url and @hidden]/td[@colspan="7"]')->length === 1, 'Datastore retains its lazy endpoint and full-width detail row');
$html = $renderer::renderDatastoreAttachments([['hypervisor' => '<hypervisor>', 'type' => 'VMFS', 'total' => 4096,
	'free_pct' => 50, 'read_latency' => 2, 'write_latency' => 4, 'read_iops' => 12, 'write_iops' => 24, 'multipath' => 2]]);
$tree = xpath($html);
check($tree->query('//div[@class="vmware-monitoring-metric-group"]/h5')->length === 1, 'Attachment metrics are grouped by hypervisor');
check($tree->query('//th[text()="Metric"]')->length === 1 && $tree->query('//th[text()="Latest value"]')->length === 1, 'Datastore details use the standard metric/value table');
check(str_contains($html, '&lt;hypervisor&gt;'), 'Attachment headings escape resource names');
require_once $modules.'/zabbix-module-docker/includes/DockerCollector.php';
require_once $modules.'/zabbix-module-docker/includes/DockerFormatter.php';
require_once $modules.'/zabbix-module-docker/actions/CControllerDockerContainer.php';
$container = (new ReflectionClass('Modules\\MonitorDocker\\Actions\\CControllerDockerContainer'))->newInstanceWithoutConstructor();
foreach (['makeMountsSection' => 'Mounts', 'makeLabelsSection' => 'Labels'] as $method => $label) {
	$html = (string) (new ReflectionMethod($container, $method))->invoke($container, 'container-1', null);
	$tree = xpath($html);
	check($tree->query('//div[contains(@class,"docker-metric-group") and @data-module-detail-records="1"]/h5[text()="'.$label.'"]')->length === 1,
		'Docker container '.$label.' uses the common record table card');
}
echo "Shared components passed $checks native Zabbix HTML/behavior checks across three isolated namespaces.\n";
