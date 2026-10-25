import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const modules = [
	['zabbix-module-wmvare-monitoring', 'VMwareCommon', 'vmware-monitoring'],
	['zabbix-module-docker', 'DockerCommon', 'docker'],
	['zabbix-module-netapp-monitoring', 'NetAppCommon', 'netapp-monitoring']
];
class Element {
	constructor(tag = 'div') {
		this.tagName = tag; this.children = []; this.attributes = new Map(); this.dataset = {}; this.listeners = new Map();
		this.className = ''; this.textContent = '';
		this.classList = {add: name => { this.className += (this.className ? ' ' : '') + name; }};
	}
	setAttribute(name, value) { this.attributes.set(name, String(value)); }
	getAttribute(name) { return this.attributes.get(name) ?? null; }
	removeAttribute(name) { this.attributes.delete(name); }
	append(...children) { children.forEach(child => { child.parent = this; this.children.push(child); }); }
	replaceChildren(...children) { this.children = []; this.append(...children); }
	querySelector(selector) { return this.children.find(child => selector === '.' + child.className); }
	closest(selector) { return this.tagName === selector ? this : this.parent?.closest(selector); }
	addEventListener(name, callback) { this.listeners.set(name, callback); }
	emit(name, options = {}) {
		const event = {preventDefault() { this.prevented = true; }, ...options};
		this.listeners.get(name)?.(event); return event;
	}
}
for (const [directory, namespace, prefix] of modules) {
	const context = {window: {}, document: {createElement: tag => new Element(tag), createElementNS: (_ns, tag) => new Element(tag)}};
	vm.createContext(context);
	for (const asset of ['common.js', 'components.js']) vm.runInContext(readFileSync(new URL(`${directory}/assets/js/${asset}`, root), 'utf8'), context);
	const {Pager, SortableHeader, ProblemBadges, Sparkline} = context.window[namespace];
	const first = Pager.slice(Array.from({length: 75}, (_x, index) => index), 1, 25);
	const last = Pager.slice(Array.from({length: 75}, (_x, index) => index), 999, 25);
	assert.equal(first.rows.length, 25); assert.equal(first.start, 0); assert.equal(first.end, 25);
	assert.equal(last.page, 3); assert.equal(last.rows[0], 50); assert.equal(last.rows.at(-1), 74);
	const previous = new Element('button'), next = new Element('button'), info = new Element('span');
	Pager.update({previous, next, info}, first);
	assert.equal(previous.disabled, true); assert.equal(next.disabled, false); assert.equal(info.textContent, '1-25 of 75');
	Pager.update({previous, next, info}, last, 'sur');
	assert.equal(previous.disabled, false); assert.equal(next.disabled, true); assert.equal(info.textContent, '51-75 sur 75');
	Pager.update({previous, next, info}, Pager.state(0, 0, -10));
	assert.equal(previous.disabled, true); assert.equal(next.disabled, true); assert.equal(info.textContent, '0 of 0');
	assert.equal(Pager.state(Infinity, NaN, Infinity).page, 1);
	const steps = []; Pager.bind({previous, next}, value => steps.push(value));
	previous.emit('click'); next.emit('click'); assert.deepEqual(steps, [-1, 1]);
	const makeHeader = (field, attribute = 'sort') => {
		const column = new Element('th'), header = new Element('span'), arrow = new Element('span');
		header.dataset[attribute] = field; arrow.className = `${prefix}-sort-arrow`;
		header.append(arrow); column.append(header); return {column, header, arrow};
	};
	const cpu = makeHeader('cpu'), memory = makeHeader('memory');
	const activated = []; SortableHeader.bind([cpu.header, memory.header], header => activated.push(header.dataset.sort));
	assert.equal(cpu.header.emit('keydown', {key: 'Enter'}).prevented, true);
	assert.equal(memory.header.emit('keydown', {key: ' '}).prevented, true);
	cpu.header.emit('keydown', {key: 'Enter', isComposing: true});
	cpu.header.emit('keydown', {key: 'Escape'}); memory.header.emit('click');
	assert.deepEqual(activated, ['cpu', 'memory', 'memory']);
	assert.equal(SortableHeader.toggle('cpu', 1, 'cpu').direction, -1);
	assert.equal(SortableHeader.toggle('cpu', -1, 'memory').direction, 1);
	SortableHeader.update([cpu.header, memory.header], 'cpu', -1);
	assert.equal(cpu.column.getAttribute('aria-sort'), 'descending');
	assert.equal(cpu.arrow.children[0].className, 'arrow-down'); assert.equal(memory.column.getAttribute('aria-sort'), null);
	SortableHeader.update([cpu.header, memory.header], 'memory', 1);
	assert.equal(cpu.column.getAttribute('aria-sort'), null); assert.equal(cpu.arrow.children.length, 0);
	const image = makeHeader('size', 'imageSort'); SortableHeader.update([image.header], 'size', 1, 'imageSort');
	assert.equal(image.column.getAttribute('aria-sort'), 'ascending');
	const target = new Element();
	ProblemBadges.render(target, [], {emptyText: 'None'});
	assert.equal(target.children[0].textContent, 'None'); assert.equal(target.children[0].className, 'green');
	ProblemBadges.render(target, [], {available: false});
	assert.equal(target.children[0].textContent, 'Unavailable'); assert.equal(target.children[0].className, '');
	ProblemBadges.render(target, [{count: 2, style: 'status-na-bg', title: '<script>Severity zero</script>'}]);
	assert.equal(target.children[0].textContent, 2); assert.equal(target.children[0].title, '<script>Severity zero</script>');
	assert.equal(target.children[0].children.length, 0, 'Badge metadata never becomes HTML');
	const history = [[1, 10], [2, 20], [3, 30]];
	const line = () => target.children[0].children.find(child => child.tagName === 'polyline');
	Sparkline.draw(target, history, {scale: 'percent'});
	const percentPoints = line().getAttribute('points');
	Sparkline.draw(target, history, {scale: 'auto'});
	assert.notEqual(line().getAttribute('points'), percentPoints, 'VMware percentages and Docker automatic scale remain distinct');
	assert.equal(line().getAttribute('points'), '0.0,21.0 50.0,12.0 100.0,3.0');
	assert.match(target.getAttribute('aria-label'), /Current: 30.0/);
	Sparkline.draw(target, [[1, null], [2, NaN], [3, Infinity], [4, '']], {emptyLabel: 'Missing'});
	assert.equal(target.getAttribute('aria-label'), 'Missing'); assert.equal(target.children[0].children[0].tagName, 'line');
	Sparkline.draw(target, [[1, 42]], {scale: 'percent', singlePoint: 'dot'});
	assert.equal(target.children[0].children.at(-1).tagName, 'circle');
	Sparkline.draw(target, [[1, 42]], {singlePoint: 'flat'});
	assert.equal(target.children[0].children[0].tagName, 'line');
	Sparkline.draw(target, [[1, 5], [2, 5]], {scale: 'auto'});
	assert.equal(line().getAttribute('points'), '0.0,12.0 100.0,12.0', 'Flat histories have no NaN coordinates');
	Sparkline.draw(target, history, {disabled: true});
	assert.equal(target.children[0].children[0].tagName, 'line');
	Sparkline.draw(target, Array.from({length: 120}, (_x, index) => [index, index]), {maxPoints: 60});
	assert.equal(line().getAttribute('points').split(' ').length, 60);
	assert.match(target.getAttribute('aria-label'), /Current: 119.0/, 'Sampling retains latest observation');
	// Exercise the shipped adapters, preserving their distinct plotting policies.
	if (namespace !== 'NetAppCommon') {
		const filename = namespace === 'VMwareCommon' ? 'vmware.monitoring.view.js.php' : 'docker.view.js.php';
		const source = readFileSync(new URL(`${directory}/views/js/${filename}`, root), 'utf8')
			.replace(/^<\?php[\s\S]*?\?>\s*<script>\s*/, '').replace(/<\/script>\s*$/, '')
			.replace(/<\?= json_encode\(_\('([^']+)'\)\) \?>/g, (_match, label) => JSON.stringify(label))
			.replace(/<\?= [\s\S]*?\?>/g, '"fixture"');
		vm.runInContext(source, context);
		if (namespace === 'VMwareCommon') {
			context.window.vmware_monitoring.drawSparkline(target, history);
			assert.equal(line().getAttribute('points'), percentPoints);
			assert.match(target.getAttribute('aria-label'), /Current: 30.0%/);
		}
		else {
			context.window.monitor_docker._renderSparkline(target, history, 'up');
			assert.equal(line().getAttribute('points'), '0.0,21.0 50.0,12.0 100.0,3.0');
			context.window.monitor_docker._renderSparkline(target, history, 'off');
			assert.equal(target.children[0].children[0].tagName, 'line');
			const app = context.window.monitor_docker;
			const body = {querySelectorAll: () => []};
			context.document.getElementById = id => id === 'docker-table' ? {querySelector: () => body} : null;
			context.document.querySelectorAll = selector => selector === '.docker-sort[data-sort]'
				? [cpu.header, memory.header] : [cpu.header, memory.header, image.header];
			app._applyColumns = () => {}; app._syncUrl = () => {};
			app._table_state = {search: '', status: 'all', health: 'all', sort: null, dir: 1, page: 1};
			app._page_size = 25;
			app._applyTableState();
			assert.equal(image.column.getAttribute('aria-sort'), 'ascending', 'Container paging preserves lazy image-table sort state');
		}
	}
}
console.log('Shared component behavior passed across all namespaces: paging boundaries, keyboard sorting, live badges and sparkline scales/missing data.');
