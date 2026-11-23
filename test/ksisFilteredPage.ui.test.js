import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readKsisDraftDocument, planKsisReportDraft, inspectKsisWsDraft, saveKsisWsPage } from '../services/ksisReportDraft.js';
import { readKsisAtDocument, planKsisAt } from '../services/ksisAtEntry.js';
import { controlFixture } from './support/controlFixture.js';

const period = { month: 11, year: 2026 };
const record = id => ({ ID: id, StudentId: id, Subject: 'ME', Status1: 'N', 'รหัสคุมอง': '',
  'ชื่อจริง': `เด็ก${id}`, 'นามสกุล': 'ทดสอบ', 'วันเกิด': '01/01/2020', CurrentLevel: 'C90', WksUsed: 8,
  TestType: 'AT', DateTest: '10/11/2026', LevelTest: 'C', Time: 4, Score: 100, Group: 1 });
function fixture(at) {
  const cells = at ? '<td><input></td><td><select><option></option><option>C</option></select></td><td><input></td><td></td><td><input></td><td></td><td><select><option value="0"></option><option value="1">G1</option></select></td><td><input type="checkbox"></td><td></td><td></td>'
    : '<td></td><td></td><td></td><td><select><option>C</option></select></td><td><select><option>90</option></select></td><td><input value="0"></td><td></td><td><select><option>N</option></select></td><td></td><td></td>';
  const subject = (id, hidden = false) => `<tr data-clrowid="subject-${id}${hidden ? '-hidden' : ''}" style="${hidden ? 'display:none' : ''}"><td><span data-ng-show="row.isDirty" style="display:none">dirty</span></td><td>Math</td>${cells}</tr>`;
  return `<meta charset="utf-8"><div class="container-header">ชื่อศูนย์ TEST ประจำเดือน Nov - 2026</div>
    <div class="filter-label-container"><span class="filter-label-item">[Math]</span><span>[เตือน [6]]</span></div>
    <button id="btnToolbarSave">Save</button><ul class="pagination"><li class="active">1</li></ul>
    <div style="height:100px;overflow:auto">${Array.from({ length: 9 }, (_, index) => {
      const id = index + 1;
      return `<section id="student-${id}" style="${id === 7 ? 'display:none' : id === 8 ? 'visibility:hidden' : ''}">
        <table class="vk-grid-content-student"><tr data-studentguid="child-${id}"><td></td><td>เด็ก${id} ทดสอบ</td><td></td><td>K</td><td>01/01/2020</td></tr></table>
        <table class="vk-grid-content-subject">${subject(id, id === 9)}${id <= 6 ? subject(`${id}-extra`, true) : ''}</table></section>`;
    }).join('')}</div>`;
}

for (const at of [false, true]) test(`${at ? 'AT' : 'WS'} reads exactly six filtered rows, including rows below the scroll, and preserves hidden-edit protection`, {
  skip: process.env.TEST_BROWSER_UI !== '1', timeout: 20000
}, async () => {
  const f = await controlFixture('ksis', async () => false);
  try {
    const context = await f.page.context().browser().newContext();
    const page = await context.newPage(); await page.setContent(fixture(at));
    const read = () => page.evaluate(at ? readKsisAtDocument : readKsisDraftDocument);
    const doc = await read();
    const actual = at ? doc.students.flatMap(student => student.tests) : doc.rows;
    assert.deepEqual(actual.map(row => row.key), Array.from({ length: 6 }, (_, index) => `subject-${index + 1}`));
    assert.equal(doc.hiddenDirty, false);
    const records = Array.from({ length: 30 }, (_, index) => record(index + 1));
    const plans = at ? planKsisAt(records, doc, period, 'ME') : planKsisReportDraft(records, doc, period, 'ALL', { includeZun: false });
    assert.equal(plans.filter(row => at ? row.outcome === 'ready' : row.ready).length, 6);
    assert.equal(plans.filter(row => row.outsidePage).length, 24);
    await page.locator('#student-7 [data-ng-show]').evaluate(marker => marker.style.display = 'inline');
    const dirty = await read(); assert.equal(dirty.hiddenDirty, true);
    assert.throws(() => at ? planKsisAt(records, dirty, period, 'ME') : planKsisReportDraft(records, dirty, period, 'ALL'), { statusCode: 409 });
    if (!at) {
      const fakePage = { url: () => 'https://kao.ksis.kumon.com/kth/#/reportbeditgrid', evaluate: async () => dirty };
      const result = await inspectKsisWsDraft(fakePage, { pendingDraft: true });
      assert.equal(result.recovered, false); assert.equal(result.pendingDraft, true);
      await assert.rejects(saveKsisWsPage(fakePage, { waitForSaves: async () => {} }), /แก้ค้าง/);
    }
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('Filtered WS preview and shared header both report six ready rows instead of an empty-state message', {
  skip: process.env.TEST_BROWSER_UI !== '1', timeout: 20000
}, async () => {
  let preview;
  const snapshot = { instanceId: 'filtered-six-fixture', revision: 0, activeView: null, busy: false, tools: {}, connection: {} };
  const f = await controlFixture('ksis', async (req, res) => {
    if (req.path === '/ksis/workspace') { res.json(snapshot); return true; }
    if (req.path === '/ksis/draft/preview') {
      snapshot.tools.draft = { preview, result: null, inspection: null, confirmed: [], pending: false, error: '', subject: 'ALL', period };
      snapshot.activeView = 'draft'; snapshot.revision++;
      res.json(preview); return true;
    }
    return false;
  });
  try {
    const context = await f.page.context().browser().newContext();
    const readPage = await context.newPage(); await readPage.setContent(fixture(false));
    const doc = await readPage.evaluate(readKsisDraftDocument);
    preview = { previewId: 'filtered-six', subject: 'ALL', period, context: doc.context, page: 1,
      rows: planKsisReportDraft(Array.from({ length: 30 }, (_, i) => record(i + 1)), doc, period, 'ALL', { includeZun: false }) };
    await f.page.locator('#ksisDraftPreview').click();
    await f.page.waitForFunction(() => document.getElementById('statusLine').textContent.includes('เตรียม WS แล้ว • พร้อม 6'));
    assert.match(await f.page.locator('#ksisDraftSource').innerText(), /พร้อม 6 รายวิชา/);
    assert.equal(await f.page.locator('#ksisDraftRows tbody tr').count(), 6);
    assert.equal(await f.page.locator('#ksisDraftRows .match-conflict').count(), 0);
    assert.equal(await f.page.locator('#ksisDraftFill').isEnabled(), true);
    assert.doesNotMatch(await f.page.locator('#statusLine').innerText(), /ยังไม่ได้เตรียมข้อมูล/);
    assert.equal(f.requests.some(request => request.path.endsWith('/fill')), false);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});
