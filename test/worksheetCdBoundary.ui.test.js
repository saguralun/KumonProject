import assert from 'node:assert/strict';
import { test } from 'node:test';
import { controlFixture } from './support/controlFixture.js';

const ui = { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 60000 };
async function fixture(embedded) {
    const config = { subject: 'TRP', level: '7A', first: 41, pattern: 'daily20', received: [], fail: false, hold: null };
    const summary = { billingMonth: 11, billingYear: 2026, usedDays: 0, cpwsRecords: 0 };
    const f = await controlFixture('worksheet', async (req, res) => {
        if (req.path.endsWith('/context')) {
            const id = Number(req.path.split('/')[3]);
            res.json({ enrollment: { enrollmentId: id, studentName: `CD fixture ${id}`, subjectCode: config.subject,
                currentLevelMasterId: 10, currentLevelCode: config.level }, studentEnrollments: [],
                defaults: { receiveDate: '2026-11-20', patternCode: config.pattern, mainWorksheetNo: config.first },
                patterns: [{ code: 'daily10', shortLabel: '10/day', suffixes: [1], dayOffsets: [0] },
                    { code: 'daily20', shortLabel: '20/day', suffixes: [1, 1], dayOffsets: [0, 0] },
                    { code: 'split2', shortLabel: '2 days', suffixes: [1, 6], dayOffsets: [0, 1] }],
                worksheetOptions: { main: Array.from({ length: 20 }, (_, i) => ({ worksheetNo: i * 10 + 1 })), zun: [] },
                cdState: { availableCds: [1, 2, 3, 4].map(cdNo => ({ cdMasterId: 100 + cdNo, cdNo })),
                    receivedCdMasterIds: config.received.map(n => 100 + n), receivedCds: config.received.map(cdNo => ({ cdMasterId: 100 + cdNo, cdNo, cpcd: true })) },
                history: [], worksheetMonthSummary: summary }); return true;
        }
        if (req.path.endsWith('/worksheet-summary')) { res.json({ worksheetMonthSummary: summary }); return true; }
        if (req.path === '/worksheet/cd/receive') {
            if (config.hold) await config.hold;
            if (config.fail) res.status(503).json({ error: 'Fixture CD unavailable' });
            else res.json({ inserted: true, cdUsedId: req.body.cdMasterId + 200, cdMasterId: req.body.cdMasterId, cdNo: req.body.cdMasterId - 100, cpcd: req.body.cpcd });
            return true;
        }
        if (req.path === '/worksheet/entries' && req.method === 'POST') {
            res.json({ records: req.body.mainWorksheetNos.map((no, i) => ({ worksheetUsedId: 500 + i,
                actualWorksheetNo: Number(no), packetWorksheetNo: Number(no), worksheetDate: req.body.receiveDate,
                worksheetType: 'WS', levelCode: config.level, worksheetLabel: `${config.level}${no}`, cpws: true, isStockProcessed: false })),
                completionState: {}, nextReceiveDate: '2026-11-21' }); return true;
        }
        return false;
    }, { embedded });
    return { ...f, config, load: async (id = 1) => {
        await f.page.evaluate(async id => (await import('/js/worksheet/worksheet.js')).loadEnrollmentContext(id), id);
        await f.page.locator('[data-ws-input][data-kind="main"]').first().waitFor();
    } };
}

for (const embedded of [false, true]) {
    const surface = embedded ? 'desktop' : 'browser';
    test(`TRP 20/day checks CD for both WS slots across every boundary (${surface})`, ui, async () => {
        const f = await fixture(embedded);
        try {
            for (const level of ['7A', '6A']) for (const [first, cd] of [[41, 1], [91, 2], [141, 3]]) {
                Object.assign(f.config, { level, first, received: [cd] }); await f.load();
                assert.equal(await f.page.locator('#saveButton').isDisabled(), true, `${level} ${first}/${first + 10} must require CD ${cd + 1}`);
                assert.match(await f.page.locator('#receiveCd').innerText(), new RegExp(`รับ CD ${cd + 1}`));
            }
            assert.equal(f.writes().length, 0); assert.deepEqual(f.errors, []);
        } finally { await f.close(); }
    });
    test(`Both CDs require explicit receive/decline decisions, cancellation and retry (${surface})`, ui, async () => {
        const f = await fixture(embedded);
        try {
            await f.load(); const { page } = f;
            await page.locator('#receiveCd').click(); await f.choose(true);
            await page.waitForFunction(() => document.getElementById('receiveCd').textContent.includes('รับ CD 2'));
            assert.equal(await page.locator('#saveButton').isDisabled(), true);
            assert.match(await page.locator('#statusLine').innerText(), /ยังต้องรับหรือยืนยันไม่รับ CD 2/);
            await page.locator('#receiveCd').click(); await f.choose(false); await f.choose(false);
            assert.equal(f.writes().length, 1); assert.equal(await page.locator('#saveButton').isDisabled(), true);
            f.config.fail = true;
            await page.locator('#receiveCd').click(); await f.choose(true);
            await page.waitForFunction(() => document.getElementById('statusLine').textContent === 'Fixture CD unavailable');
            assert.equal(await page.locator('#saveButton').isDisabled(), true);
            assert.equal(await page.locator('#receiveCd').isEnabled(), true);
            f.config.fail = false;
            await page.locator('#receiveCd').click(); await f.choose(false); await f.choose(true);
            await page.waitForFunction(() => !document.getElementById('saveButton').disabled);
            assert.deepEqual(f.writes().map(r => [r.body.cdMasterId, r.body.cpcd]), [[101, true], [102, true], [102, false]]);
            assert.match(await page.locator('#receiveCd').innerText(), /CD 1.*รับแล้ว.*CD 2.*ไม่รับ/);
            for (const width of [1366, 1024]) {
                await page.setViewportSize({ width, height: 900 });
                await page.waitForFunction(() => Boolean(document.getElementById('receiveCd').closest('#stripActionsSlot'))
                    === window.matchMedia('(max-width: 1120px)').matches);
                for (const selector of ['#receiveCd', '#saveButton']) {
                    const box = await page.locator(selector).boundingBox();
                    assert(box && box.x >= 0 && box.x + box.width <= width, `${selector} must fit at ${width}`);
                }
            }
            await page.locator('#saveButton').click();
            await page.waitForFunction(() => document.getElementById('statusLine').textContent === 'บันทึก 2 รายการแล้ว');
            assert.deepEqual(f.writes().at(-1), { path: '/worksheet/entries', method: 'POST', body: {
                enrollmentId: 1, expectedMainLevelMasterId: 10, expectedZunLevelMasterId: null,
                receiveDate: '2026-11-20', patternCode: 'daily20', mainWorksheetNos: ['41', '51'], zunWorksheetNos: []
            } });
            assert.equal(await page.locator('[data-delete-history-id]').count(), 2);
            assert.deepEqual(f.errors, []);
        } finally { await f.close(); }
    });
    test(`CD requirements remain compatible for single slot, duplicate/reversed packets and other subjects (${surface})`, ui, async () => {
        const f = await fixture(embedded);
        try {
            for (const [subject, level, pattern, first, received, ready] of [
                ['ME', 'A', 'daily20', 41, [], true], ['EFL', '7A', 'daily20', 41, [], false],
                ['EFL', '7A', 'daily20', 41, [1], true], ['TRP', '5A', 'daily20', 41, [1], true],
                ['TRP', '7A', 'daily10', 41, [1], true], ['TRP', '7A', 'split2', 41, [1], true]
            ]) {
                Object.assign(f.config, { subject, level, pattern, first, received }); await f.load();
                assert.equal(await f.page.locator('#saveButton').isEnabled(), ready, `${subject}/${pattern}`);
            }
            Object.assign(f.config, { subject: 'TRP', level: '7A', pattern: 'daily20', first: 41, received: [1] }); await f.load();
            const second = f.page.locator('[data-ws-input][data-kind="main"][data-index="1"]');
            await second.selectOption('41'); assert.equal(await f.page.locator('#saveButton').isEnabled(), true);
            await f.page.locator('[data-ws-input][data-kind="main"][data-index="0"]').selectOption('51');
            assert.equal(await f.page.locator('#saveButton').isDisabled(), true);
            assert.match(await f.page.locator('#receiveCd').innerText(), /รับ CD 2/);
            assert.equal(f.writes().length, 0); assert.deepEqual(f.errors, []);
        } finally { await f.close(); }
    });
    test(`A pending CD decision or response cannot update another enrollment (${surface})`, ui, async () => {
        const f = await fixture(embedded); let release;
        try {
            await f.load(); await f.page.locator('#receiveCd').click(); await f.load(2); await f.choose(true);
            assert.equal(f.writes().length, 0);
            await f.load(); f.config.hold = new Promise(resolve => { release = resolve; });
            await f.page.locator('#receiveCd').click(); await f.choose(true);
            await f.page.waitForFunction(() => document.getElementById('receiveCd').disabled);
            await f.load(2); release();
            await f.page.waitForFunction(() => !document.getElementById('receiveCd').disabled);
            assert.match(await f.page.locator('#receiveCd').innerText(), /รับ CD 1/);
            assert.equal(await f.page.locator('#saveButton').isDisabled(), true);
            assert.deepEqual(f.writes().map(r => r.body.enrollmentId), [1]); assert.deepEqual(f.errors, []);
        } finally { release?.(); await f.close(); }
    });
}
