import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readKsisWorkspace, runKsisWorkspace, confirmKsisWorkspace } from '../services/ksisWorkspaceState.js';

const input = { month: 10, year: 2026, subject: 'EFL' };
const preview = { previewId: 'shared-preview', period: { month: 10, year: 2026 }, subject: 'EFL', page: 1, rows: [{ id: 'one', key: 'target', requiresIdentityConfirmation: true, outcome: 'ready' }] };
test('KSIS workspace has one authoritative preview per account, survives readers, and clones its output', async () => {
    await runKsisWorkspace(910001, 'at', 'preview', input, async () => preview);
    const first = readKsisWorkspace(910001), second = readKsisWorkspace(910001);
    assert.deepEqual(first, second); assert.equal(first.tools.at.preview.previewId, 'shared-preview');
    first.tools.at.preview.rows[0].id = 'tampered';
    assert.equal(readKsisWorkspace(910001).tools.at.preview.rows[0].id, 'one');
    assert.equal(readKsisWorkspace(910002).tools.at, undefined);
    assert.equal(readKsisWorkspace(910001, second.revision).unchanged, true);
    assert.throws(() => readKsisWorkspace(0), { statusCode: 401 });
});

test('KSIS shared operations serialize before asynchronous preparation and reject stale fills', async () => {
    let release; const wait = new Promise((resolve) => { release = resolve; });
    const operation = runKsisWorkspace(910003, 'at', 'preview', input, async () => { await wait; return preview; });
    assert.equal(readKsisWorkspace(910003).busy, true);
    let ran = false;
    await assert.rejects(runKsisWorkspace(910003, 'at', 'preview', input, async () => { ran = true; }), { statusCode: 409 });
    assert.equal(ran, false); release(); await operation;
    await assert.rejects(runKsisWorkspace(910003, 'at', 'fill', { previewId: 'stale' }, async () => { ran = true; }), { statusCode: 409 });
    assert.equal(ran, false);
});

test('Shared identity confirmations belong to the current preview and are never implicitly accepted', async () => {
    await runKsisWorkspace(910004, 'at', 'preview', input, async () => preview);
    assert.deepEqual(readKsisWorkspace(910004).tools.at.confirmed, []);
    confirmKsisWorkspace(910004, { view: 'at', previewId: preview.previewId, confirmed: ['one'] });
    assert.deepEqual(readKsisWorkspace(910004).tools.at.confirmed, ['one']);
    for (const confirmed of [['fake'], ['one', 'one']]) assert.throws(() => confirmKsisWorkspace(910004, { view: 'at', previewId: preview.previewId, confirmed }), { statusCode: 400 });
    assert.throws(() => confirmKsisWorkspace(910004, { view: 'at', previewId: 'old', confirmed: ['one'] }), { statusCode: 409 });
    await runKsisWorkspace(910004, 'at', 'preview', input, async () => ({ ...preview, previewId: 'new' }));
    assert.deepEqual(readKsisWorkspace(910004).tools.at.confirmed, []);
});

test('Pending AT keeps the saved result and blocks new jobs while permitting read-only inspection without acknowledgement', async () => {
    await runKsisWorkspace(910005, 'at', 'preview', input, async () => preview);
    const result = { pendingDraft: true, saved: [], failedId: 'one', rows: preview.rows };
    await runKsisWorkspace(910005, 'at', 'fill', { previewId: preview.previewId }, async () => result);
    await assert.rejects(runKsisWorkspace(910005, 'at', 'preview', input, async () => assert.fail()), { statusCode: 409 });
    await assert.rejects(runKsisWorkspace(910005, 'draft', 'preview', input, async () => assert.fail()), { statusCode: 409 });
    await assert.rejects(runKsisWorkspace(910005, 'atAudit', 'read', input, async () => assert.fail()), { statusCode: 409 });
    await runKsisWorkspace(910005, 'at', 'inspect', input, async () => ({ readOnly: true, refreshed: false }));
    const state = readKsisWorkspace(910005);
    assert.equal(state.tools.at.pending, true); assert.deepEqual(state.tools.at.result, result);
    assert.equal(state.tools.at.inspection.readOnly, true); assert.equal(state.busy, false);
    await assert.rejects(runKsisWorkspace(910005, 'at', 'inspect', input, async () => { throw Object.assign(new Error('read failed'), { statusCode: 409 }); }), /read failed/);
    assert.equal(readKsisWorkspace(910005).tools.at.pending, true);
});

test('AT audit results use the same per-account workspace without consuming a fill preview', async () => {
    await runKsisWorkspace(910006, 'at', 'preview', input, async () => preview);
    const audit = { readOnly: true, rows: [{ outcome: 'matched' }], counts: { matched: 1 } };
    await runKsisWorkspace(910006, 'atAudit', 'read', input, async () => audit);
    const state = readKsisWorkspace(910006);
    assert.equal(state.activeView, 'atAudit'); assert.deepEqual(state.tools.atAudit.result, audit);
    assert.equal(state.tools.at.preview.previewId, preview.previewId); assert.equal(state.tools.atAudit.pending, false);
    assert.equal(readKsisWorkspace(910007).tools.atAudit, undefined);
});

test('WS inspection unlocks only verified recovery, retains batch results and never revives its consumed preview', async () => {
    const user = 910008, result = { pendingDraft: true, savedCount: 10, rows: [{ key: 'saved', outcome: 'saved' }] };
    await runKsisWorkspace(user, 'draft', 'preview', input, async () => preview);
    await runKsisWorkspace(user, 'draft', 'fill', { previewId: preview.previewId }, async () => result);
    for (const inspection of [{ requiresLogin: true }, { readOnly: true, recovered: false, pendingDraft: true }]) {
        await runKsisWorkspace(user, 'draft', 'inspect', {}, async () => inspection);
        assert.equal(readKsisWorkspace(user).tools.draft.pending, true);
    }
    await assert.rejects(runKsisWorkspace(user, 'draft', 'inspect', {}, async () => { throw new Error('disconnected'); }));
    assert.equal(readKsisWorkspace(user).tools.draft.pending, true);
    await runKsisWorkspace(user, 'draft', 'inspect', {}, async () => ({ readOnly: true, recovered: true, pendingDraft: false }));
    const state = readKsisWorkspace(user);
    assert.equal(state.tools.draft.pending, false); assert.equal(state.tools.draft.preview, null);
    assert.deepEqual(state.tools.draft.result, result); assert.equal(state.busy, false);
    await runKsisWorkspace(user, 'draft', 'preview', input, async () => ({ ...preview, previewId: 'fresh' }));
    assert.equal(readKsisWorkspace(user).tools.draft.inspection, null);
});
