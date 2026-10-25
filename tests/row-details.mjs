import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const read = name => readFileSync(new URL(name, root), 'utf8');
const source = name => read(name).replace(/^<\?php[\s\S]*?\?>\s*<script>\s*/, '').replace(/<\/script>\s*$/, '')
	.replace(/<\?= json_encode\(_\('([^']+)'\)\) \?>/g, (_match, label) => JSON.stringify(label))
	.replace(/<\?= [\s\S]*?\?>/g, '"fixture"');
const modules = [
	['zabbix-module-wmvare-monitoring', 'VMwareCommon', 'vmware-monitoring'],
	['zabbix-module-docker', 'DockerCommon', 'docker'],
	['zabbix-module-netapp-monitoring', 'NetAppCommon', 'netapp-monitoring']
];
const panels = new Map(), listeners = [];
const context = {window: {}, document: {
	getElementById: id => panels.get(id) ?? null,
	addEventListener: (event, callback) => { if (event === 'click') listeners.push(callback); }
}};
vm.createContext(context);
for (const [directory] of modules) {
	for (const file of ['common.js', 'components.js']) vm.runInContext(read(`${directory}/assets/js/${file}`), context);
}
function button(prefix, id) {
	const classes = new Set();
	const parent = {classList: {toggle: (name, value) => value ? classes.add(name) : classes.delete(name)}};
	const attributes = new Map([['aria-controls', id], ['aria-expanded', 'false']]);
	return {dataset: {}, parent, classes, setAttribute: (name, value) => attributes.set(name, value),
		getAttribute: name => attributes.get(name),
		closest(selector) {
			if (selector === 'tr') return parent;
			return selector === `.${prefix}-metrics-toggle[data-module-details-toggle]` ? this : null;
		}};
}
const controls = modules.map(([_directory, _namespace, prefix]) => {
	const id = prefix + '-details'; panels.set(id, {hidden: true}); return button(prefix, id);
});
context.window.VMwareCommon.RowDetails.bind(context.document);
context.window.DockerCommon.RowDetails.bind(context.document);
// Load the actual NetApp bridge; it must also cover live-search replacements.
vm.runInContext(read('zabbix-module-netapp-monitoring/assets/js/metrics.js'), context);
for (const [index, [_directory, namespace, prefix]] of modules.entries()) {
	const control = controls[index];
	for (const listener of listeners) listener({target: control});
	assert.equal(control.getAttribute('aria-expanded'), 'true');
	assert.equal(panels.get(prefix + '-details').hidden, false);
	assert.equal(control.classes.has(prefix + '-resource-expanded'), true);
	assert.equal(controls.filter(item => item.getAttribute('aria-expanded') === 'true').length, 1, 'Each module handles its own controls once');
	for (const listener of listeners) listener({target: control});
	assert.equal(panels.get(prefix + '-details').hidden, true);
	assert.equal(control.classes.size, 0);
	assert.equal(context.window[namespace].RowDetails.setExpanded(control, null, true), false);
}
const replacement = button('netapp-monitoring', 'replacement'); panels.set('replacement', {hidden: true});
for (const listener of listeners) listener({target: replacement});
assert.equal(panels.get('replacement').hidden, false, 'Newly rendered resource rows work without rebinding');

// Exercise VMware's real lazy attachment loader with the shared control state.
const requests = [];
context.fetch = (url, options) => new Promise(resolve => requests.push({url, options, resolve}));
vm.runInContext(source('zabbix-module-wmvare-monitoring/views/js/vmware.monitoring.view.js.php'), context);
const app = context.window.vmware_monitoring;
function datastore(id) {
	const control = button('vmware-monitoring', id);
	control.dataset.vmwareMonitoringDatastoreToggle = id;
	const row = {hidden: true, dataset: {vmwareMonitoringDatastoreContent: id + '-content', vmwareMonitoringDatastoreUrl: '/attachments?identity=' + id}};
	const attributes = new Map();
	const content = {setAttribute: (name, value) => attributes.set(name, value), attributes};
	panels.set(id, row); panels.set(id + '-content', content); return {control, row, content};
}
const first = datastore('first'), second = datastore('second');
const pending = app.toggleDatastore(first.control);
assert.equal(first.row.hidden, false); assert.equal(first.content.attributes.get('aria-busy'), 'true');
assert.equal(second.row.hidden, true, 'Other datastore details remain collapsed');
assert.equal(requests.length, 1);
await app.toggleDatastore(first.control); // Close during the request.
await app.toggleDatastore(first.control); // Reopen while the same request is running.
assert.equal(requests.length, 1, 'Repeated expansion reuses the pending request');
requests[0].resolve({ok: true, json: async () => ({html: '<div>Grouped attachment metrics</div>'})});
await pending;
assert.match(first.content.innerHTML, /Grouped attachment metrics/);
assert.equal(first.row.dataset.vmwareMonitoringDatastoreLoaded, '1');
assert.equal(first.content.attributes.get('aria-busy'), 'false');
await app.toggleDatastore(first.control); await app.toggleDatastore(first.control);
assert.equal(requests.length, 1, 'Loaded attachment metrics are cached');
const failure = app.toggleDatastore(second.control);
requests[1].resolve({ok: false, status: 500}); await failure;
assert.equal(second.content.textContent, 'Unable to load attachment metrics.');
assert.equal(second.content.attributes.get('aria-busy'), 'false');
await app.toggleDatastore(second.control);
const retry = app.toggleDatastore(second.control);
assert.equal(requests.length, 3, 'Failed attachment loading can be retried');
requests[2].resolve({ok: true, json: async () => ({html: 'Recovered'})}); await retry;
assert.equal(second.content.innerHTML, 'Recovered');

// Exercise Docker image sorting/filtering with real companion detail rows.
vm.runInContext(source('zabbix-module-docker/views/js/docker.view.js.php'), context);
const docker = context.window.monitor_docker;
const alphaControl = button('docker', 'alpha-details'), betaControl = button('docker', 'beta-details');
alphaControl.setAttribute('aria-expanded', 'true');
const alpha = {id: 'alpha', dataset: {imageName: 'alpha', imageUsage: 'running', imageSortSize: '20', imageDetails: 'alpha-details'}, querySelector: () => alphaControl};
const beta = {id: 'beta', dataset: {imageName: 'beta', imageUsage: 'stopped', imageSortSize: '10', imageDetails: 'beta-details'}, querySelector: () => betaControl};
const alphaPanel = {id: 'alpha-details', hidden: false}, betaPanel = {id: 'beta-details', hidden: true};
panels.set('alpha-details', alphaPanel); panels.set('beta-details', betaPanel);
const order = [alpha, alphaPanel, beta, betaPanel];
const rows = () => order.filter(row => row.dataset?.imageName);
const tbody = {querySelectorAll: rows, append(row) { order.splice(order.indexOf(row), 1); order.push(row); }};
const filter = {dataset: {imageFilter: 'name'}, value: ''};
const count = {};
const scope = {querySelectorAll: selector => selector.includes('data-image-filter') ? [filter] : selector.includes('data-image-name') ? rows() : [],
	querySelector: selector => selector === '#docker-images-table tbody' ? tbody : selector === '#docker-images-filter-count' ? count : null};
docker._image_sort = {field: '', dir: 1};
docker._sortImages(scope, 'size');
assert.deepEqual(order.map(row => row.id), ['beta', 'beta-details', 'alpha', 'alpha-details']);
assert.equal(alphaPanel.hidden, false); assert.equal(betaPanel.hidden, true);
filter.value = 'beta'; docker._filterImages(scope);
assert.equal(alpha.hidden, true); assert.equal(alphaPanel.hidden, true, 'Filtering hides an expanded companion row');
assert.equal(beta.hidden, false); assert.equal(betaPanel.hidden, true, 'Filtering keeps a collapsed companion row collapsed');
filter.value = ''; docker._filterImages(scope);
assert.equal(alphaPanel.hidden, false, 'Removing filters restores the previously expanded row');
docker._sortImages(scope, 'size');
assert.deepEqual(order.map(row => row.id), ['alpha', 'alpha-details', 'beta', 'beta-details']);
console.log('Shared detail controls passed: module isolation, live replacements, row highlights, lazy loading/cache/retry, and Docker parent/child sorting and filtering.');
