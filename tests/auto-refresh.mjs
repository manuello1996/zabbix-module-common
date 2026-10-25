import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const read = file => readFileSync(new URL(file, root), 'utf8');
const modules = [
	['zabbix-module-wmvare-monitoring', 'VMwareCommon'],
	['zabbix-module-netapp-monitoring', 'NetAppCommon'],
	['zabbix-module-docker', 'DockerCommon']
];
const settle = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };
const control = (dataset = {}) => ({dataset, checked: true, listeners: new Map(),
	addEventListener(name, callback) { this.listeners.set(name, callback); },
	removeEventListener(name) { this.listeners.delete(name); },
	change(checked) { this.checked = checked; this.listeners.get('change')(); }});
function environment(directory) {
	const timers = new Map(); let serial = 0;
	const context = {window: {}, document: {hidden: false}, overlays_stack: [],
		URL, URLSearchParams, AbortController, CustomEvent: class {},
		setTimeout(callback, milliseconds) { timers.set(++serial, {callback, milliseconds}); return serial; },
		clearTimeout(id) { timers.delete(id); },
		setInterval() { throw new Error('Refresh must use one scheduled timeout, not a repeating interval'); }};
	vm.createContext(context);
	for (const name of ['common.js', 'components.js']) vm.runInContext(read(`${directory}/assets/js/${name}`), context);
	const tick = () => {
		assert.equal(timers.size, 1, 'Only one timer may be scheduled');
		const [id, task] = [...timers][0]; timers.delete(id); return task.callback();
	};
	return {context, timers, tick};
}
for (const [directory, namespace] of modules) {
	const {context, timers, tick} = environment(directory);
	const checkbox = control({refreshInterval: '5'}), status = {};
	let busy = false, calls = 0, finish;
	const refresh = new context.window[namespace].AutoRefresh({control: checkbox, status,
		isBusy: () => busy, onRefresh: () => { calls++; return new Promise(resolve => { finish = resolve; }); }});
	assert.equal(checkbox.checked, false, 'Browser-restored checkbox state does not opt in');
	assert.equal(timers.size, 0); assert.equal(refresh.interval, 10);
	assert.equal(refresh.cacheLifetime, 60000);
	refresh.updated(0); assert.match(status.textContent, /^Updated at /);
	checkbox.change(true); assert.equal(timers.size, 1); assert.match(status.textContent, /Auto-refresh enabled/);
	assert.equal(refresh.cacheLifetime, 10000, 'Cache expiry follows the active refresh interval');
	assert.equal([...timers.values()][0].milliseconds, 10000);
	context.document.hidden = true; await tick(); assert.equal(calls, 0);
	context.document.hidden = false; context.overlays_stack.push({}); await tick(); assert.equal(calls, 0);
	context.overlays_stack.length = 0; busy = true; await tick(); assert.equal(calls, 0);
	busy = false;
	const running = tick(); assert.equal(calls, 1); assert.equal(timers.size, 0, 'No timer overlaps an in-flight request');
	checkbox.change(true); assert.equal(timers.size, 0);
	finish(); await running; assert.equal(timers.size, 1);
	refresh.pause(); assert.equal(timers.size, 0);
	refresh.resume(); assert.equal(timers.size, 1);
	const second = tick(); checkbox.change(false); finish(); await second;
	assert.equal(timers.size, 0, 'Disabling during a request prevents rescheduling');
	assert.equal(status.textContent.includes('Auto-refresh enabled'), false);
	refresh.onRefresh = async () => { throw new Error('Network failed'); };
	checkbox.change(true); await tick(); assert.match(status.textContent, /Unable to refresh data/);
	assert.equal(timers.size, 1, 'Failures retry only while enabled');
	refresh.destroy(); assert.equal(timers.size, 0); assert.equal(checkbox.listeners.size, 0);
	for (const interval of [0, NaN, Infinity, 'invalid']) {
		assert.equal(new context.window[namespace].AutoRefresh({interval, onRefresh() {}}).interval, 60);
	}
}

// NetApp: use the real deferred-list adapter with active filters and an in-flight search.
{
	const {context, timers, tick} = environment(modules[1][0]);
	const checkbox = control({refreshInterval: '10'}), status = {}, searchStatus = {};
	const requests = [], formListeners = new Map(); let historyWrites = 0;
	const fields = {search: {value: 'prod'}, tab: {value: 'problems'}, sort: {value: 'name'}, sortorder: {value: 'DESC'}};
	const form = {querySelector(selector) {
		if (selector === '[data-netapp-search-status]') return searchStatus;
		return fields[selector.match(/name="([^"]+)"/)[1]];
	}, addEventListener(name, callback) { formListeners.set(name, callback); }};
	const results = {dataset: {loading: 'Loading', refreshError: 'Refresh failed; retained', loadError: 'Load failed'},
		setAttribute() {}, contains: () => false};
	const summary = {innerHTML: 'placeholders', setAttribute() {}};
	context.window.location = new URL('http://localhost/zabbix.php?action=netapp.monitoring.list&tab=problems&search=prod&page=2&filter_groupids[]=25&sortorder=DESC');
	context.window.history = Object.fromEntries(['pushState', 'replaceState'].map(name => [name, (_state, _title, url) => {
		historyWrites++; context.window.location = new URL(url);
	}]));
	context.window.addEventListener = () => {};
	Object.assign(context.document, {readyState: 'complete',
		querySelector: selector => selector === '[data-netapp-list]' ? results : selector.includes('list-filter') ? form : null,
		querySelectorAll: () => [], addEventListener() {}, dispatchEvent() {},
		getElementById: id => ({'netapp-list-summary': summary, 'netapp-monitoring-auto-refresh': checkbox,
			'netapp-monitoring-refresh-status': status})[id] ?? null});
	context.DOMParser = class { parseFromString(value) { return {getElementById: () => ({innerHTML: value})}; } };
	context.FormData = class { constructor() { return [...Object.entries(fields).map(([name, field]) => [name, field.value]), ['filter_groupids[]', '25']]; } };
	context.fetch = (url, options) => new Promise(resolve => requests.push({url: new URL(url), options, resolve}));
	const respond = async (index, html) => {
		requests[index].resolve({ok: true, json: async () => ({html, summary: 'summary: ' + html, groups: []})}); await settle();
	};
	vm.runInContext(read('zabbix-module-netapp-monitoring/assets/js/list.js'), context);
	assert.equal(requests.length, 1); assert.equal(checkbox.checked, false); assert.equal(timers.size, 0);
	checkbox.change(true); assert.equal(timers.size, 0, 'Enabling during initial loading waits for completion');
	await respond(0, 'initial'); assert.equal(timers.size, 1);
	const writes = historyWrites;
	const refresh = tick(); assert.equal(requests.length, 2);
	assert.equal(requests[1].url.searchParams.get('action'), 'netapp.monitoring.list.data');
	for (const [name, value] of [['tab', 'problems'], ['search', 'prod'], ['page', '2'], ['filter_groupids[]', '25'], ['sortorder', 'DESC']]) {
		assert.equal(requests[1].url.searchParams.get(name), value, 'Automatic refresh retains ' + name);
	}
	assert.equal(historyWrites, writes, 'Background refresh does not add browser history');
	// A new search supersedes the automatic request and retains its own scheduling.
	fields.search.value = 'updated';
	formListeners.get('input')({target: fields.search});
	assert.equal([...timers.values()][0].milliseconds, 80);
	tick(); assert.equal(requests.length, 3); assert.equal(requests[1].options.signal.aborted, true);
	await respond(1, 'obsolete'); await refresh;
	assert.notEqual(results.innerHTML, 'obsolete'); assert.equal(timers.size, 0);
	await respond(2, 'new search'); assert.equal(results.innerHTML, 'new search'); assert.equal(timers.size, 1);
	checkbox.change(false); assert.equal(timers.size, 0);
}

// Docker: real HTML refresh retains controls, suppresses duplicates, and validates responses.
{
	const {context, timers, tick} = environment(modules[2][0]);
	const checkbox = control({refreshInterval: '10'}), status = {}, manual = control();
	const requests = []; let replacements = 0;
	const replaceable = {replaceWith() { replacements++; }};
	Object.assign(context.document, {addEventListener() {}, querySelectorAll: () => [],
		querySelector: () => replaceable,
		getElementById: id => ({'docker-list-auto-refresh': checkbox, 'docker-list-refresh-status': status,
			'docker-list-refresh': manual})[id] ?? replaceable});
	context.location = new URL('http://localhost/zabbix.php?action=docker.list&page=2&filter_name=prod&filter_groupids[]=25');
	context.Curl = class { constructor(value) { this.url = new URL(value, context.location); }
		setArgument(name, value) { this.url.searchParams.set(name, value); } getUrl() { return this.url.href; } };
	context.DOMParser = class { parseFromString(html) { return {
		getElementById: () => html === 'login' ? null : {}, querySelector: () => html === 'login' ? null : {}}; } };
	context.fetch = (url, options) => new Promise(resolve => requests.push({url: new URL(url), options, resolve}));
	const script = read('zabbix-module-docker/views/js/docker.list.js.php').match(/<script>\s*([\s\S]*?)<\/script>/)[1]
		.replace(/<\?= json_encode\(_\('([^']+)'\)\) \?>/g, (_match, label) => JSON.stringify(label))
		.replace(/<\?= [\s\S]*?\?>/g, '0');
	vm.runInContext(script, context);
	const app = context.window.monitor_docker_list;
	app.init({refresh_interval: 10});
	assert.equal(checkbox.checked, false); assert.equal(requests.length, 0); assert.equal(timers.size, 0);
	manual.listeners.get('click')(); assert.equal(manual.disabled, true); assert.equal(requests.length, 1);
	manual.listeners.get('click')(); assert.equal(requests.length, 1, 'Manual refresh cannot overlap itself');
	requests[0].resolve({ok: true, text: async () => 'success'}); await settle();
	assert.equal(manual.disabled, false); assert.equal(replacements, 3); assert.equal(timers.size, 0);
	checkbox.change(true); const refresh = tick(); assert.equal(requests.length, 2);
	for (const [name, value] of [['page', '2'], ['filter_name', 'prod'], ['filter_groupids[]', '25']]) {
		assert.equal(requests[1].url.searchParams.get(name), value);
	}
	requests[1].resolve({ok: true, text: async () => 'login'}); await refresh;
	assert.equal(replacements, 3, 'Malformed/login responses retain the last table');
	assert.match(status.textContent, /Unable to refresh Docker data/); assert.equal(timers.size, 1);
	const retry = tick(); checkbox.change(false);
	requests[2].resolve({ok: true, text: async () => 'recovered'}); await retry;
	assert.equal(replacements, 6); assert.equal(timers.size, 0); assert.match(status.textContent, /^Updated at /);
}
console.log('Auto-refresh passed in all namespaces: opt-in defaults, interval bounds, hidden/popup/busy pauses, no overlapping timers, failure recovery, filters, manual refresh and request races.');
