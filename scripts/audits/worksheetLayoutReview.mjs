import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { controlFixture } from '../../test/support/controlFixture.js';

const repository = fileURLToPath(new URL('../../', import.meta.url));
export async function runWorksheetLayoutReview() {
    assert.equal(path.resolve(process.cwd()), path.resolve(repository));
    const directory = path.join(repository, 'test/reviews/2026-11-24');
    await fs.mkdir(directory, { recursive: true });
    const enrollment = { enrollmentId: 900001, studentId: 900001, subjectCode: 'ME',
        studentName: 'นักเรียนตัวอย่าง (ข้อมูลจำลอง)', currentLevelMasterId: 1, currentLevelCode: 'A',
        currentZunLevelMasterId: 2, currentZunLevelCode: 'ZI', statusName: 'Continue', isKumonConnect: false };
    const summary = { billingMonth: 12, billingYear: 2026, usedDays: 0, cpwsRecords: 0 };
    const options = (levelMasterId, count) => Array.from({ length: count }, (_, index) => ({
        worksheetNo: index * 10 + 1, worksheetMasterId: levelMasterId * 1000 + index, levelMasterId
    }));
    const context = { enrollment, studentEnrollments: [enrollment],
        defaults: { receiveDate: '2026-11-24', patternCode: 'daily10', mainWorksheetNo: 1, zunWorksheetNo: 1 },
        patterns: [{ code: 'daily10', shortLabel: '10/วัน', manualCount: 1, suffixes: [1], dayOffsets: [0] }],
        worksheetOptions: { main: options(1, 20), zun: options(2, 10) }, history: [],
        worksheetMonthSummary: summary, completionState: {}, cdState: { availableCds: [], receivedCdMasterIds: [], receivedCds: [] } };
    const f = await controlFixture('worksheet', async (req, res) => {
        if (req.path === '/worksheet/enrollments/900001/context') { res.json(context); return true; }
        if (req.path.endsWith('/worksheet-summary')) { res.json({ success: true, worksheetMonthSummary: summary }); return true; }
        return false;
    });
    const result = { syntheticOnly: true, method: 'Rendered fixture layout; enrollment loaded through the exported context loader, not a user-search test.', views: [] };
    const measure = () => {
        const inspect = selector => {
            const element = document.querySelector(selector);
            if (!element) return { selector, found: false };
            const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
            return { selector, found: true, visible: Boolean(element.getClientRects().length) && style.visibility !== 'hidden',
                x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right,
                insideViewportHorizontally: rect.left >= -1 && rect.right <= innerWidth + 1,
                color: style.color, backgroundColor: style.backgroundColor, backgroundImage: style.backgroundImage,
                fontSize: style.fontSize, fontWeight: style.fontWeight, disabled: Boolean(element.disabled) };
        };
        return { width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth,
            controls: ['.student-primary', '.input-layout', '#receiveDate', '[data-ws-input][data-kind="main"]',
                '[data-ws-input][data-kind="zun"]', '#saveButton', '#previewList'].map(inspect) };
    };
    try {
        await f.page.evaluate(async () => { await (await import('/js/worksheet/worksheet.js')).loadEnrollmentContext(900001); });
        await f.page.locator('[data-ws-input][data-kind="main"]').waitFor();
        for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
            await f.page.setViewportSize(viewport);
            await f.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            const view = await f.page.evaluate(measure);
            view.screenshot = `worksheet-layout-${viewport.width}.png`;
            await f.page.screenshot({ path: path.join(directory, view.screenshot), fullPage: true });
            result.views.push(view);
        }
        await f.page.locator('#receiveDate').fill('');
        await f.page.locator('#saveButton:disabled').waitFor();
        result.disabledSave = (await f.page.evaluate(measure)).controls.find(control => control.selector === '#saveButton');
        assert.equal(f.writes().length, 0, 'Layout review must not write data');
        assert.deepEqual(f.errors, []);
        result.mainInputClippedOnMobile = result.views.find(view => view.width === 390).controls
            .find(control => control.selector === '[data-ws-input][data-kind="main"]').insideViewportHorizontally === false;
        result.status = 'completed';
    } finally { await f.close(); }
    await fs.writeFile(path.join(directory, 'worksheet-layout-evidence.json'), JSON.stringify(result, null, 2) + '\n');
    return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const result = await runWorksheetLayoutReview();
    console.log(JSON.stringify({ status: result.status, mainInputClippedOnMobile: result.mainInputClippedOnMobile,
        views: result.views.map(view => ({ width: view.width, controls: view.controls.map(({ selector, visible, right, insideViewportHorizontally }) => ({ selector, visible, right, insideViewportHorizontally })) })) }, null, 2));
}
