import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { controlFixture } from './support/controlFixture.js';
import { buildFlatWorkbook, buildPivotWorkbook } from '../services/excelExportService.js';

for (const embedded of [false, true]) {
  test(`Table paging and Progress subject/filter buttons ignore delayed responses (${embedded ? 'desktop' : 'browser'})`, { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 20000 }, async () => {
    let lateTable, lateMe, notifyTable, notifyMe;
    const tableStarted = new Promise(resolve => { notifyTable = resolve; }), meStarted = new Promise(resolve => { notifyMe = resolve; });
    const f = await controlFixture('index', async (req, res) => {
      if (req.path === '/tables') { res.json({ categories: [{ title: 'Fixture tables', tables: [{ table_name: 'alpha' }, { table_name: 'beta' }] }] }); return true; }
      if (req.path.startsWith('/tables/')) {
        const send = () => res.json({ success: true, table: req.path.split('/').at(-1), page: Number(req.query.page), pageSize: Number(req.query.pageSize), columns: ['id'], rows: [{ id: 1 }], totalRows: 250, totalPages: 3, startRow: 1, endRow: 1 });
        if (req.path.endsWith('/alpha')) { lateTable = () => { send(); lateTable = null; }; notifyTable(); } else send();
        return true;
      }
      if (req.path === '/progress-chart') {
        const subjectCode = req.query.subject, send = () => res.json({ subjectCode, grades: ['ป.1'], levels: ['A'], referenceLines: [], students: [] });
        if (subjectCode === 'ME' && !lateMe) { lateMe = () => { send(); lateMe = null; }; notifyMe(); } else send();
        return true;
      }
    }, { embedded });
    try {
      const { page } = f;
      await page.locator('[data-table-name=alpha]').click(); await tableStarted;
      await page.locator('[data-table-name=beta]').click(); await page.locator('#pageSizeSelect').waitFor(); lateTable();
      await page.waitForTimeout(80); assert.equal(await page.locator('.table-title').innerText(), 'beta');
      await page.locator('.page-button[data-page="2"]').first().click(); await page.waitForFunction(() => document.querySelector('.page-button.active')?.textContent.trim() === '2');
      await page.locator('#pageSizeSelect').selectOption('50'); await page.waitForFunction(() => document.querySelector('.page-button.active')?.textContent.trim() === '1');
      await page.goto(`${f.origin}/progress-chart.html`); await meStarted;
      await page.locator('[data-subject=EFL]').click(); await page.waitForFunction(() => document.querySelector('#summaryCards strong')?.textContent === 'EFL');
      lateMe(); await page.waitForTimeout(80); assert.equal(await page.locator('#summaryCards strong').first().innerText(), 'EFL');
      await page.locator('#gradeFilterNone').click(); await page.locator('#gradeFilterAll').click();
      await page.locator('[data-subject=TRP]').click(); await page.waitForFunction(() => document.querySelector('#summaryCards strong')?.textContent === 'TRP');
      await page.locator('#refreshButton').click(); await page.waitForFunction(() => document.querySelector('#summaryCards strong')?.textContent === 'TRP');
      assert.equal(f.writes().length, 0); assert.deepEqual(f.errors, []);
    } finally { lateMe?.(); lateTable?.(); await f.close(); }
  });

  test(`Stock, Forecast and Report buttons produce current results and valid exports without writing records (${embedded ? 'desktop' : 'browser'})`, { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 30000 }, async () => {
    const codes = ['ME', 'EFL', 'TRP']; let fail = true;
    const rows = codes.map((subject, index) => ({ subject, subjectId: index + 1, levelMasterId: index + 1, level: 'A', label: 'A1', packet: 1, prepareQty: 3, neededCpws: 3, students: 1, enrollments: [{ enrollmentId: index + 1, name: 'Fixture student' }] }));
    const stock = { generatedAt: '2026-10-23', subjects: codes.map((subjectCode, index) => ({ subjectCode, subjectId: index + 1, ws: { levels: [{ levelMasterId: index + 1, levelCode: 'A', levelType: 1, values: { 1: 5 }, total: 5 }], columnValues: [1], grandTotal: 5, columnTotals: { 1: 5 } }, cd: { levels: [], columnValues: [], grandTotal: 0 } })) };
    const f = await controlFixture('stock', async (req, res) => {
      if (req.path === '/stock-summary') { res.json(stock); return true; }
      if (req.path === '/forecast') {
        if (fail) res.status(503).json({ success: false, error: 'Fixture forecast failed' });
        else res.json({ success: true, rows, cdRows: [], summary: { totalPrepareQty: 9 }, cache: { calculatedAt: '2026-10-23', cacheAction: 'Fixture' } });
        return true;
      }
      if (req.path === '/report/monthly') { res.json({ success: true, columns: ['Subject', 'ชื่อจริง', 'นามสกุล', 'WksUsed'], rows: codes.map((Subject, index) => ({ ID: index + 1, Subject, 'ชื่อจริง': 'Fixture', 'นามสกุล': 'Student', Status1: 'C', WksUsed: 3, CurrentLevel: 'A10' })) }); return true; }
      if (req.path === '/report/level-summary') { res.json({ success: true, subjects: codes.map(subject => ({ subject, total: 1, rows: [{ level: 'A', count: 1 }] })) }); return true; }
      if (req.path === '/report/event-summary') { res.json({ success: true, columns: ['name'], rows: [{ name: 'Fixture student' }] }); return true; }
      if (req.path === '/statistics/enrollment-status') { res.json({ success: true, months: [] }); return true; }
      if (req.path.startsWith('/export/')) {
        const book = req.path.endsWith('pivot-workbook') ? await buildPivotWorkbook(req.body.sheets) : await buildFlatWorkbook(req.body);
        res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(Buffer.from(await book.xlsx.writeBuffer())); return true;
      }
    }, { embedded });
    const download = async (id, excel = false) => {
      const waiting = f.page.waitForEvent('download'); await f.page.locator(`#${id}`).click(); const item = await waiting;
      const buffer = await fs.readFile(await item.path()); assert.ok(buffer.length > 0);
      if (excel) { const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer); assert.ok(workbook.worksheets.length > 0); }
      await item.delete();
    };
    try {
      const { page } = f;
      await page.locator('[data-subject=EFL]').click(); await page.locator('[data-subject=TRP]').click(); await page.locator('#refreshStockButton').click();
      await page.goto(`${f.origin}/forecast.html`); assert.equal(await page.locator('#exportForecastButton').isDisabled(), true);
      await page.locator('#forecastButton').click(); await page.waitForFunction(() => document.getElementById('statusLine').textContent.includes('Fixture forecast failed'));
      assert.equal(await page.locator('#forecastButton').isEnabled(), true); assert.equal(await page.locator('#orderButton').isDisabled(), true);
      fail = false; await page.locator('#forecastButton').click(); await page.locator('#exportForecastButton:enabled').waitFor();
      await page.locator('#forecastTableWrap td.is-cell').first().click(); await page.locator('#forecastDetailModal').waitFor(); await page.locator('#forecastDetailClose').click();
      await download('exportForecastButton', true);
      await page.locator('#orderButton').click(); await page.locator('#exportOrderButton:enabled').waitFor(); await download('exportOrderButton', true);
      await page.locator('#expectedStockButton').click(); await page.locator('#exportExpectedStockButton:enabled').waitFor(); await download('exportExpectedStockButton', true);
      await page.goto(`${f.origin}/report.html`); await page.locator('#generateButton').click(); await page.locator('#exportButton:enabled').waitFor();
      for (const subject of codes) await page.locator(`[data-subject=${subject}]`).click();
      await download('exportButton'); await download('exportEventSummaryButton', true);
      await page.locator('#levelSummaryButton').click(); await page.locator('#exportLevelSummaryButton:enabled').waitFor(); await download('exportLevelSummaryButton', true);
      await page.goto(`${f.origin}/statistics.html`); await page.waitForFunction(() => document.getElementById('statusLine').textContent === 'โหลดแล้ว');
      assert.ok(f.writes().every(request => request.path.startsWith('/export/'))); assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  });
}
