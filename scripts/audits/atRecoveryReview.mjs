// Review-only, pure Node evidence. No browser, sockets, database or dotenv imports.
// Run: node scripts/audits/atRecoveryReview.mjs
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mock } from 'node:test';

const root = new URL('../../', import.meta.url);
const output = new URL('test/reviews/2026-11-24/at-recovery-evidence.json', root);
const actualPaths = [
  'services/ksisAtEntry.js', 'services/ksisStudentService.js',
  'services/ksisReportDraft.js', 'services/ksisReportIdentity.js',
  'services/ksisStudentData.js', 'services/kumonStudentId.js', 'services/httpError.js'
];
const limits = {
  endToEnd: false, browserUsed: false, networkUsed: false, databaseUsed: false,
  proves: [
    'Actual exported AT guard decisions against in-memory request/route doubles after handoff.',
    'Actual exported acknowledgeKsisAt through actual withKsisWorkspacePage/withKsisPage, using a mock desktop, page and session.'
  ],
  doesNotProve: [
    'Actual session expiry, the real KSIS login endpoint, HTTP middleware, renderer controls or user clicks.',
    'A browser-to-server-to-KSIS end-to-end deadlock, persistence or successful real recovery.',
    'DOM execution: mockPage.evaluate records calls and supplies explicit fixture values; it never executes callbacks.',
    'Pending AT is injected through an exported workspace callback, not created by a real fill/save failure.'
  ]
};
let running = false;

export async function runAtRecoveryReview() {
  if (running) throw new Error('Concurrent review runs in one process are not supported');
  running = true;
  const checks = [], overrides = [];
  let hooks, application;
  const evidence = { schemaVersion: 1, generatedAt: new Date().toISOString(),
    status: 'running', interpretation: 'Passing checks reproduce the stated current behavior, including recovery rejection; they do not mean recovery works.',
    ...limits, checks };
  const forbid = (operation) => { throw new Error(`Review boundary refused: ${operation}`); };
  const override = (object, method, implementation) => {
    const replacement = mock.method(object, method, implementation);
    overrides.push(() => replacement.mock.restore());
    return replacement;
  };
  try {
    if (typeof registerHooks !== 'function') throw new Error('Node with module.registerHooks is required');
    // Module-loader replacements stop dependency traversal BEFORE reportService
    // can import config/db.js (which calls dotenv.config at module initialization).
    // Production AT, recovery and wrapper sources are loaded intact, never sliced/eval'd.
    const tag = randomUUID();
    const actual = new Set(actualPaths.map(relative => new URL(relative, root).href));
    const stubs = new Map([
      [new URL('services/reportService.js', root).href,
        "export function buildMonthlyReport(){throw new Error('Report/DB access forbidden')} export function periodDateRange(){throw new Error('Report access forbidden')}"],
      [new URL('services/ksisDesktop.js', root).href,
        "export const reviewDesktopBoundary={create(){throw new Error('Desktop access forbidden')}}; export async function createKsisDesktop(options){return reviewDesktopBoundary.create(options)}; export function desktopAppCookie(){throw new Error('Cookie access forbidden')}"],
      [new URL('services/appDesktop.js', root).href,
        'export const mainDesktop={current:()=>null};'],
      ['review:playwright-core',
        "export const chromium={launchPersistentContext(){throw new Error('Browser access forbidden')}};"]
    ]);
    const loadedActual = new Set(), loadedStubs = new Set();
    const tagged = url => { const value = new URL(url); value.searchParams.set('atRecoveryReview', tag); return value.href; };
    const inReview = url => Boolean(url && new URL(url).searchParams.get('atRecoveryReview') === tag);
    const canonical = url => { const value = new URL(url); value.search = ''; value.hash = ''; return value.href; };
    hooks = registerHooks({
      resolve(specifier, context, nextResolve) {
        if (!inReview(context.parentURL) && !inReview(specifier.startsWith('file:') ? specifier : undefined)) return nextResolve(specifier, context);
        if (['node:crypto', 'node:os', 'node:path'].includes(specifier)) return nextResolve(specifier, context);
        if (specifier === 'playwright-core') return { url: tagged('review:playwright-core'), shortCircuit: true };
        if (!specifier.startsWith('.') && !specifier.startsWith('file:')) return forbid(`import ${specifier}`);
        const url = canonical(new URL(specifier, context.parentURL).href);
        if (!actual.has(url) && !stubs.has(url)) return forbid(`import ${url}`);
        return { url: tagged(url), shortCircuit: true };
      },
      load(url, context, nextLoad) {
        if (!inReview(url)) return nextLoad(url, context);
        const key = canonical(url);
        if (stubs.has(key)) {
          loadedStubs.add(key);
          return { format: 'module', source: stubs.get(key), shortCircuit: true };
        }
        if (!actual.has(key)) return forbid(`load ${key}`);
        loadedActual.add(key);
        return nextLoad(url, context);
      }
    });
    override(globalThis, 'fetch', () => forbid('global fetch'));
    const at = await import(tagged(new URL('services/ksisAtEntry.js', root).href));
    const workspace = await import(tagged(new URL('services/ksisStudentService.js', root).href));
    const { reviewDesktopBoundary } = await import(tagged(new URL('services/ksisDesktop.js', root).href));
    assert.equal(loadedStubs.size, 4, 'All unsafe dependency boundaries must be replaced');

    const evaluations = [], fixtures = [], routes = new Map();
    let currentUrl = at.KSIS_AT_URL, navigationAttempts = 0, waitCalls = 0;
    const page = {
      url: () => currentUrl,
      isClosed: () => false,
      route: async (pattern, handler) => { assert.equal(pattern, '**/*'); routes.set(handler, pattern); },
      unroute: async (pattern, handler) => { assert.equal(routes.get(handler), pattern); routes.delete(handler); },
      evaluate: async callback => {
        const fixture = fixtures.shift();
        assert.ok(fixture, 'Unexpected page.evaluate call');
        if (fixture.document) assert.equal(callback, at.readKsisAtDocument, 'Only the actual exported document reader is fixture-matched');
        else assert.equal(typeof callback, 'function');
        evaluations.push(fixture.purpose);
        return structuredClone(fixture.value);
      },
      waitForFunction: async () => { waitCalls++; }, // No DOM callback execution.
      goto: async () => { navigationAttempts++; return forbid('page navigation'); },
      bringToFront: async () => forbid('unexpected separate browser focus'),
      locator: () => forbid('DOM interaction')
    };
    const inject = (purpose, value, document = false) => fixtures.push({ purpose, value, document });
    const probe = async (method, url) => {
      assert.equal(routes.size, 1, 'An installed actual guard must receive the synthetic request');
      const decisions = [];
      const request = { method: () => method, url: () => url, resourceType: () => 'xhr',
        postDataJSON: () => forbid('unexpected payload access'), response: () => forbid('unexpected response access') };
      const route = { request: () => request,
        abort: reason => decisions.push({ action: 'abort', reason }),
        fallback: () => decisions.push({ action: 'fallback' }) // In-memory decision only, never a transport.
      };
      await [...routes.keys()][0](route);
      assert.equal(decisions.length, 1);
      return decisions[0];
    };
    const guard = await at.installKsisAtGuard(page);
    inject('handoff callback recorded without DOM execution', undefined);
    await guard.handoff();
    const loginUrl = new URL('/kth/api/login', at.KSIS_AT_URL).href;
    const loginDecision = await probe('POST', loginUrl);
    assert.deepEqual(loginDecision, { action: 'abort', reason: 'blockedbyclient' });
    assert.equal(guard.blocked(), 1); assert.equal(guard.writes(), 0);
    checks.push({ id: 'guard-post-login-after-handoff', passed: true, layer: 'actual exported guard / mock request-route',
      loginTarget: loginUrl, loginTargetIsSynthetic: true,
      observed: { ...loginDecision, blocked: guard.blocked(), authorizedWrites: guard.writes() } });

    const readUrl = new URL('/kth/api/reportb/GetReportBTestResultEntryListPageByCriteria', at.KSIS_AT_URL).href;
    assert.deepEqual(await probe('POST', readUrl), { action: 'fallback' });
    assert.deepEqual(await probe('GET', loginUrl), { action: 'fallback' });
    checks.push({ id: 'guard-positive-read-controls', passed: true,
      layer: 'actual exported guard / mock request-route', observed: 'Allowlisted POST read and GET fall back to an in-memory stub; no network request is sent.' });

    application = new EventEmitter();
    const desktop = { application, page, context: {}, focus: async () => {} };
    override(reviewDesktopBoundary, 'create', async () => desktop);
    const userId = 987605;
    // This public API installs a mock desktop, not a browser. The exported
    // workspace callback is the only seam used to obtain/inject its session.
    await workspace.openKsisDesktop({ userId, origin: 'https://at-recovery-review.invalid', cookieHeader: '' });
    let session;
    await workspace.withKsisWorkspacePage({ userId, sourceUrl: at.KSIS_AT_URL }, async (actualPage, actualSession) => {
      assert.equal(actualPage, page); session = actualSession;
      session.pendingDraft = true; session.pendingAt = true; session.draftGuard = guard;
    });
    currentUrl = new URL('#/login', at.KSIS_AT_URL).href;
    const evaluationsBeforeLogin = evaluations.length;
    let rejection;
    await assert.rejects(at.acknowledgeKsisAt({ userId }), error => {
      rejection = { statusCode: error.statusCode, message: error.message };
      return error.statusCode === 409 && /หน้า KSIS เปลี่ยนหลัง Preview/.test(error.message);
    });
    assert.equal(evaluations.length, evaluationsBeforeLogin, 'Wrapper rejects before document inspection');
    assert.equal(waitCalls, 0); assert.equal(navigationAttempts, 0);
    assert.equal(session.pendingDraft, true); assert.equal(session.pendingAt, true);
    assert.equal(session.draftGuard, guard); assert.equal(session.busy, false); assert.equal(routes.size, 1);
    checks.push({ id: 'acknowledge-from-login-rejected', passed: true,
      layer: 'actual exported acknowledgeKsisAt + actual workspace/page wrappers / mock desktop-session',
      observed: { ...rejection, pendingDraft: true, pendingAt: true, guardStillInstalled: true,
        documentRead: false, navigationAttempts } });

    currentUrl = at.KSIS_AT_URL;
    const document = { modalOpen: false, hiddenDirty: false, students: [{ tests: [{ dirty: true }] }] };
    inject('dirty AT document', document, true);
    await assert.rejects(at.acknowledgeKsisAt({ userId }), error => error.statusCode === 409 && /AT แก้ค้าง/.test(error.message));
    assert.equal(session.pendingDraft, true); assert.equal(routes.size, 1);
    checks.push({ id: 'acknowledge-dirty-at-remains-pending', passed: true,
      layer: 'actual exported acknowledgeKsisAt + actual wrappers / fixture document',
      observed: 'Dirty AT is rejected and the pending session/guard remain.' });

    document.students[0].tests[0].dirty = false;
    inject('clean AT document', document, true);
    inject('guard release callback recorded without DOM execution', undefined);
    assert.deepEqual(await at.acknowledgeKsisAt({ userId }), { acknowledged: true });
    assert.equal(session.pendingDraft, false); assert.equal(session.pendingAt, false);
    assert.equal(session.draftGuard, null); assert.equal(routes.size, 0);
    assert.equal(fixtures.length, 0); assert.equal(navigationAttempts, 0);
    checks.push({ id: 'acknowledge-clean-at-positive-control', passed: true,
      layer: 'actual exported acknowledgeKsisAt + actual wrappers / fixture document',
      observed: 'Clean AT acknowledgement succeeds, releases the installed guard and clears pending flags.' });

    evidence.sources = await Promise.all(actualPaths.map(async relative => ({ path: relative,
      sha256: createHash('sha256').update(await readFile(new URL(relative, root))).digest('hex') })));
    evidence.boundaries = { moduleIsolation: 'Unique per-run module URLs; exact dependency allowlist; unsafe modules replaced before traversal.',
      actualModulesLoaded: [...loadedActual].map(url => path.relative(fileURLToPath(root), fileURLToPath(url)).replaceAll('\\', '/')).sort(),
      replacedDependencies: ['reportService.js (Report/DB)', 'ksisDesktop.js (desktop factory)', 'appDesktop.js (current desktop)', 'playwright-core'],
      forbiddenDependencies: ['dotenv', 'pg', 'config/db.js', 'unlisted modules and network builtins'],
      domCallbacksExecuted: 0, mockedEvaluationCalls: evaluations, authorizedGuardWrites: guard.writes() };
    evidence.status = 'verified_expected_current_behavior';
    return evidence;
  } finally {
    application?.emit('close');
    for (const restore of overrides.reverse()) restore();
    hooks?.deregister();
    running = false;
  }
}

async function writeEvidence(evidence) {
  const rootPath = fileURLToPath(root);
  // Reject linked output parents/target, so this script only writes its named artifact.
  const relative = path.relative(rootPath, fileURLToPath(output));
  let current = rootPath;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error('Linked evidence path refused'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  await mkdir(new URL('./', output), { recursive: true });
  await writeFile(output, JSON.stringify(evidence, null, 2) + '\n', 'utf8');
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  let evidence;
  try { evidence = await runAtRecoveryReview(); }
  catch (error) {
    process.exitCode = 1;
    evidence = { schemaVersion: 1, generatedAt: new Date().toISOString(), status: 'failed',
      ...limits, error: { name: error.name, message: error.message } };
  }
  await writeEvidence(evidence);
  process.stdout.write(JSON.stringify(evidence, null, 2) + '\n');
}
