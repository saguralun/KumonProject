import assert from 'node:assert/strict';
import { test } from 'node:test';
import { controlFixture } from './support/controlFixture.js';

for (const embedded of [false, true]) {
    test(`Level summary names its enrollment count and current-data basis (${embedded ? 'desktop' : 'browser'})`, {
        skip: process.env.TEST_BROWSER_UI !== '1', timeout: 25000
    }, async () => {
        const f = await controlFixture('report', async (req, res) => {
            if (req.path === '/report/level-summary') {
                // As verified by reportLevelSummary.test.js, two enrollment
                // IDs may belong to one child and still count as two entries.
                res.json({ subjects: [{ subject: 'ME', total: 2, rows: [{ level: 'A', count: 2 }] }] }); return true;
            }
            return false;
        }, { embedded });
        try {
            await f.page.locator('#levelSummaryButton').click();
            await f.page.locator('#exportLevelSummaryButton:enabled').waitFor();
            assert.match(await f.page.locator('#levelSummaryTables caption').innerText(), /2 รายวิชา/);
            assert.match(await f.page.locator('#levelSummarySubtitle').innerText(), /ปัจจุบัน.*ไม่ใช่ภาพย้อนหลัง/);
            assert.deepEqual(f.writes(), []); assert.deepEqual(f.errors, []);
        } finally { await f.close(); }
    });
    test(`Incomplete Forecast discloses missing averages, blocks downstream plans, and recovers after recalculation (${embedded ? 'desktop' : 'browser'})`, {
        skip: process.env.TEST_BROWSER_UI !== '1', timeout: 35000
    }, async () => {
        let missing = true;
        const f = await controlFixture('forecast', async (req, res) => {
            if (req.path === '/forecast') {
                res.json({ rows: [{ subject: 'ME', subjectId: 1, levelMasterId: 1, level: 'A', packet: 1, prepareQty: 3, neededCpws: 3, students: 1, enrollments: [] }], cdRows: [],
                    summary: { totalPrepareQty: 3, activeEnrollments: 2, missingAverage: missing ? 1 : 0 }, params: { days: 30 },
                    cache: { calculatedAt: '2026-11-24', cacheAction: 'Fixture' },
                    missingAverage: missing ? [{ enrollmentId: 20, subject: 'EFL', level: 'B', packet: 11 }] : [] }); return true;
            }
            return false;
        }, { embedded });
        try {
            const { page } = f;
            await page.locator('#forecastButton').click();
            await page.waitForFunction(() => !document.getElementById('forecastButton').disabled);
            assert.equal(await page.locator('#orderButton').isDisabled(), true, 'Partial totals must not silently unlock purchasing');
            assert.equal(await page.locator('#expectedStockButton').isDisabled(), true);
            assert.equal(await page.locator('#exportForecastButton').isDisabled(), true);
            assert.match(await page.locator('#forecastWarnings').innerText(), /ข้อมูล.*ไม่ครบ/);
            assert.match(await page.locator('#forecastWarnings').innerText(), /20.*EFL.*B.*11/s);
            await page.locator('#orderButton').dispatchEvent('click');
            assert.equal(f.requests.filter(r => r.path === '/stock-summary').length, 0);
            missing = false;
            await page.locator('#recalculateForecastButton').click();
            await page.locator('#exportForecastButton:enabled').waitFor();
            assert.equal(await page.locator('#orderButton').isEnabled(), true);
            assert.equal(await page.locator('#expectedStockButton').isEnabled(), true);
            assert.equal(await page.locator('#forecastWarnings').isHidden(), true);
            assert.deepEqual(f.writes(), []); assert.deepEqual(f.errors, []);
        } finally { await f.close(); }
    });

    test(`Statistics labels count status records and billed subjects, rather than unique children (${embedded ? 'desktop' : 'browser'})`, {
        skip: process.env.TEST_BROWSER_UI !== '1', timeout: 25000
    }, async () => {
        const f = await controlFixture('statistics', async (req, res) => {
            if (req.path === '/statistics/enrollment-status') {
                res.json({ months: [{ month: 1, monthLabel: 'January', years: [2026], headYear: 2026,
                    yearData: { 2026: { byStatus: { N: 2 }, current: 2, isCurrentMonth: false } } }] }); return true;
            }
            return false;
        }, { embedded });
        try {
            await f.page.locator('.stats-bar-segment[data-code=N]').hover();
            assert.match(await f.page.locator('#chartTooltip').innerText(), /2 รายการสถานะ/);
            await f.page.locator('.stats-bar-segment[data-code=C]').hover();
            assert.match(await f.page.locator('#chartTooltip').innerText(), /2 รายวิชาในบิล/);
            assert.deepEqual(f.writes(), []); assert.deepEqual(f.errors, []);
        } finally { await f.close(); }
    });
}
