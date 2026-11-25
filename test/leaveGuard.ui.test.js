import assert from 'node:assert/strict';
import { test } from 'node:test';
import { controlFixture } from './support/controlFixture.js';

const ui = { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 45000 };
const beforeUnload = page => page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event); return event.defaultPrevented;
});

async function fixture(pageName, embedded) {
    const config = { fail: false, hold: null, retrySafe: true };
    const student = { studentId: 1, displayName: 'Fixture Only', firstName: 'Fixture', lastName: 'Only', prefixId: 1 };
    const enrollment = { enrollmentId: 10, subjectId: 1, subjectCode: 'ME', currentLevelMasterId: 1, currentLevelCode: 'A',
        startingWorksheetMasterId: 1, enStartDate: '2026-11-01', currentStatusGroup1Id: 1, statusGroup1Code: 'N', canDeleteEnrollment: true };
    const summary = { billingMonth: 11, billingYear: 2026, usedDays: 0, cpwsRecords: 0 };
    const f = await controlFixture(pageName, async (req, res) => {
        if (req.method !== 'GET') {
            if (config.hold) await config.hold;
            if (config.fail) { res.status(503).json({ error: 'Synthetic save failure', retrySafe: config.retrySafe }); return true; }
        }
        if (req.path === '/auth/logout') { res.json({ success: true }); return true; }
        if (req.path === '/system/update-check') { res.json({ checked: true, upToDate: false, remoteMessage: 'Synthetic version' }); return true; }
        if (req.path === '/students/masters') { res.json({ masters: { prefixes: [{ id: 1, name: 'Mr' }], subjects: [{ id: 1, code: 'ME', name: 'Math' }],
            genders: [], grades: [], schedules: [], studentHints: {}, addressRows: [], dtMasters: [],
            statuses: [{ id: 1, code: 'N', group: 1, name: 'New' }], levels: [{ id: 1, subjectId: 1, code: 'A', type: 1 }],
            worksheets: [{ id: 1, levelMasterId: 1, worksheetNo: 1 }] } }); return true; }
        if (req.path === '/students/search') { res.json({ rows: [student] }); return true; }
        if (req.path === '/students/1') {
            if (req.method === 'PUT') Object.assign(student, req.body);
            res.json({ student, enrollments: [enrollment] }); return true;
        }
        if (req.path === '/students/1/history') { res.json({ rows: [] }); return true; }
        if (req.path === '/stock-receive/masters') { res.json({ retryScope: { actor: 'fixture-only', epoch: 'fixture' }, masters: {
            subjects: [{ subjectId: 1, subjectCode: 'ME', subjectName: 'Math' }], levels: [{ levelMasterId: 1, subjectId: 1, levelCode: 'A' }],
            worksheets: [{ worksheetMasterId: 11, levelMasterId: 1, worksheetNo: 1 }], cds: [] } }); return true; }
        if (req.path === '/stock-receive/dos') { res.json(req.method === 'POST' ? { success: true, doNo: 'FIXTURE', appended: false } : { rows: [] }); return true; }
        if (req.path.endsWith('/context')) { res.json({ enrollment: { ...enrollment, studentName: 'Fixture Only' }, studentEnrollments: [],
            defaults: { receiveDate: '2026-11-20', patternCode: 'daily10', mainWorksheetNo: 101 },
            patterns: [{ code: 'daily10', shortLabel: '10/day', suffixes: [1], dayOffsets: [0] }],
            worksheetOptions: { main: [{ worksheetNo: 101 }, { worksheetNo: 111 }], zun: [] }, history: [], worksheetMonthSummary: summary,
            completionState: { atCompletion: { canComplete: true, bypassWorksheet191: true, atMasterId: 5, maxScore: 100, maxTime: 10, levelCode: 'A' } } }); return true; }
        if (req.path.endsWith('/worksheet-summary')) { res.json({ worksheetMonthSummary: summary }); return true; }
        if (req.path === '/worksheet/entries') { res.json({ records: [{ worksheetUsedId: 1, worksheetType: 'WS', levelCode: 'A',
            worksheetLabel: 'A111', actualWorksheetNo: 111, packetWorksheetNo: 111, worksheetDate: req.body.receiveDate }], nextReceiveDate: '2026-11-21', completionState: {} }); return true; }
        if (req.path === '/worksheet/at-completion') { res.json({ isPass: true, nextLevelMasterId: null }); return true; }
        return false;
    }, { embedded });
    const { page } = f;
    try {
        if (pageName === 'student-manager') await page.waitForFunction(() => document.querySelector('#studentForm [name=firstName]')?.value === 'Fixture');
        if (pageName === 'stock-receive') await page.locator('#levelSelect').selectOption('1');
        if (pageName === 'worksheet') await page.evaluate(async () => (await import('/js/worksheet/worksheet.js')).loadEnrollmentContext(10));
    } catch (error) { await f.close(); throw error; }
    const field = page.locator(pageName === 'student-manager' ? '#studentForm [name=firstName]' : pageName === 'stock-receive' ? '[data-master-id="11"]' : '[data-ws-input][data-kind="main"]').first();
    const change = async () => pageName === 'worksheet' ? field.selectOption('111') : field.fill(pageName === 'student-manager' ? 'Unsaved' : '5');
    return { ...f, config, field, change };
}

for (const embedded of [false, true]) for (const pageName of ['student-manager', 'stock-receive', 'worksheet']) {
    test(`Unsaved ${pageName} survives cancelled navigation and allows deliberate leave (${embedded ? 'desktop' : 'browser'})`, ui, async () => {
        const f = await fixture(pageName, embedded);
        try {
            const { page } = f;
            assert.equal(await beforeUnload(page), false, 'Loading defaults must not be dirty');
            await f.change();
            assert.equal(await beforeUnload(page), true, 'Typed values need a close/reload warning');
            await page.locator('.app-menu-toggle').click();
            await page.getByRole('button', { name: 'จัดการ', exact: true }).click();
            await page.locator('a.home-link[href="/payment.html"]').first().evaluate(node => { node.href = '/neutral-leave-target.html'; node.dataset.leaveTarget = 'true'; });
            const link = page.locator('[data-leave-target]');
            await link.click(); await f.choose(false);
            assert.equal(await f.field.inputValue(), pageName === 'worksheet' ? '111' : pageName === 'student-manager' ? 'Unsaved' : '5');
            assert.equal(f.writes().length, 0);
            await page.locator('.app-menu-toggle').click();
            await page.getByRole('button', { name: 'จัดการ', exact: true }).click();
            await link.click(); await f.choose(true);
            await page.waitForURL('**/neutral-leave-target.html');
            assert.equal(f.writes().length, 0); assert.deepEqual(f.errors, []);
        } finally { await f.close(); }
    });

    test(`Pending/failed/successful saves retain correct leave protection on ${pageName} (${embedded ? 'desktop' : 'browser'})`, ui, async () => {
        const f = await fixture(pageName, embedded);
        let release;
        try {
            const { page } = f;
            await f.change();
            if (pageName === 'stock-receive') await page.locator('#doForm [name=doNo]').fill('FIXTURE');
            const save = page.locator(pageName === 'student-manager' ? '#saveStudentButton' : pageName === 'stock-receive' ? '#saveDoButton' : '#saveButton');
            f.config.fail = true;
            f.config.hold = new Promise(resolve => { release = resolve; });
            const sent = page.waitForRequest(request => request.method() !== 'GET');
            await save.click(); await sent;
            assert.equal(await beforeUnload(page), true);
            await page.locator('.app-menu-toggle').click();
            await page.getByRole('button', { name: 'จัดการ', exact: true }).click();
            await page.locator('a.home-link[href="/payment.html"]').first().click();
            assert.match(await page.locator('#appDialogMessage').innerText(), /กำลังบันทึกหรือรอผล/);
            await f.choose(true);
            assert.match(new URL(page.url()).pathname, new RegExp(pageName));
            release(); f.config.hold = null;
            await page.waitForFunction(() => document.getElementById('statusLine').textContent.includes('Synthetic save failure'));
            assert.equal(await beforeUnload(page), true, 'Failed save retains the typed draft');
            f.config.fail = false;
            await save.click();
            await page.waitForFunction(() => { const state = window.kumonLeaveGuard?.readState(); return state && !state.busy && !state.dirty; });
            assert.equal(await beforeUnload(page), false, 'Saved values must not trigger a leave warning');
            assert.equal(f.writes().length, 2); assert.deepEqual(f.errors, []);
        } finally { release?.(); await f.close(); }
    });
}

test('Browser reload warns and cancelling it preserves the current Student draft', ui, async () => {
    const f = await fixture('student-manager', false);
    try {
        await f.change(); let prompts = 0;
        f.page.on('dialog', async dialog => { assert.equal(dialog.type(), 'beforeunload'); prompts++; await dialog.dismiss(); });
        // Chromium can leave the navigation waiter pending after a dismissed
        // beforeunload. Assert the dialog and intact form, allowing that timeout.
        await f.page.reload({ timeout: 2000 }).catch(error => assert.match(error.message, /ERR_ABORTED|interrupted|Timeout 2000ms/));
        assert.equal(prompts, 1); assert.equal(await f.field.inputValue(), 'Unsaved');
        assert.equal(f.writes().length, 0);
    } finally { await f.close(); }
});

test('Desktop close defaults to staying and closes only after an explicit discard', ui, async () => {
    const f = await fixture('student-manager', true);
    try {
        await f.change();
        await f.desktop.application.evaluate(({ dialog }) => {
            global.fixtureLeavePrompts = []; global.fixtureLeaveAnswer = 0;
            dialog.showMessageBoxSync = (_window, options) => { global.fixtureLeavePrompts.push(options); return global.fixtureLeaveAnswer; };
        });
        await f.desktop.application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
        await f.page.waitForFunction(() => window.kumonLeaveGuard.readState().dirty);
        // Flush the main/renderer beforeunload handshake without sleeping.
        for (let i = 0; i < 30; i++) {
            const count = await f.desktop.application.evaluate(() => global.fixtureLeavePrompts.length);
            if (count) break;
            await f.page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
        }
        const prompts = await f.desktop.application.evaluate(() => global.fixtureLeavePrompts);
        assert.equal(prompts.length, 1); assert.equal(prompts[0].defaultId, 0); assert.equal(prompts[0].cancelId, 0);
        assert.equal(await f.field.inputValue(), 'Unsaved'); assert.equal(f.writes().length, 0);
        await f.desktop.application.evaluate(() => { global.fixtureLeaveAnswer = 1; });
        const closed = f.desktop.application.waitForEvent('close');
        await f.desktop.application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); }).catch(() => {});
        await closed;
    } finally { await f.close(); }
});

test('Cancelled logout never sends a request; confirmed logout does not save the Student draft', ui, async () => {
    const f = await fixture('student-manager', false);
    try {
        await f.change(); await f.page.locator('.app-menu-toggle').click();
        await f.page.locator('#authLogoutButton').click(); await f.choose(false);
        assert.equal(f.writes().length, 0); assert.equal(await f.field.inputValue(), 'Unsaved');
        await f.page.locator('#authLogoutButton').click(); await f.choose(true);
        await f.page.waitForURL('**/login.html');
        assert.deepEqual(f.writes().map(request => request.path), ['/auth/logout']);
        assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
});

test('AT and Add Student defaults are clean; entered modal values protect close/reload until cancelled', ui, async () => {
    for (const pageName of ['worksheet', 'student-manager']) {
        const f = await fixture(pageName, false);
        try {
            if (pageName === 'worksheet') {
                await f.page.locator('#completeWsLevel').click();
                assert.equal(await beforeUnload(f.page), false);
                await f.page.locator('#atScore').fill('80');
                assert.equal(await beforeUnload(f.page), true);
                await f.page.locator('#atCancel').click();
            } else {
                await f.page.locator('#newStudentButton').click();
                assert.equal(await beforeUnload(f.page), false);
                await f.page.locator('#addStudentForm [name=firstName]').fill('Synthetic new student');
                assert.equal(await beforeUnload(f.page), true);
                await f.page.locator('#addStudentCancel').click();
            }
            assert.equal(await beforeUnload(f.page), false); assert.equal(f.writes().length, 0); assert.deepEqual(f.errors, []);
        } finally { await f.close(); }
    }
});

test('Update confirmation names the unsaved work and cancelling never applies an update', ui, async () => {
    const f = await fixture('worksheet', false);
    try {
        await f.change();
        await f.page.locator('.app-menu-toggle').click();
        await f.page.locator('#authUpdateButton').click();
        assert.match(await f.page.locator('#appDialogMessage').innerText(), /หน้านี้มีข้อมูลที่ยังไม่ได้บันทึก/);
        await f.choose(false);
        assert.equal(f.writes().length, 0); assert.equal(await f.field.inputValue(), '111');
        assert.equal(await beforeUnload(f.page), true); assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
});

test('DO header-only edits and Add Subject edits are guarded without changing their defaults', ui, async () => {
    for (const pageName of ['stock-receive', 'student-manager']) {
        const f = await fixture(pageName, false);
        try {
            if (pageName === 'stock-receive') {
                await f.page.locator('#doForm [name=doNo]').fill('HEADER-ONLY');
                assert.equal(await beforeUnload(f.page), true);
                await f.page.locator('#newDoButton').click();
            } else {
                await f.page.locator('#newEnrollmentButton').click();
                assert.equal(await beforeUnload(f.page), false);
                await f.page.locator('#addEnrollmentForm [name=enStartDate]').fill('2026-11-14');
                assert.equal(await beforeUnload(f.page), true);
                await f.page.locator('#addEnrollmentCancel').click();
            }
            assert.equal(await beforeUnload(f.page), false);
            assert.equal(f.writes().length, 0); assert.deepEqual(f.errors, []);
        } finally { await f.close(); }
    }
});

test('AT pending and failed submissions retain leave protection until the saved form closes', ui, async () => {
    const f = await fixture('worksheet', false); let release;
    try {
        const { page } = f;
        await page.locator('#completeWsLevel').click();
        await page.locator('#atScore').fill('80'); await page.locator('#atTime').fill('5');
        f.config.fail = true; f.config.hold = new Promise(resolve => { release = resolve; });
        const sent = page.waitForRequest(request => request.url().endsWith('/at-completion'));
        await page.locator('#atSaveButton').click(); await sent;
        assert.equal(await page.evaluate(() => window.kumonLeaveGuard.readState().busy), true);
        assert.equal(await beforeUnload(page), true);
        release(); f.config.hold = null;
        await page.waitForFunction(() => document.getElementById('statusLine').textContent.includes('Synthetic save failure'));
        assert.equal(await beforeUnload(page), true);
        assert.equal(await page.locator('#atScore').inputValue(), '80');
        f.config.fail = false; await page.locator('#atSaveButton').click();
        await page.waitForFunction(() => document.getElementById('atModal').classList.contains('hidden') && !window.kumonLeaveGuard.readState().busy);
        assert.equal(await beforeUnload(page), false); assert.equal(f.writes().length, 2); assert.deepEqual(f.errors, []);
    } finally { release?.(); await f.close(); }
});

test('Leaving an unresolved DO explains that navigation does not cancel the submitted operation', ui, async () => {
    const f = await fixture('stock-receive', false);
    try {
        await f.change(); await f.page.locator('#doForm [name=doNo]').fill('UNRESOLVED');
        f.config.fail = true; f.config.retrySafe = false;
        await f.page.locator('#saveDoButton').click();
        await f.page.waitForFunction(() => document.getElementById('statusLine').textContent.includes('Synthetic save failure'));
        assert.equal(await f.page.evaluate(() => window.kumonLeaveGuard.readState().uncertain), true);
        await f.page.locator('.app-menu-toggle').click();
        await f.page.getByRole('button', { name: 'จัดการ', exact: true }).click();
        await f.page.locator('a.home-link[href="/payment.html"]').first().click();
        assert.match(await f.page.locator('#appDialogMessage').innerText(), /ไม่ยกเลิกคำขอเดิม/);
        await f.choose(false);
        assert.equal(f.writes().length, 1); assert.equal(await f.field.inputValue(), '5');
        assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
});

test('An older desktop loading new web files retains menu protection without silently blocking native close', ui, async () => {
    const f = await fixture('student-manager', false);
    try {
        await f.page.addInitScript(() => { window.kumonDesktop = { info: async () => ({ embedded: true, unified: true }) }; });
        await f.page.reload();
        await f.page.waitForFunction(() => document.querySelector('#studentForm [name=firstName]')?.value === 'Fixture');
        await f.change();
        assert.equal(await beforeUnload(f.page), false, 'The old host has no way to confirm Electron unload');
        assert.equal(await f.page.evaluate(() => window.kumonLeaveGuard.readState().dirty), true);
        await f.page.locator('.app-menu-toggle').click();
        await f.page.getByRole('button', { name: 'จัดการ', exact: true }).click();
        await f.page.locator('a.home-link[href="/payment.html"]').first().click();
        await f.choose(false);
        assert.equal(await f.field.inputValue(), 'Unsaved'); assert.equal(f.writes().length, 0); assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
});

test('A transient desktop info failure never disables close protection and retries after page load', ui, async () => {
    const f = await fixture('student-manager', false);
    try {
        await f.page.addInitScript(() => {
            window.fixtureInfoCalls = 0;
            window.kumonDesktop = { info: async () => {
                if (++window.fixtureInfoCalls === 1) throw Error('Synthetic provisional frame');
                return { embedded: true, unified: true, leaveConfirmation: true };
            } };
        });
        await f.page.reload();
        await f.page.waitForFunction(() => window.fixtureInfoCalls >= 2 && document.querySelector('#studentForm [name=firstName]')?.value === 'Fixture');
        await f.change();
        assert.equal(await beforeUnload(f.page), true);
        assert.equal(f.writes().length, 0); assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
});
