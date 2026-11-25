import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks } from 'node:module';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

// Same dependency boundary as atRecoveryReview: load the real service/wrappers,
// but refuse DB, browser and network dependencies before they can initialize.
const root = new URL('../', import.meta.url), tag = randomUUID();
const actual = new Set(['ksisAtEntry', 'ksisStudentService', 'ksisReportDraft', 'ksisReportIdentity',
    'ksisStudentData', 'kumonStudentId', 'httpError', 'ksisWorkspaceState'].map(name => new URL(`services/${name}.js`, root).href));
const stubs = new Map([
    [new URL('services/reportService.js', root).href, "export function buildMonthlyReport(){throw Error('DB forbidden')} export function periodDateRange(){throw Error('Report forbidden')}"],
    [new URL('services/ksisDesktop.js', root).href, "export const boundary={}; export async function createKsisDesktop(){return boundary.desktop} export function desktopAppCookie(){throw Error('Cookies forbidden')}"],
    [new URL('services/appDesktop.js', root).href, 'export const mainDesktop={current:()=>null};'],
    ['fixture:playwright-core', "export const chromium={launchPersistentContext(){throw Error('Browser forbidden')}};"]
]);
const tagged = value => { const url = new URL(value); url.searchParams.set('atRecoveryTest', tag); return url.href; };
const inTest = value => value?.includes(`atRecoveryTest=${tag}`);
const hooks = registerHooks({
    resolve(specifier, context, next) {
        if (!inTest(context.parentURL) && !inTest(specifier)) return next(specifier, context);
        if (['node:crypto', 'node:os', 'node:path'].includes(specifier)) return next(specifier, context);
        if (specifier === 'playwright-core') return { url: tagged('fixture:playwright-core'), shortCircuit: true };
        if (!specifier.startsWith('.') && !specifier.startsWith('file:')) throw Error(`Forbidden dependency: ${specifier}`);
        const url = new URL(specifier, context.parentURL); url.search = ''; url.hash = '';
        assert.ok(actual.has(url.href) || stubs.has(url.href), `Unexpected dependency ${url.href}`);
        return { url: tagged(url.href), shortCircuit: true };
    },
    load(value, context, next) {
        if (!inTest(value)) return next(value, context);
        const url = new URL(value); url.search = ''; url.hash = '';
        if (stubs.has(url.href)) return { format: 'module', source: stubs.get(url.href), shortCircuit: true };
        assert.ok(actual.has(url.href)); return next(value, context);
    }
});
let at, workspace, state, boundary;
try {
    at = await import(tagged(new URL('services/ksisAtEntry.js', root)));
    workspace = await import(tagged(new URL('services/ksisStudentService.js', root)));
    state = await import(tagged(new URL('services/ksisWorkspaceState.js', root)));
    ({ boundary } = await import(tagged(new URL('services/ksisDesktop.js', root))));
} finally { hooks.deregister(); }

const loginUrl = new URL('#/login', at.KSIS_AT_URL).href;
const saveUrl = new URL('api/reportb/SaveReportBTestResultEntryEditItemBatch', at.KSIS_AT_URL).href;
const clean = () => ({ modalOpen: false, hiddenDirty: false, students: [{ tests: [{ dirty: false }] }] });
let nextUser = 987700;
async function fixture(t, { handoff = true } = {}) {
    const f = { userId: nextUser++, url: at.KSIS_AT_URL, document: clean(), routes: new Set(), reloads: 0, manualSave: false };
    f.page = {
        url: () => f.url, isClosed: () => false,
        route: async (_pattern, handler) => f.routes.add(handler),
        unroute: async (_pattern, handler) => { assert.ok(f.routes.delete(handler)); },
        evaluate: async callback => callback === at.readKsisAtDocument ? structuredClone(f.document) : f.manualSave,
        waitForFunction: async () => {},
        goto: () => assert.fail('Recovery must not navigate to another page'),
        reload: async () => { f.reloads++; assert.equal(f.routes.size, 1, 'Reload is still guarded'); await f.onReload?.(); }
    };
    const application = new EventEmitter();
    boundary.desktop = { application, context: {}, page: f.page, focus: async () => {} };
    await workspace.openKsisDesktop({ userId: f.userId, origin: 'https://at-recovery-test.invalid', cookieHeader: '' });
    t.after(() => application.emit('close'));
    f.guard = await at.installKsisAtGuard(f.page);
    if (handoff) await f.guard.handoff();
    await workspace.withKsisWorkspacePage({ userId: f.userId, sourceUrl: at.KSIS_AT_URL }, async (_page, session) => {
        f.session = session;
        Object.assign(session, { pendingDraft: true, pendingAt: true, draftGuard: f.guard,
            atAttempt: { failedId: '100:0', rows: [{ id: '100:0' }] } });
    });
    await state.runKsisWorkspace(f.userId, 'at', 'fill', {}, async () => ({ pendingDraft: true, saved: ['99:0'], rows: [{ id: '100:0', outcome: 'review' }] }));
    f.ack = () => state.runKsisWorkspace(f.userId, 'at', 'acknowledge', {}, () => at.acknowledgeKsisAt({ userId: f.userId }));
    f.probe = async (url, { method = 'POST', payload = [], response = Promise.resolve(null) } = {}) => {
        assert.equal(f.routes.size, 1);
        let decision;
        await [...f.routes][0]({
            request: () => ({ method: () => method, url: () => url, resourceType: () => 'fetch', postDataJSON: () => payload, response: () => response }),
            abort: () => { decision = 'blocked'; }, fallback: () => { decision = 'allowed'; }
        });
        return decision;
    };
    f.assertPending = () => {
        assert.equal(f.session.pendingDraft, true); assert.equal(f.session.pendingAt, true);
        assert.equal(f.session.draftGuard, f.guard); assert.equal(f.routes.size, 1); assert.equal(f.session.busy, false);
        assert.equal(state.readKsisWorkspace(f.userId).tools.at.pending, true);
    };
    return f;
}

test('AT login recovery uses actual workspace/page wrappers, reloads under guard and retains the unverified attempt', async t => {
    const f = await fixture(t); f.url = loginUrl;
    assert.equal(await f.probe(new URL('api/login', loginUrl).href), 'blocked', 'Synthetic login endpoint is never allowlisted');
    assert.equal(await f.probe(saveUrl), 'blocked');
    assert.equal(await f.probe(new URL('api/reportb/GetReportBTestResultEntryListPageByCriteria', loginUrl).href), 'allowed');
    await assert.rejects(workspace.withKsisWorkspacePage({ userId: f.userId, sourceUrl: at.KSIS_AT_URL }, () => assert.fail()), { statusCode: 409 });
    f.onReload = async () => assert.equal(await f.probe(saveUrl), 'blocked');
    const result = await f.ack();
    assert.equal(result.acknowledged, true); assert.equal(result.requiresLogin, true);
    assert.equal(result.previousResultUnverified, true); assert.equal(result.pendingDraft, false);
    assert.equal(f.reloads, 1); assert.equal(f.routes.size, 0);
    assert.equal(f.session.pendingDraft, false); assert.equal(f.session.pendingAt, false); assert.equal(f.session.draftGuard, null);
    assert.equal(f.session.atAttempt.failedId, '100:0'); assert.equal(f.session.atAttempt.previousResultUnverified, true);
    const tool = state.readKsisWorkspace(f.userId).tools.at;
    assert.equal(tool.pending, false); assert.equal(tool.requiresLogin, true); assert.equal(tool.preview, null);
    assert.deepEqual(tool.result.saved, ['99:0'], 'Save history is retained without claiming the failed row succeeded');
    await assert.rejects(at.applyKsisAt({ userId: f.userId, confirmSave: true, previewId: 'consumed' }), { statusCode: 409 });
    assert.equal(f.guard.writes(), 0);
});

test('AT recovery preserves visible/hidden dirty work and modals on both login and AT grids', async t => {
    for (const url of [loginUrl, at.KSIS_AT_URL]) {
        for (const document of [{ ...clean(), hiddenDirty: true }, { ...clean(), modalOpen: true }, { ...clean(), students: [{ tests: [{ dirty: true }] }] }]) {
            const f = await fixture(t); f.url = url; f.document = document;
            await assert.rejects(f.ack(), { statusCode: 409 });
            f.assertPending(); assert.equal(f.reloads, 0); assert.deepEqual(f.document, document);
        }
    }
});

test('AT recovery refuses foreign, unrelated and deceptive login pages without navigation or unlocking', async t => {
    for (const url of ['https://evil.invalid/kth/#/login', 'http://kao.ksis.kumon.com/kth/#/login',
        'https://kao.ksis.kumon.com/other/#/login', 'https://kao.ksis.kumon.com/kth/?other=1#/login',
        'https://kao.ksis.kumon.com/kth/#/login-elsewhere', 'https://kao.ksis.kumon.com/kth/#/reportbeditgrid']) {
        const f = await fixture(t); f.url = url;
        await assert.rejects(f.ack(), { statusCode: 409 }); f.assertPending(); assert.equal(f.reloads, 0);
    }
});

test('AT recovery keeps its guard and pending state after reload failure, page change or newly dirty work', async t => {
    for (const onReload of [() => { throw Error('Synthetic reload failure'); },
        f => { f.url = at.KSIS_AT_URL; }, f => { f.document.hiddenDirty = true; }]) {
        const f = await fixture(t); f.url = loginUrl; f.onReload = () => onReload(f);
        await assert.rejects(f.ack()); f.assertPending(); assert.equal(f.reloads, 1);
        assert.equal(await f.probe(saveUrl), 'blocked');
    }
});

test('AT recovery waits for an active manual save and cannot reuse its authorization on login', async t => {
    const f = await fixture(t); f.manualSave = true;
    let finish;
    const response = Promise.resolve({ finished: () => new Promise(resolve => { finish = resolve; }) });
    assert.equal(await f.probe(saveUrl, { response }), 'allowed');
    assert.equal(f.guard.pendingWrites(), 1);
    f.url = loginUrl;
    assert.equal(await f.probe(saveUrl), 'blocked', 'SPA login must not inherit the manual-save flag');
    await assert.rejects(f.ack(), { statusCode: 409 }); f.assertPending(); assert.equal(f.reloads, 0);
    finish(null); await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.guard.pendingWrites(), 0);
    assert.equal((await f.ack()).requiresLogin, true);
});

test('AT recovery cannot unlock while an automated save response is unresolved', async t => {
    const f = await fixture(t, { handoff: false });
    Object.assign(f.document, { context: 'Fixture period', page: 1, subjectLabel: 'Math' });
    f.guard.arm({ key: 'guid-class-0', context: f.document.context, page: 1, subjectLabel: 'Math',
        desired: { date: '2026-10-10', time: 70, score: 0 }, levelCode: 'C', groupCode: '2' });
    let respond;
    const response = new Promise(resolve => { respond = resolve; });
    const payload = [{ studentGuid: 'guid', classId: 'class', testRowId: 0, testTypeCd: 'AT', testGuid: '',
        testDate: '10/10/2026', testCd: 'C', testTime: 70, testScore1: 0, atGroupCd: '2', testResultFlg: true, notes: '' }];
    assert.equal(await f.probe(saveUrl, { payload, response }), 'allowed');
    await f.guard.handoff(); f.url = loginUrl;
    await assert.rejects(f.ack(), { statusCode: 409 }); f.assertPending(); assert.equal(f.reloads, 0);
    respond(null); await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.guard.pendingWrites(), 0);
    const result = await f.ack();
    assert.equal(result.previousResultUnverified, true);
    assert.equal(f.session.atAttempt.lastSave.requestSent, true);
    assert.equal(f.session.atAttempt.lastSave.confirmed, false);
});

test('AT clean-grid acknowledgment still works without reloading, and WS pending cannot be cleared through AT', async t => {
    const f = await fixture(t);
    assert.equal((await f.ack()).acknowledged, true); assert.equal(f.reloads, 0); assert.equal(f.routes.size, 0);
    const ws = await fixture(t); ws.session.pendingAt = false; ws.url = loginUrl;
    await assert.rejects(ws.ack(), { statusCode: 409 });
    assert.equal(ws.session.pendingDraft, true); assert.equal(ws.routes.size, 1); assert.equal(ws.reloads, 0);
});
