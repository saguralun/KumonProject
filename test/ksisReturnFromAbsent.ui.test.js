import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright-core';
import { readKsisDraftDocument, planKsisReportDraft, installKsisDraftGuard, fillAndSaveKsisWsBatches } from '../services/ksisReportDraft.js';
import { controlFixture } from './support/controlFixture.js';

const url = 'https://kao.ksis.kumon.com/kth/#/reportbeditgrid';
const saveUrl = 'https://kao.ksis.kumon.com/kth/api/reportb/SaveReportBDetailEntryEditItemBatch';
const period = { month: 10, year: 2026 };
const records = ['ME', 'EFL', 'TRP'].map((Subject, index) => ({ ID: index + 1, StudentId: 100,
  Subject, 'รหัสคุมอง': '7642650000001', 'ชื่อจริง': 'เด็กกลับมาเรียน', 'นามสกุล': 'ทดสอบ', 'วันเกิด': '01/01/2020',
  Status1: index === 0 ? 'R' : 'C', CurrentLevel: index === 0 ? 'D90' : 'C90', WksUsed: index === 0 ? 8 : 7 }));
function fixture(mode) {
  const inputs = '<td><select onchange="dirty(this)"><option>C</option><option>D</option></select></td><td><select onchange="dirty(this)"><option>80</option><option>90</option></select></td><td><input value="0" onchange="dirty(this)"></td>';
  return `<meta charset="utf-8"><div class="container-header">ชื่อศูนย์ TEST ประจำเดือน Oct - 2026</div>
    <button id="btnToolbarSave" onclick="save()">Save</button><ul class="pagination"><li class="active">1</li></ul>
    <section><table class="vk-grid-content-student"><tr><td></td><td>เด็กกลับมาเรียน ทดสอบ</td><td>7642650000001</td><td>K</td><td>01/01/2020</td></tr></table>
    <table class="vk-grid-content-subject">${['Math', 'English EFL', 'Thai Reading'].map((subject, index) => `<tr data-clrowid="return-${index}">
      <td><span data-ng-show="subject.isDirty" style="display:none">dirty</span></td><td>${subject}</td><td></td><td></td><td></td>
      ${index < 2 ? '<td><span>A</span></td><td><span>50</span></td><td></td>' : inputs}<td></td>
      <td><select ${mode === 'locked' && index === 0 ? 'disabled' : ''} onchange="changeStatus(this)">
      ${index < 2 ? `<option>A</option>${mode === 'no-r' && index === 0 ? '' : '<option>R</option>'}` : '<option>C</option><option>A</option><option>R</option>'}</select></td><td></td><td></td></tr>`).join('')}</table></section>
    <script>
    function dirty(control){control.closest('tr').querySelector('[data-ng-show]').style.display='inline'}
    function changeStatus(select){
      dirty(select); const row=select.closest('tr');row.dataset.changes=Number(row.dataset.changes||0)+1;
      if(select.value!=='R')return;
      ${mode === 'revert' ? "select.value='A';return;" : ''}
      ${mode === 'autosave' ? "fetch('/unexpected-status-save',{method:'POST'}).catch(()=>{});" : ''}
      setTimeout(()=>{row.cells[5].innerHTML='<select onchange="dirty(this)"><option>C</option><option>D</option></select>';
        row.cells[6].innerHTML='<select onchange="dirty(this)"><option>80</option><option>90</option></select>';
        row.cells[7].innerHTML='<input value="0" onchange="dirty(this)">';
        ${mode === 'fixed-r' ? "row.cells[9].innerHTML='<span>R</span>';" : ''}
      },30);
    }
    async function save(){const response=await fetch('${saveUrl}',{method:'POST',body:'fixture-only'});const result=await response.json();
      if(result.success)document.querySelectorAll('[data-ng-show]').forEach(marker=>marker.style.display='none')}
    </script>`;
}

for (const mode of ['normal', 'fixed-r']) test(`Report R changes native KSIS A to R, unlocks fields, then batches normally; other A stays skipped (${mode})`, {
  skip: process.env.TEST_BROWSER_UI !== '1', timeout: 20000
}, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, chromiumSandbox: true });
  let guard;
  try {
    const page = await browser.newPage(); let saves = 0;
    await page.route('**/*', route => {
      if (route.request().method() === 'POST') {
        assert.equal(route.request().url(), saveUrl); saves++;
        return route.fulfill({ contentType: 'application/json', body: '{"success":true}' });
      }
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture(mode) });
    });
    await page.goto(url);
    const doc = await page.evaluate(readKsisDraftDocument);
    const rows = planKsisReportDraft(records, doc, period, 'ALL', { includeZun: false });
    assert.equal(rows[0].ready, true); assert.equal(rows[0].returningFromAbsent, true);
    assert.equal(rows[1].skipped, true); assert.equal(saves, 0);
    assert.equal((await page.evaluate(readKsisDraftDocument)).rows[0].status.value, 'A');
    guard = await installKsisDraftGuard(page, { allowBatchSave: true });
    const result = await fillAndSaveKsisWsBatches(page, rows, guard);
    assert.deepEqual(result.savedKeys, ['return-0', 'return-2']); assert.equal(saves, 1);
    const actual = (await page.evaluate(readKsisDraftDocument)).rows;
    assert.equal(actual[0].status.value, 'R'); assert.equal(actual[0].level.value, 'D');
    assert.equal(actual[0].worksheet.value, '90'); assert.equal(actual[0].used.value, '8');
    assert.equal(actual[1].status.value, 'A'); assert.equal(actual[1].used.value, '');
    assert.equal(actual[2].status.value, 'C'); assert.equal(actual[2].used.value, '7');
    assert.equal(guard.blocked(), 0);
  } finally { await guard?.release(); guard?.dispose(); await browser.close(); }
});

for (const mode of ['locked', 'no-r', 'revert', 'autosave', 'wrong-child']) test(`A to R refuses unavailable or rejected changes and never sends an unintended save (${mode})`, {
  skip: process.env.TEST_BROWSER_UI !== '1', timeout: 20000
}, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, chromiumSandbox: true });
  let guard;
  try {
    const page = await browser.newPage(); let saves = 0;
    await page.route('**/*', route => {
      if (route.request().method() === 'POST') { saves++; return route.fulfill({ body: '{}' }); }
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture(mode) });
    });
    await page.goto(url);
    const rows = planKsisReportDraft([records[0]], await page.evaluate(readKsisDraftDocument), period, 'ME', { includeZun: false });
    if (['locked', 'no-r'].includes(mode)) {
      assert.equal(rows[0].ready, false); assert.match(rows[0].reason, /ไม่อนุญาต ST1 R/);
    } else {
      if (mode === 'wrong-child') await page.locator('.vk-grid-content-student tr').evaluate(row => row.cells[1].textContent = 'เด็กคนอื่น ทดสอบ');
      guard = await installKsisDraftGuard(page, { allowBatchSave: true });
      await assert.rejects(fillAndSaveKsisWsBatches(page, rows, guard), error => {
        assert.deepEqual(error.draftProgress.savedKeys, []); return true;
      });
      if (mode === 'autosave') assert.ok(guard.blocked() > 0);
    }
    assert.equal(saves, 0);
    assert.equal((await page.evaluate(readKsisDraftDocument)).rows[1].status.value, 'A');
  } finally { await guard?.release(); guard?.dispose(); await browser.close(); }
});

for (const embedded of [false, true]) test(`WS preview and final confirmation disclose the A to R return without filling (${embedded ? 'desktop' : 'browser'})`, {
  skip: process.env.TEST_BROWSER_UI !== '1', timeout: 20000
}, async () => {
  const field = (value, options = null) => ({ value, options, writable: true });
  const doc = { context: 'ชื่อศูนย์ TEST ประจำเดือน Oct - 2026', page: 1, rows: [{ key: 'return-0', kumonId: '7642650000001',
    fullName: 'เด็กกลับมาเรียน ทดสอบ', birthDate: '01/01/2020', subject: 'ME', status: field('A', ['A', 'R']),
    level: field('A'), worksheet: field('50'), used: field('') }] };
  const rows = planKsisReportDraft([records[0]], doc, period, 'ME', { includeZun: false });
  const f = await controlFixture('ksis', async (req, res) => {
    if (req.path === '/ksis/desktop/open') { res.json({ success: true, embedded: true }); return true; }
    if (req.path === '/ksis/draft/preview') { res.json({ previewId: 'return-preview', rows, period, subject: 'ME', context: doc.context, page: 1 }); return true; }
    return false;
  }, { embedded });
  try {
    await f.page.locator('#ksisDraftPreview').click();
    await f.page.locator('#ksisDraftRows').getByText('กลับมาเรียน A → R', { exact: true }).waitFor();
    assert.equal(await f.page.locator('#ksisDraftFill').isEnabled(), true);
    await f.page.locator('#ksisDraftFill').click();
    assert.match(await f.page.locator('#ksisDraftConfirmText').innerText(), /กลับมาเรียน A → R 1 รายวิชา/);
    await f.page.locator('#ksisDraftCancel').click();
    assert.equal(f.requests.some(request => request.path.endsWith('/fill')), false);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});
