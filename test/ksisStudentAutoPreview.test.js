import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mainDesktop } from '../services/appDesktop.js';
import { previewKsisStudentInApp, withKsisPage, withKsisWorkspacePage, openKsisDesktop } from '../services/ksisStudentService.js';

const sourceUrl = 'https://kao.ksis.kumon.com/kth/#/student/11111111-1111-4111-8111-111111111111';
let nextUser = 880100;
function fixture(t, { currentUrl = 'https://kao.ksis.kumon.com/kth/#/login', dirty = false, loaded = true } = {}) {
    const visits = [], toggles = []; let opens = 0, reads = 0;
    const application = new EventEmitter();
    const state = { url: currentUrl, dirty, loaded };
    const page = { isClosed: () => false, url: () => state.url,
        goto: async url => { visits.push(url); state.url = url; },
        evaluate: async reader => {
            if (reader.name === 'readKsisStudentDocument') { reads++; return { firstName: 'ตัวอย่าง', lastName: 'ทดสอบ', birthDate: '24/07/2562' }; }
            return reader.toString().includes("getElementById('firstName')") ? state.loaded : state.dirty;
        }
    };
    const remote = { unified: true, application, context: {}, page, focus: async () => {}, isActive: async () => true };
    const app = { origin: 'http://localhost:3000', main: { url: () => 'http://localhost:3000/student-manager.html' },
        assertAppSession: async () => {}, activateAccount: async options => { opens++; assert.equal(options.initialUrl, sourceUrl); return remote; },
        setStudentPreview: async value => { toggles.push(value); }
    };
    t.mock.method(mainDesktop, 'current', () => app);
    t.after(() => application.emit('close'));
    const options = { userId: ++nextUser, previewId: randomUUID(), origin: app.origin, cookieHeader: 'kumondb.sid=fixture-only', url: sourceUrl };
    return { options, app, page, state, visits, toggles, opens: () => opens, reads: () => reads,
        run: (action, extra = {}) => previewKsisStudentInApp({ ...options, action, ...extra }) };
}

test('Preview opens the same embedded page, waits through manual login without reloading, resumes automatically and only returns data', async t => {
    const f = fixture(t);
    assert.equal((await f.run('start')).phase, 'login'); assert.equal(f.opens(), 1);
    for (let i = 0; i < 3; i++) assert.equal((await f.run('poll')).phase, 'login');
    assert.deepEqual(f.visits, []); assert.equal(f.reads(), 0);
    await assert.rejects(withKsisWorkspacePage({ userId: f.options.userId, sourceUrl }, () => assert.fail('A competing WS/AT task must not run')), { statusCode: 409 });
    f.state.url = 'https://kao.ksis.kumon.com/kth/#/home';
    const result = await f.run('poll');
    assert.equal(result.phase, 'ready'); assert.equal(result.student.birthDate, '2019-07-24');
    assert.deepEqual(f.visits, [sourceUrl]); assert.equal(f.reads(), 1); assert.equal(f.opens(), 1);
    assert.deepEqual(f.toggles.map(value => value.enabled), [true, false]);
    await withKsisWorkspacePage({ userId: f.options.userId, sourceUrl, navigate: false }, () => {});
});

test('An already authenticated preview returns immediately and does not navigate a loaded form', async t => {
    const f = fixture(t, { currentUrl: sourceUrl });
    assert.equal((await f.run('start')).phase, 'ready'); assert.deepEqual(f.visits, []);
});

test('Preview cancellation, wrong tokens and account isolation cannot consume another preview or continue reading', async t => {
    const f = fixture(t); await f.run('start');
    await f.run('cancel', { previewId: randomUUID() });
    assert.equal((await f.run('poll')).phase, 'login');
    await assert.rejects(f.run('poll', { userId: ++nextUser }), { statusCode: 410 });
    await f.run('cancel');
    await assert.rejects(f.run('poll'), { statusCode: 410 });
    assert.equal(f.reads(), 0); assert.equal(f.toggles.at(-1).enabled, false);
});

test('A changed source page or real dirty KSIS form blocks navigation and releases preview ownership', async t => {
    const f = fixture(t, { currentUrl: 'https://kao.ksis.kumon.com/kth/#/reportbeditgrid', dirty: true });
    await assert.rejects(f.run('start'), { statusCode: 409 }); assert.deepEqual(f.visits, []);
    f.state.dirty = false; f.state.url = sourceUrl; f.state.loaded = false;
    assert.equal((await f.run('start')).phase, 'reading');
    f.state.url = sourceUrl.replace('11111111-', '22222222-');
    await assert.rejects(f.run('poll'), { statusCode: 409 }); assert.deepEqual(f.visits, []);
});

test('Pending WS/AT drafts and mismatched app sessions are rejected before opening or reading a student', async t => {
    const f = fixture(t, { currentUrl: sourceUrl });
    await openKsisDesktop({ ...f.options, initialUrl: sourceUrl });
    await withKsisPage({ userId: f.options.userId, sourceUrl, navigate: false }, async (_page, session) => { session.pendingDraft = true; session.pendingAt = {}; });
    await assert.rejects(f.run('start'), { statusCode: 409 }); assert.equal(f.opens(), 1); assert.deepEqual(f.toggles, []);
    const other = fixture(t); other.app.assertAppSession = async () => { throw Object.assign(Error('Different app account'), { statusCode: 409 }); };
    await assert.rejects(other.run('start'), { statusCode: 409 }); assert.equal(other.opens(), 0);
});

test('Preview expiry and cancellation during opening release the lock and never show a cancelled pane', async t => {
    const f = fixture(t); await f.run('start');
    const now = Date.now(); t.mock.method(Date, 'now', () => now + 6 * 60000);
    await assert.rejects(f.run('poll'), { statusCode: 408 }); assert.equal(f.toggles.at(-1).enabled, false);
    t.mock.restoreAll();
    const next = fixture(t); let release;
    const activate = next.app.activateAccount;
    next.app.activateAccount = async options => { await new Promise(resolve => { release = resolve; }); return activate(options); };
    const starting = next.run('start');
    await new Promise(resolve => setImmediate(resolve)); await next.run('cancel'); release();
    await assert.rejects(starting, { statusCode: 409 });
    assert.equal(next.toggles.some(value => value.enabled), false); assert.equal(next.reads(), 0);
});

test('Leaving or reloading the main page cancels Preview even when a client cancellation cannot be delivered', async t => {
    const f = fixture(t), main = new EventEmitter(), frame = {};
    main.url = f.app.main.url; main.mainFrame = () => frame; f.app.main = main;
    await f.run('start'); assert.equal(main.listenerCount('framenavigated'), 1);
    main.emit('framenavigated', {}); assert.equal((await f.run('poll')).phase, 'login');
    main.emit('framenavigated', frame); await new Promise(resolve => setImmediate(resolve));
    await assert.rejects(f.run('poll'), { statusCode: 410 });
    assert.equal(main.listenerCount('framenavigated'), 0); assert.equal(f.reads(), 0);
});
