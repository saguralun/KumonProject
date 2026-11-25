import assert from 'node:assert/strict';
import { test } from 'node:test';
import { controlFixture } from './support/controlFixture.js';

for (const embedded of [false, true]) test(`Latest AT can be edited from the visible UI after advancement without advancing again (${embedded ? 'desktop' : 'browser'})`, {
    skip: process.env.TEST_BROWSER_UI !== '1', timeout: 35000
}, async () => {
    const f = await controlFixture('worksheet', async (req, res) => {
        if (req.path === '/worksheet/search') { res.json({ rows: [{ enrollmentId: 1, studentName: 'Fixture', subjectCode: 'ME', currentLevelCode: 'D' }] }); return true; }
        if (req.path.endsWith('/context')) {
            res.json({ enrollment: { enrollmentId: 1, studentName: 'Fixture', subjectId: 1, subjectCode: 'ME', currentLevelMasterId: 11, currentLevelCode: 'D' },
                studentEnrollments: [], defaults: { receiveDate: '2026-11-24', patternCode: 'daily10', mainWorksheetNo: 1 },
                patterns: [{ code: 'daily10', shortLabel: '10/day', suffixes: [1], dayOffsets: [0] }],
                worksheetOptions: { main: [{ worksheetNo: 1 }], zun: [] }, history: [],
                completionState: { atCompletion: { canComplete: false }, latestAtCompletion: {
                    atUsedId: 77, atMasterId: 100, levelMasterId: 10, levelCode: 'C', atDate: '2026-11-20', score: 80, usedTime: 5, atGroup: 1, isPass: true, maxScore: 100, maxTime: 10 } } }); return true;
        }
        if (req.path === '/worksheet/at-completion') {
            assert.equal(req.body.atUsedId, 77); assert.equal(req.body.expectedLevelMasterId, 10);
            res.json({ success: true, enrollmentId: 1, levelMasterId: 10, isPass: true }); return true;
        }
        return false;
    }, { embedded });
    try {
        const { page } = f;
        await page.locator('#studentSearch').fill('Fixture'); await page.locator('#searchResults [data-index]').click();
        await page.locator('[data-ws-input][data-kind=main]').waitFor();
        assert.equal(await page.locator('#editLastAtButton').count(), 1, 'Historical editing needs a visible entry independent of current AT eligibility');
        await page.locator('#editLastAtButton').click();
        assert.equal(await page.locator('#atModalTitle').innerText(), 'แก้ AT ล่าสุด');
        assert.equal(await page.locator('#atLevel').inputValue(), 'C');
        assert.equal(await page.locator('#atDate').inputValue(), '2026-11-20');
        await page.locator('#atCancel').click(); assert.equal(f.writes().length, 0);
        await page.locator('#editLastAtButton').click(); await page.locator('#atScore').fill('81'); await page.locator('#atSaveButton').click();
        await page.waitForFunction(() => document.getElementById('atModal').classList.contains('hidden') && !document.getElementById('studentSearch').disabled);
        assert.equal(await page.locator('[data-ws-input][data-kind=main]').first().inputValue(), '1');
        assert.equal(f.writes().length, 1); assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
});
