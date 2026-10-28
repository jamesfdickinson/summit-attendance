const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync('appsScript/apps-script/Code.gs', 'utf8'), context);
const lists = [['Family Name', 'Member Name', ' Type '],
  ['A', 'Sam', ' Parent '], ['A', 'Alex', 'parent'], ['A', 'Child', 'Student'],
  ['B', 'Sam', 'PARENT'], ['A', 'Sam', 'Parent']];
const rows = [['CheckInID', 'Timestamp', 'Family Name', 'Member Present', 'Notes'],
  ['2026-09-03|A', '', 'A', 'Sam', ''], ['2026-09-03|A', '', 'A', 'Sam', ''],
  ['2026-09-10|A', '', 'A', 'Child', ''], ['2026-09-17|A', '', 'A', '', ''],
  ['2026-09-18|A', '', 'A', 'Alex', ''], ['2026-08-27|A', '', 'A', 'Alex', ''],
  ['2027-06-03|A', '', 'A', 'Alex', ''], ['2027-01-07|B', '', 'B', 'Sam', '']];
const build = () => context.buildParentAttendanceReport_(lists, rows, 'America/Los_Angeles');
const report = build();
assert.equal(report.totalThursdays, 6);
assert.equal(report.parents.length, 3);
assert.equal(report.parents.find(p => p.family === 'A' && p.name === 'Sam').percent, 17);
assert.equal(report.parents.find(p => p.name === 'Alex').percent, 33);
assert.equal(report.parents.find(p => p.family === 'B').percent, 17);
const empty = context.buildParentAttendanceReport_(lists, rows.slice(0, 1), 'UTC');
assert.equal(empty.totalThursdays, 0);
assert.equal(empty.parents.length, 3);
assert.ok(empty.parents.every(parent => parent.percent === 0));
assert.ok(context.buildParentAttendanceReport_([['Family Name', 'Member Name']], rows, 'UTC').message);

// Run both demo admin pages with a small DOM substitute to catch broken render wiring.
for (const dir of ['site/wwwroot', 'appsScript/public']) {
  const html = fs.readFileSync(`${dir}/admin.html`, 'utf8');
  const elements = new Map();
  function element() {
    return { children: [], style: {}, hidden: false, textContent: '',
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      insertBefore(child, before) { this.children.splice(this.children.indexOf(before), 0, child); },
      get firstChild() { return this.children[0]; },
      get lastChild() { return this.children.at(-1); },
      setAttribute() {}, addEventListener() {}, focus() {} };
  }
  for (const match of html.matchAll(/id="([^"]+)"/g)) elements.set(match[1], element());
  assert.ok(elements.has('parents-tab'));
  const browser = vm.createContext({ URLSearchParams, Intl, Date,
    window: { location: { search: '?demo=1' } },
    localStorage: { getItem(key) {
      return key === 'summit-check-in-admin-unlock'
        ? /CLIENT_ADMIN_PASSWORD = "([^"]+)"/.exec(fs.readFileSync(`${dir}/admin.js`, 'utf8'))?.[1] : null;
    }, removeItem() {} },
    document: { getElementById(id) { assert.ok(elements.has(id), `Missing ${id}`); return elements.get(id); },
      querySelectorAll() { return []; }, createElement: element } });
  vm.runInContext(fs.readFileSync(`${dir}/admin.js`, 'utf8'), browser);
  assert.equal(elements.get('parents-list').children.length, 3);
  assert.equal(elements.get('report-content').hidden, false);
  assert.equal(elements.get('admin-error').hidden, true);
}
console.log('Apps Script calculations and both admin demo renders passed.');
