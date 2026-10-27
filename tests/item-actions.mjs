import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const native = readFileSync(process.argv[2] || new URL('../service-tags/js/menupopup.js', root), 'utf8');
const builder = native.slice(native.indexOf('function getMenuPopupItem(options)'), native.indexOf('function getMenuPopupItemPrototype('));
for (const [directory, namespace] of [
	['zabbix-module-docker', 'DockerCommon'], ['zabbix-module-wmvare-monitoring', 'VMwareCommon'],
	['zabbix-module-netapp-monitoring', 'NetAppCommon'], ['FortiGateOverview', 'FortinetCommon']
]) {
	const events = new Map(), popups = [], posts = [], notices = [], urls = [];
	const menuLinks = [];
	let reloads = 0, fail = false, submitted = 0;
	const context = {window: {location: {href: 'http://localhost/zabbix.php?action=module.view&tab=cpu',
		reload() { reloads++; }}, history: {replaceState(...args) { urls.push(args[2]); }}},
		document: {querySelectorAll() { return menuLinks; }},
		CSRF_TOKEN_NAME: '_csrf_token', URLSearchParams, t: label => label,
		Curl: class { constructor(path) { this.url = new URL(path, 'http://localhost'); }
			setArgument(key, value) { this.url.searchParams.set(key, value); } getUrl() { return this.url.href; } },
		PopUp(action, data, options) { popups.push({action, data, options}); return {$dialogue: [{
			addEventListener(name, listener) { events.set(name, listener); }}]}; },
		clearMessages() {}, postMessageOk() {}, postMessageDetails() {},
		makeMessageBox(tone, messages, title) { return {tone, messages, title}; }, addMessage(box) { notices.push(box); },
		async fetch(url, options) { posts.push({url, options}); if (fail) throw new Error('Offline');
			return {ok: true, async json() { return {success: {title: 'Executed'}}; }}; }};
	vm.createContext(context);
	Object.defineProperty(context.window, 'getMenuPopupItem', {
		get() { return context.getMenuPopupItem; }, set(value) { context.getMenuPopupItem = value; }
	});
	for (const file of ['common.js', 'components.js']) {
		vm.runInContext(readFileSync(new URL(`${directory}/assets/js/${file}`, root), 'utf8'), context);
	}
	vm.runInContext(builder, context);
	const originalBuilder = context.getMenuPopupItem;
	const actions = context.window[namespace].ItemActions;
	const page = actions.install({csrfToken: 'session-token'});
	context.view = page;
	const filteredBuilder = context.getMenuPopupItem;
	assert.notEqual(filteredBuilder, originalBuilder, 'Apply visibility after native permission-aware generation');
	const base = {context: 'host', itemid: '99', hostid: '42', name: 'CPU', host: 'demo', key: 'cpu',
		backurl: 'zabbix.php?action=module.view', history: true, trends: true, showGraph: true,
		allowed_ui_latest_data: true, allowed_ui_conf_hosts: true, isWriteable: true, isExecutable: true,
		triggers: [{triggerid: '7', description: 'High CPU'}]};
	menuLinks.push({getAttribute() { return JSON.stringify({type: 'item',
		data: {itemid: base.itemid, backurl: base.backurl}, context: 'host'}); }});
	menuLinks.push({getAttribute() { return 'invalid metadata'; }});
	let sections = context.getMenuPopupItem(base);
	assert.deepEqual(Array.from(sections, section => section.label), ['View', 'Configuration', 'Actions']);
	assert.deepEqual(Array.from(sections[0].items, item => item.label), ['Latest data', 'Graph', 'Values', '500 latest values']);
	assert.deepEqual(Array.from(sections[1].items, item => item.label), ['Item', 'Host', 'Triggers']);
	const nativePage = context.getMenuPopupItem({...base, backurl: 'zabbix.php?action=latest.view'});
	assert.equal(nativePage[1].items.filter(item => item.label.startsWith('Create ')).length, 3,
		'Native menus outside the common component retain creation actions');
	context.t = label => 'translated ' + label;
	assert.deepEqual(Array.from(context.getMenuPopupItem(base)[1].items, item => item.label),
		['translated Item', 'translated Host', 'translated Triggers'], 'Visibility follows the native translations');
	context.t = label => label;
	sections[1].items.find(item => item.label === 'Item').clickCallback();
	assert.equal(popups.at(-1).action, 'item.edit'); assert.equal(popups.at(-1).data.itemid, '99');
	sections[1].items.find(item => item.label === 'Host').clickCallback({});
	assert.equal(popups.at(-1).action, 'popup.host.edit'); assert.equal(popups.at(-1).data.hostid, '42');
	page.editTrigger({triggerid: '7'}); assert.equal(popups.at(-1).action, 'trigger.edit');
	events.get('dialogue.close')(); assert.equal(urls.at(-1), context.window.location.href);
	events.get('dialogue.submit')({detail: {success: {title: 'Saved'}}}); assert.equal(reloads, 1);
	actions.install({onSuccess() { submitted++; }});
	page.editItem(null, {master_itemid: '99', type: 18});
	assert.equal(popups.at(-1).data.master_itemid, '99');
	events.get('dialogue.submit')({detail: {success: {title: 'Saved'}}}); assert.equal(submitted, 1);
	assert.equal(reloads, 1, 'Caller can refresh its tab rather than reloading');
	const existing = page.editHost; actions.install({csrfToken: 'new-session-token'});
	assert.equal(page.editHost, existing, 'Never overwrite native or caller-provided callbacks');
	assert.equal(context.getMenuPopupItem, filteredBuilder, 'Repeated installation does not wrap the menu again');
	const otherNamespace = namespace === 'DockerCommon' ? ['zabbix-module-netapp-monitoring', 'NetAppCommon']
		: ['zabbix-module-docker', 'DockerCommon'];
	for (const file of ['common.js', 'components.js']) vm.runInContext(
		readFileSync(new URL(`${otherNamespace[0]}/assets/js/${file}`, root), 'utf8'), context);
	context.window[otherNamespace[1]].ItemActions.install();
	assert.equal(context.getMenuPopupItem, filteredBuilder, 'Different module bundles share one menu policy');
	sections = context.getMenuPopupItem({...base, allowed_ui_conf_hosts: false, isWriteable: false, isExecutable: false});
	assert.deepEqual(Array.from(sections, section => section.label), ['View', 'Actions']);
	assert.equal(sections[1].items[0].disabled, true);
	assert.equal(context.getMenuPopupItem({...base, showGraph: false})[0].items[1].disabled, true, 'Text has no Graph');
	await page.executeNow(null, {itemids: ['99']});
	assert.equal(posts.at(-1).url, 'zabbix.php?action=item.execute');
	assert.equal(posts.at(-1).options.credentials, 'same-origin');
	assert.deepEqual(JSON.parse(posts.at(-1).options.body), {itemids: ['99'], _csrf_token: 'new-session-token'});
	assert.equal(notices.at(-1).tone, 'good');
	fail = true; await page.executeNow(null, {itemids: ['99']}); assert.equal(notices.at(-1).tone, 'bad');
	actions.install({csrfToken: null}); const count = posts.length;
	await page.executeNow(null, {itemids: ['99']}); assert.equal(posts.length, count, 'Missing CSRF fails closed');
	for (const id of [null, '', '0', '-1', '1x']) assert.equal(actions.html('<missing>', id), '&lt;missing&gt;');
	const html = actions.html('<cpu> "&', '9223372036854775807', {backurl: 'zabbix.php?action=x&search="test"'});
	assert.match(html, /data-menu-popup=/); assert.match(html, /9223372036854775807/);
	assert.match(html, /data-module-item-actions="1"/);
	assert.ok(!html.includes('<cpu>')); assert.match(html, /&lt;cpu&gt;/); assert.match(html, /&quot;/);
}
console.log('Native item menus passed in all four modules: scoped creation-action hiding, translations, permissions, editing, return URLs, CSRF execution and safe widget links.');
