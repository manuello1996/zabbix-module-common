import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const modules = [
	['zabbix-module-wmvare-monitoring', 'VMwareCommon', 'vmwareLocation'],
	['zabbix-module-docker', 'DockerCommon', 'dockerLocation'],
	['zabbix-module-netapp-monitoring', 'NetAppCommon', 'location']
];
const read = path => readFileSync(new URL(path, root), 'utf8');
const script = path => read(path)
	.replace(/^<\?php[\s\S]*?\?>\s*<script>\s*/, '').replace(/<\/script>\s*$/, '')
	.replace(/<\?= [\s\S]*?\?>/g, '"fixture"');

class Element {
	constructor(selectors = []) {
		this.selectors = new Set(selectors);
		this.listeners = new Map();
		this.value = '';
		this.dataset = {};
	}
	addEventListener(name, callback) {
		if (!this.listeners.has(name)) this.listeners.set(name, []);
		this.listeners.get(name).push(callback);
	}
	emit(name, target = this, extra = {}) {
		const event = {target, preventDefault() { this.prevented = true; }, ...extra};
		for (let node = this; node; node = node.parent) {
			for (const callback of node.listeners.get(name) || []) callback(event);
		}
		return event;
	}
	matches(selector) { return selector.split(',').some(value => this.selectors.has(value.trim())); }
	closest(selector) { return this.matches(selector) ? this : (this.parent || this.form)?.closest(selector); }
	querySelector(selector) { return this.input?.matches(selector) ? this.input : undefined; }
	focus() { this.focused = true; }
}

function environment(directory) {
	const timers = new Map();
	let serial = 0;
	const context = {window: {}, URL, URLSearchParams, AbortController,
		setTimeout(callback, delay) { timers.set(++serial, {callback, delay}); return serial; },
		clearTimeout(id) { timers.delete(id); }};
	vm.createContext(context);
	vm.runInContext(read(`${directory}/assets/js/common.js`), context);
	const flush = () => {
		assert.equal(timers.size, 1);
		const [id, task] = [...timers][0];
		timers.delete(id);
		return task.callback();
	};
	return {context, timers, flush};
}

for (const [directory, namespace, dataPrefix] of modules) {
	const {context, timers, flush} = environment(directory);
	const common = context.window[namespace];
	const form = new Element(['form[data-search]']);
	const input = new Element(['[name="search"]']);
	input.form = form;
	form.input = input;
	const searches = [];
	let cancellations = 0;
	const control = new common.SearchInput(form, {
		selector: '[name="search"]', formSelector: 'form[data-search]', clearSelector: '[data-clear]', delay: 80,
		onChange: (field, immediate) => control.queue(() => searches.push(field.value), immediate),
		onCancel: () => cancellations++
	});
	input.value = 'v'; form.emit('input', input);
	input.value = 'volume'; form.emit('input', input);
	assert.equal(timers.size, 1, 'Typing shares one timer');
	assert.equal([...timers.values()][0].delay, 80);
	flush(); assert.deepEqual(searches, ['volume']);
	input.value = 'unfinished'; form.emit('input', input);
	form.emit('compositionstart', input);
	assert.equal(timers.size, 0, 'IME cancels pending requests');
	form.emit('input', input, {isComposing: true});
	assert.equal(timers.size, 0);
	form.emit('compositionend', input);
	assert.equal(cancellations, 1);
	flush(); assert.equal(searches.at(-1), 'unfinished');
	assert.equal(form.emit('submit').prevented, true);
	assert.equal([...timers.values()][0].delay, 0, 'Enter submits immediately');
	flush();
	form.emit('keydown', input, {key: 'Escape'});
	assert.equal(input.value, ''); assert.equal(input.focused, true);
	flush(); assert.equal(searches.at(-1), '');
	input.value = 'clear me';
	const clear = new Element(['[data-clear]']); clear.form = form;
	assert.equal(form.emit('click', clear).prevented, true);
	flush(); assert.equal(input.value, '');
	form.emit('input', new Element());
	assert.equal(timers.size, 0, 'Other form controls cannot start a search');
	input.value = 'cancel'; form.emit('input', input); control.cancel();
	assert.equal(timers.size, 0, 'Tab switches can cancel the pending query');

	const button = (key, collapsed = false) => ({dataset: {[`${dataPrefix}Toggle`]: key},
		expanded: String(!collapsed), getAttribute() { return this.expanded; },
		setAttribute(_name, value) { this.expanded = value; }});
	const row = keys => ({dataset: {[`${dataPrefix}Ancestors`]: JSON.stringify(keys)}, hidden: false});
	const buttons = [button('parent'), button('child', true)];
	const rows = [row([]), row(['parent']), row(['parent', 'child'])];
	const scope = {querySelectorAll: selector => selector.includes('toggle') ? buttons : rows};
	const states = new Map();
	common.LocationGroups.apply(scope, states);
	assert.equal(rows[2].hidden, true, 'Server child collapse is restored');
	states.set('parent', true); common.LocationGroups.apply(scope, states);
	assert.equal(rows[1].hidden, true); assert.equal(rows[0].hidden, false);
	states.set('parent', false); common.LocationGroups.apply(scope, states);
	assert.equal(rows[1].hidden, false); assert.equal(rows[2].hidden, true, 'Child state survives reopening a parent');
	common.LocationGroups.apply(scope, new Set(['parent']));
	assert.equal(rows[1].hidden, true, 'Browser-tab Set state is also supported');
	rows[2].dataset[`${dataPrefix}Ancestors`] = 'invalid';
	common.LocationGroups.apply(scope, states);
	assert.equal(rows[2].hidden, false, 'Malformed rows cannot hide unrelated content');
}

// Exercise the actual VMware tab adapter with the shared control, including tab races.
{
	const {context, timers, flush} = environment(modules[0][0]);
	vm.runInContext(script(`${modules[0][0]}/views/js/vmware.monitoring.view.js.php`), context);
	const app = context.window.vmware_monitoring;
	app.panel = new Element(); app.state = new Map(); app.activeTab = 'hypervisors';
	const loaded = [];
	app.updateUrl = () => {};
	app.loadTab = tab => loaded.push(tab);
	app.bindPanel();
	const input = new Element(['[data-vmware-monitoring-server-search]']);
	const searchBar = new Element(['[data-module-search]']);
	searchBar.input = input; searchBar.parent = app.panel; input.parent = searchBar;
	input.value = ' esxi ';
	app.panel.emit('input', input);
	assert.equal([...timers.values()][0].delay, 350);
	assert.equal(app.getState('hypervisors').search, 'esxi');
	app.activeTab = 'vms'; flush();
	assert.equal(loaded.length, 0, 'An old tab search cannot load the newly selected tab');
	app.panel.emit('input', input); flush();
	assert.deepEqual(loaded, ['vms']);
	app.request = new AbortController();
	app.panel.emit('input', input);
	app.panel.emit('compositionstart', input);
	assert.equal(timers.size, 0);
	assert.equal(app.request.signal.aborted, true, 'An old response cannot replace a composing input');
	const clear = new Element(['[data-module-search-clear]']); clear.parent = searchBar;
	clear.emit('click');
	assert.equal(input.value, ''); assert.equal(input.focused, true);
	assert.equal([...timers.values()][0].delay, 0, 'The standard Clear button immediately resets VMware search');
	flush(); assert.equal(app.getState('vms').search, '');
}

// Exercise Docker's container and lazily loaded graph/image controls from shipped code.
{
	const {context, timers, flush} = environment(modules[1][0]);
	const search = new Element(['#docker-search']);
	const searchBar = new Element(['[data-module-search]']); searchBar.input = search; search.parent = searchBar;
	const panel = new Element();
	const content = new Element();
	context.document = {getElementById: id => ({'docker-search': search, 'docker-panel': panel, 'docker-content': content}[id] || null),
		querySelectorAll: () => []};
	vm.runInContext(script(`${modules[1][0]}/views/js/docker.view.js.php`), context);
	const app = context.window.monitor_docker;
	app._initPreferenceControls = () => {};
	app._table_state = {search: '', page: 9};
	const filtered = [];
	app._applyTableState = () => filtered.push({...app._table_state});
	app._initTableControls();
	search.value = ' Alpine '; search.emit('input');
	assert.equal([...timers.values()][0].delay, 250);
	flush(); assert.equal(filtered[0].search, 'alpine'); assert.equal(filtered[0].page, 1);
	const clear = new Element(['[data-module-search-clear]']); clear.parent = searchBar;
	clear.emit('click'); flush();
	assert.equal(filtered.at(-1).search, ''); assert.equal(search.focused, true);
	search.value = ' enter ';
	assert.equal(search.emit('keydown', search, {key: 'Enter'}).prevented, true);
	assert.equal([...timers.values()][0].delay, 0); flush();
	assert.equal(filtered.at(-1).search, 'enter');
	app._panel_filters = {};
	app._syncUrl = () => {};
	const graphs = [];
	app._filterGraphs = value => graphs.push(value);
	app._filterImages = () => filtered.push({...app._panel_filters});
	app._initTabs();
	const graph = new Element(['#docker-graphs-search']); graph.id = 'docker-graphs-search'; graph.value = ' CPU ';
	panel.emit('input', graph); assert.equal([...timers.values()][0].delay, 250);
	flush(); assert.deepEqual(graphs, ['cpu']);
	const image = new Element(['[data-image-filter]']); image.dataset.imageFilter = 'name'; image.value = 'debian';
	const imageBar = new Element(['[data-module-search]']); imageBar.input = image; image.parent = imageBar; imageBar.parent = panel;
	panel.emit('input', image); assert.equal([...timers.values()][0].delay, 150);
	flush(); assert.equal(filtered.at(-1).images_name, 'debian');
	const usage = new Element(['[data-image-filter]']); usage.dataset.imageFilter = 'usage'; usage.value = 'unused';
	const usageBar = new Element(['[data-module-search]']); usageBar.input = usage; usage.parent = usageBar; usageBar.parent = panel;
	usage.emit('input'); flush();
	const imageClear = new Element(['[data-module-search-clear]']); imageClear.parent = imageBar;
	imageClear.emit('click'); flush();
	assert.equal(filtered.at(-1).images_name, '', 'Clear targets its own search bar');
	assert.equal(filtered.at(-1).images_usage, 'unused', 'Other image filters retain their values');
}

const isolated = {window: {}};
vm.createContext(isolated);
for (const [directory] of modules) vm.runInContext(read(`${directory}/assets/js/common.js`), isolated);
assert.equal(Object.keys(isolated.window).length, 3, 'All module runtimes coexist without overwriting each other');
console.log('Shared controls passed in all three namespaces: debounce, IME, Enter, clear, Escape, collapse, tab races and Docker filters.');
