import assert from 'node:assert/strict';
import { test } from 'node:test';
import { controlFixture } from './support/controlFixture.js';

const ui = { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 25000 };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const summary = { billingMonth: 10, billingYear: 2026, usedDays: 1, cpwsRecords: 0 };
const context = id => ({ enrollment: { enrollmentId: id, studentName: `Student ${id}`, subjectId: 1, subjectCode: 'ME',
  currentLevelMasterId: id * 10, currentLevelCode: 'C', currentZunLevelMasterId: id * 20, currentZunLevelCode: 'ZI' },
  studentEnrollments: [], defaults: { receiveDate: '2026-10-30', patternCode: 'daily10', mainWorksheetNo: 101 },
  patterns: [{ code: 'daily10', shortLabel: '10/day', manualCount: 1, suffixes: [1], dayOffsets: [0] }],
  worksheetOptions: { main: [{ worksheetNo: 101 }], zun: [] }, history: [], worksheetMonthSummary: summary,
  completionState: { atCompletion: { canComplete: true, bypassWorksheet191: true, atMasterId: id * 100, maxScore: 100, maxTime: 10 },
    zunCompletion: { canComplete: true } } });
const load = (page, id) => page.evaluate(async id => { await (await import('/js/worksheet/worksheet.js')).loadEnrollmentContext(id); }, id);

for (const embedded of [false, true]) test(`New levels start at WS 1 after passing; failures, historical edits and final levels keep their inputs (${embedded ? 'desktop' : 'browser'})`, { ...ui, timeout: 35000 }, async () => {
  let scenario = 'advance', completed = false;
  const f = await controlFixture('worksheet', async (req, res) => {
    if (req.path === '/worksheet/enrollments/1/context') {
      const value = context(1);
      const advanced = scenario === 'edit' || completed && ['advance', 'free'].includes(scenario);
      value.enrollment.currentLevelMasterId = advanced ? 11 : 10;
      value.enrollment.currentLevelCode = advanced ? 'D' : 'C';
      value.worksheetOptions.main = [1, 101, 191].map(worksheetNo => ({ worksheetNo }));
      value.worksheetOptions.zun = [1, 21].map(worksheetNo => ({ worksheetNo }));
      value.defaults.zunWorksheetNo = 21;
      if (scenario === 'edit') value.completionState.latestAtCompletion = { atUsedId: 77, atMasterId: 100, levelMasterId: 10,
        levelCode: 'C', atDate: '2026-10-20', score: 80, usedTime: 5, atGroup: 1, isPass: true, maxScore: 100, maxTime: 10 };
      if (scenario === 'free') {
        value.completionState.atCompletion.canComplete = false;
        value.completionState.freeLevelCompletion = { canComplete: true, currentLevelMasterId: 10, currentLevelCode: 'C', nextLevelCode: 'D' };
      }
      res.json(value); return true;
    }
    if (req.path.endsWith('/worksheet-summary')) { res.json({ success: true, worksheetMonthSummary: summary }); return true; }
    if (['/worksheet/at-completion', '/worksheet/level-completion'].includes(req.path)) {
      completed = true;
      assert.equal(req.body.enrollmentId, 1);
      if (scenario === 'edit') assert.equal(req.body.atUsedId, 77);
      res.json({ success: true, enrollmentId: 1, levelMasterId: 10, isPass: scenario !== 'fail',
        nextLevelMasterId: scenario === 'final' ? null : 11, previousLevelCode: 'C', nextLevelCode: 'D' }); return true;
    }
    return false;
  }, { embedded });
  try {
    const { page } = f, main = page.locator('[data-ws-input][data-kind=main]').first();
    for (const name of ['advance', 'fail', 'edit', 'final', 'free']) {
      scenario = name; completed = false; await load(page, 1);
      await page.waitForFunction(() => document.activeElement?.matches('[data-ws-input][data-kind=main]'));
      assert.equal(await main.inputValue(), '101');
      const zunBefore = await page.locator('[data-ws-input][data-kind=zun]').first().inputValue();
      const requestIdBeforeCompletion = await page.evaluate(async () => (await import('/js/worksheet/worksheetState.js')).state.contextRequestId);
      const completionResponse = page.waitForResponse(response => response.request().method() === 'POST'
        && response.url().endsWith(name === 'free' ? '/worksheet/level-completion' : '/worksheet/at-completion'));
      if (name === 'free') {
        await page.evaluate(() => { void import('/js/worksheet/worksheetAt.js').then(at => at.completeWorksheetLevelWithoutAt()); });
        await f.choose(true);
      } else {
        if (name === 'edit') await page.evaluate(async () => (await import('/js/worksheet/worksheetAt.js')).openAtModal({ editLatest: true }));
        else await page.locator('#completeWsLevel').click();
        await page.waitForFunction(() => document.activeElement?.id === 'atScore');
        await page.locator('#atScore').fill('80'); await page.locator('#atTime').fill('5');
        if (name === 'fail') await page.locator('[data-at-pass=false]').click();
        await page.locator('#atSaveButton').click();
      }
      await (await completionResponse).finished();
      await page.waitForFunction(async requestIdBeforeCompletion => {
        const { state } = await import('/js/worksheet/worksheetState.js');
        // The previous scenario's success text can remain visible until the
        // POST continuation starts its refresh. Wait for this refresh too.
        return state.contextRequestId > requestIdBeforeCompletion && !state.isLoadingContext && !state.isCompletingLevel && /บันทึก AT|จบ C แล้ว/.test(document.getElementById('statusLine').textContent)
          && document.getElementById('atModal').classList.contains('hidden');
      }, requestIdBeforeCompletion);
      const observed = await page.evaluate(async () => {
        const { state } = await import('/js/worksheet/worksheetState.js');
        return { defaults: state.context.defaults, level: state.context.enrollment.currentLevelMasterId,
          status: document.getElementById('statusLine').textContent };
      });
      assert.equal(await main.inputValue(), ['advance', 'free'].includes(name) ? '1' : '101', `${name}: ${JSON.stringify(observed)}`);
      assert.equal(await page.locator('#receiveDate').inputValue(), '2026-10-30');
      assert.equal(await page.locator('[data-ws-input][data-kind=zun]').first().inputValue(), zunBefore);
      assert.equal(await page.evaluate(async () => (await import('/js/worksheet/worksheetState.js')).state.context.defaults.zunWorksheetNo), 21);
    }
    assert.equal(f.writes().length, 5); assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

async function start(page, kind) {
  await load(page, 1);
  await page.waitForFunction(() => document.activeElement?.matches('[data-ws-input][data-kind=main]'));
  if (kind === 'at') {
    await page.locator('#completeWsLevel').click();
    await page.waitForFunction(() => document.activeElement?.id === 'atScore');
    await page.locator('#atScore').fill('80'); await page.locator('#atTime').fill('5');
    await page.locator('#atSaveButton').click();
  } else {
    await page.evaluate(async () => {
      (await import('/js/worksheet/worksheetState.js')).state.progressKind = 'zun';
      (await import('/js/worksheet/worksheetPreview.js')).updateSecondaryActions();
    });
    await page.locator('#completeZunLevel').click();
  }
}
async function fixture(kind, { fail = false, holdNavigation = false, holdRefresh = false } = {}) {
  const started = deferred(), release = deferred(), navigationStarted = deferred(), releaseNavigation = deferred(), refreshStarted = deferred(), releaseRefresh = deferred();
  let firstLoads = 0, reject = fail;
  const endpoint = `/worksheet/${kind === 'at' ? 'at-completion' : 'zun-completion'}`;
  const f = await controlFixture('worksheet', async (req, res) => {
    const match = req.path.match(/enrollments\/(\d+)\/context/);
    if (match) {
      const id = Number(match[1]);
      if (id === 1 && ++firstLoads > 1 && holdRefresh) { refreshStarted.resolve(); await releaseRefresh.promise; }
      if (id === 2 && holdNavigation) { navigationStarted.resolve(); await releaseNavigation.promise; }
      res.json(context(id)); return true;
    }
    if (req.path.endsWith('/worksheet-summary')) { res.json({ success: true, worksheetMonthSummary: summary }); return true; }
    if (req.path === endpoint) {
      started.resolve(); await release.promise;
      if (reject) res.status(409).json({ success: false, error: 'OLD completion rejected' });
      else res.json({ success: true, enrollmentId: 1, isPass: true, nextLevelMasterId: 11, nextZunLevelCode: 'ZII' });
      return true;
    }
  });
  const wait = signal => Promise.race([signal.promise, new Promise((_, reject) => {
    const timer = setTimeout(() => reject(Error('Synthetic fixture request did not arrive')), 5000); timer.unref();
  })]);
  return { ...f, endpoint, started, release, navigationStarted, releaseNavigation, refreshStarted, releaseRefresh, wait,
    allowRetry: () => { reject = false; },
    close: async () => { release.resolve(); releaseNavigation.resolve(); releaseRefresh.resolve(); await f.close(); } };
}

for (const kind of ['at', 'zun']) for (const fail of [false, true]) test(`${kind.toUpperCase()} ignores a late ${fail ? 'failure' : 'success'} after another student loads`, ui, async () => {
  const f = await fixture(kind, { fail });
  try {
    await start(f.page, kind); await f.wait(f.started);
    if (kind === 'at') {
      assert.equal(await f.page.locator('#atDate').isDisabled(), true);
      assert.equal(await f.page.locator('#atScore').isDisabled(), true);
      assert.equal(await f.page.locator('#atCancel').isDisabled(), true);
      await f.page.locator('#atForm').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      await f.page.evaluate(async () => {
        const at = await import('/js/worksheet/worksheetAt.js'); at.setAtPass(false); at.changeAtGroup(1); at.closeAtModal();
        at.openAtModal({ editLatest: true });
      });
      assert.equal(await f.page.locator('#atGroup').inputValue(), '1');
      assert.equal(await f.page.locator('#atModal').isVisible(), true);
      assert.deepEqual(f.writes()[0].body, { enrollmentId: 1, atUsedId: null, expectedAtMasterId: 100, expectedLevelMasterId: 10,
        atDate: '2026-10-30', score: 80, usedTime: 5, atGroup: 1, isPass: true });
    } else {
      await f.page.evaluate(async () => (await import('/js/worksheet/worksheetAt.js')).completeZunLevel());
      assert.deepEqual(f.writes()[0].body, { enrollmentId: 1, expectedZunLevelMasterId: 20 });
    }
    assert.equal(f.writes().length, 1);
    await load(f.page, 2);
    const status = await f.page.locator('#statusLine').innerText();
    const response = f.page.waitForResponse(response => response.url().endsWith(f.endpoint));
    f.release.resolve(); await (await response).finished();
    if (kind === 'at') await f.page.locator('#atScore:enabled').waitFor();
    else await f.page.waitForFunction(async () => !(await import('/js/worksheet/worksheetState.js')).state.isCompletingZun);
    assert.equal(await f.page.locator('#studentSearch').inputValue(), '#2 Student 2');
    assert.equal(await f.page.locator('#statusLine').innerText(), status);
    assert.equal(f.requests.filter(req => req.path === '/worksheet/enrollments/1/context').length, 1);
    if (kind === 'at') assert.equal(await f.page.locator('#atModal').isVisible(), true, 'A stale response must not close a modal');
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

for (const kind of ['at', 'zun']) test(`${kind.toUpperCase()} respects a newer navigation request even before that student finishes loading`, ui, async () => {
  const f = await fixture(kind, { holdNavigation: true });
  try {
    await start(f.page, kind); await f.wait(f.started);
    await f.page.evaluate(() => { void import('/js/worksheet/worksheet.js').then(module => module.loadEnrollmentContext(2)); });
    await f.wait(f.navigationStarted);
    const response = f.page.waitForResponse(response => response.url().endsWith(f.endpoint));
    f.release.resolve(); await (await response).finished();
    f.releaseNavigation.resolve();
    await f.page.waitForFunction(() => document.getElementById('studentSearch').value === '#2 Student 2');
    assert.equal(f.requests.filter(req => req.path === '/worksheet/enrollments/1/context').length, 1);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('AT failure preserves its form for retry, then closes and refreshes only its own context on success', ui, async () => {
  const f = await fixture('at', { fail: true });
  try {
    await start(f.page, 'at'); await f.wait(f.started); f.release.resolve();
    await f.page.waitForFunction(() => document.getElementById('statusLine').textContent.includes('OLD completion rejected'));
    assert.equal(await f.page.locator('#atModal').isVisible(), true);
    assert.equal(await f.page.locator('#atScore').inputValue(), '80');
    assert.equal(await f.page.locator('#atTime').inputValue(), '5');
    assert.equal(await f.page.locator('#atSaveButton').isEnabled(), true);
    f.allowRetry(); await f.page.locator('#atSaveButton').click();
    await f.page.waitForFunction(() => document.getElementById('statusLine').textContent.includes('บันทึก AT ผ่าน'));
    assert.equal(await f.page.locator('#atModal').isVisible(), false);
    assert.equal(f.writes().length, 2);
    assert.equal(f.requests.filter(req => req.path === '/worksheet/enrollments/1/context').length, 2);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('AT refresh cannot overwrite a newer selection or its status while refresh is pending', ui, async () => {
  const f = await fixture('at', { holdRefresh: true });
  try {
    await start(f.page, 'at'); await f.wait(f.started); f.release.resolve(); await f.wait(f.refreshStarted);
    await load(f.page, 2);
    const status = await f.page.locator('#statusLine').innerText();
    const refresh = f.page.waitForResponse(response => response.url().includes('/enrollments/1/context'));
    f.releaseRefresh.resolve(); await (await refresh).finished();
    await f.page.waitForFunction(() => !document.getElementById('atScore').disabled);
    assert.equal(await f.page.locator('#studentSearch').inputValue(), '#2 Student 2');
    assert.equal(await f.page.locator('#statusLine').innerText(), status);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});
