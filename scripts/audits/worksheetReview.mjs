// Synthetic, UI-driven evidence collection. Importing this module does not launch
// a browser. Only runWorksheetReview() (or the direct CLI) starts controlFixture.
// Do not import the .ui.test.js files: that would register/run their node tests.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const defaultOutput = path.join(repositoryRoot, 'test/reviews/2026-11-24/worksheet-evidence.json');
const datePath = '/worksheet/entries/10/date';
const historyPath = '/worksheet/enrollments/1/history';
const summary = { billingMonth: 10, billingYear: 2026, usedDays: 1, cpwsRecords: 1 };

// Shapes/values adapted from worksheetUnifiedSearch.ui.test.js (Thai name/ID),
// worksheetNumberEdit.ui.test.js (editable C101 row + summary), and
// worksheetSubjectColors.ui.test.js (current Zun level 99 / ZI). The daily20
// pattern is the literal contract in services/worksheetService.js, not a fake
// half-filled input: production UI must generate any extra value itself.
const patterns = [
  { code: 'daily20', label: 'วันละ 20 แผ่น', shortLabel: '20/วัน', manualCount: 2, dayOffsets: [0, 0], suffixes: null },
  { code: 'daily10', label: 'วันละ 10 แผ่น', shortLabel: '10/วัน', manualCount: 1, dayOffsets: [0], suffixes: [1] }
];

function enrollment(id = 1, hasZun = false) {
  return { enrollmentId: id, studentId: id, subjectCode: 'ME',
    studentName: id === 512 ? 'นักเรียน หนึ่ง (น้องหนึ่ง)' : 'นักเรียน ทดสอบ (น้องแพร)',
    currentLevelMasterId: 100, currentLevelCode: 'C', statusName: 'Continue',
    currentZunLevelMasterId: hasZun ? 99 : null, currentZunLevelCode: hasZun ? 'ZI' : null,
    isKumonConnect: false };
}

function historyRow() {
  return { worksheetUsedId: 10, enrollmentId: 1, worksheetMasterId: 101, actualWorksheetNo: 101,
    worksheetDate: '2026-10-20', levelMasterId: 100, levelCode: 'C', worksheetType: 'WS',
    packetWorksheetNo: 101, worksheetLabel: 'C101', cpws: true, isStockProcessed: false };
}

function contextFor(student, history = []) {
  const options = (levelMasterId, count, idOffset) => Array.from({ length: count }, (_, i) => ({
    worksheetNo: i * 10 + 1, worksheetMasterId: idOffset + i,
    levelMasterId, nextWorksheetMasterId: i + 1 < count ? idOffset + i + 1 : null
  }));
  return { enrollment: student, studentEnrollments: [student],
    defaults: { receiveDate: '2026-10-20', patternCode: 'daily10', mainWorksheetNo: 101,
      zunWorksheetNo: student.currentZunLevelMasterId ? 1 : null },
    patterns, worksheetOptions: { main: options(100, 20, 91),
      zun: student.currentZunLevelMasterId ? options(99, 10, 1001) : [] },
    history, worksheetMonthSummary: summary, completionState: {},
    cdState: { availableCds: [], receivedCdMasterIds: [], receivedCds: [] } };
}

function scenario(student, getHistory = () => []) {
  const responses = [];
  const send = (req, res, status, body) => {
    responses.push({ method: req.method, path: req.path, status });
    res.status(status).json(body);
  };
  return { student, responses, send,
    async handle(req, res) {
      if (req.method === 'GET' && req.path === '/worksheet/search') {
        const query = String(req.query.query || '').trim().replace(/^#/, '');
        const matches = query && (String(student.enrollmentId).startsWith(query) || student.studentName.includes(query));
        const subjectMatches = !req.query.subject || req.query.subject === 'ALL' || req.query.subject === student.subjectCode;
        send(req, res, 200, { success: true, rows: matches && subjectMatches ? [student] : [] });
        return true;
      }
      if (req.method === 'GET' && req.path === `/worksheet/enrollments/${student.enrollmentId}/context`) {
        send(req, res, 200, contextFor(student, getHistory())); return true;
      }
      if (req.method === 'GET' && req.path === `/worksheet/enrollments/${student.enrollmentId}/worksheet-summary`) {
        send(req, res, 200, { success: true, worksheetMonthSummary: summary }); return true;
      }
      return false;
    }
  };
}

const messageOf = error => `${error?.name || 'Error'}: ${error?.message || String(error)}`;
const contextRequests = fixture => fixture.requests.filter(r => /\/enrollments\/\d+\/context$/.test(r.path));

async function waitUntil(page, predicate, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs;
  do {
    if (await predicate()) return;
    await page.waitForTimeout(50);
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${description}`);
}

// Diagnostics below are DOM reads through locators only. No application module
// imports, state mutations, handler calls, dispatchEvent(), or evaluate() are
// used to select a student, fill a field, or trigger a save.
async function uiSnapshot(page) {
  const status = page.locator('#statusLine');
  const classes = (await status.getAttribute('class') || '').split(/\s+/);
  const focused = page.locator(':focus').first();
  return { searchValue: await page.locator('#studentSearch').inputValue(),
    studentMeta: await page.locator('#studentMeta').innerText(),
    subjectValue: await page.locator('#studentSubjectSelect').inputValue(),
    mainInputCount: await page.locator('[data-ws-input][data-kind="main"]').count(),
    focused: await focused.count() ? { id: await focused.getAttribute('id'),
      class: await focused.getAttribute('class'), kind: await focused.getAttribute('data-kind'),
      index: await focused.getAttribute('data-index') } : null,
    status: { text: await status.innerText(), isSuccess: classes.includes('is-success'), isError: classes.includes('is-error') } };
}

async function showSearch(fixture, query) {
  const page = fixture.page;
  await page.locator('#studentSearch:focus').waitFor({ state: 'visible' });
  await page.locator('#studentSearch').fill(query);
  await page.locator('#searchResults .result-item').first().waitFor({ state: 'visible' });
}

async function selectThroughSearch(fixture, id) {
  await showSearch(fixture, String(id));
  await fixture.page.keyboard.press('Enter');
  await fixture.page.locator('[data-ws-input][data-kind="main"][data-index="0"]:focus').waitFor({ state: 'visible' });
  assert.ok((await fixture.page.locator('#studentSearch').inputValue()).startsWith(`#${id} `), 'UI selected a different student');
}

async function withFixture(controlFixture, options, evidence, data, exercise) {
  let fixture;
  try {
    fixture = await controlFixture('worksheet', data.handle, { embedded: options.embedded });
    const origin = new URL(fixture.origin);
    assert.ok(['localhost', '127.0.0.1'].includes(origin.hostname) && origin.port && origin.port !== '3000', 'Expected a disposable fixture port');
    fixture.page.setDefaultTimeout(options.timeoutMs);
    fixture.page.setDefaultNavigationTimeout(options.timeoutMs);
    // Restrict subsequent navigation/requests to this fixture. controlFixture
    // already blocks HTTPS during initial page creation and uses a fresh profile.
    await fixture.page.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === origin.origin) return route.continue();
      // Keep the audit offline while allowing repeated app navigations to load
      // its optional font stylesheet. This is a local empty CSS response, never
      // a network exception for API calls or another destination.
      if (url.origin === 'https://fonts.googleapis.com' && request.resourceType() === 'stylesheet') {
        evidence.stubbedFontStylesheets ||= [];
        evidence.stubbedFontStylesheets.push(url.href);
        return route.fulfill({ contentType: 'text/css', body: '' });
      }
      evidence.blockedRequests.push(route.request().url());
      return route.abort();
    });
    await exercise(fixture);
  } catch (error) {
    evidence.status = 'inconclusive';
    evidence.reason = messageOf(error);
  } finally {
    evidence.fixtureResponses = structuredClone(data.responses);
    if (fixture) {
      evidence.requests = structuredClone(fixture.requests);
      evidence.writes = structuredClone(fixture.writes());
      evidence.fixtureErrors = [...fixture.errors];
      try { await fixture.close(); }
      catch (error) { evidence.cleanupError = messageOf(error); }
      if (evidence.fixtureErrors.length || evidence.cleanupError || evidence.blockedRequests.length) {
        evidence.observedStatusBeforeFixtureError = evidence.status;
        evidence.status = 'inconclusive';
        evidence.reason = 'Unexpected fixture/page/network/cleanup error; inspect the preserved observations.';
      }
    }
  }
  return evidence;
}

function caseEvidence(id, title, sources) {
  return { id, title, status: 'inconclusive', sources, steps: [], observations: {},
    blockedRequests: [], diagnosticState: { applicationStateEvaluated: false,
      note: 'Only DOM locator reads and isolated fixture-server data are recorded.' } };
}

async function searchButtonCase(controlFixture, options) {
  const e = caseEvidence('search-result-keyboard', 'Tab to result button; Enter/Space vs real mouse-down', [
    'test/worksheetUnifiedSearch.ui.test.js', 'public/js/worksheet/worksheet.js', 'public/js/worksheet/worksheetSearch.js'
  ]);
  const data = scenario(enrollment(512));
  return withFixture(controlFixture, options, e, data, async f => {
    const trials = e.observations.keyboardTrials = [];
    for (const key of ['Enter', 'Space']) {
      if (trials.length) await f.page.reload();
      await showSearch(f, '512');
      e.steps.push(`Fresh page: type 512; wait for result; Tab; press ${key} only if the result button receives focus.`);
      await f.page.keyboard.press('Tab');
      const trial = { key, reachedResultByTab: await f.page.locator('#searchResults .result-item:focus').count() === 1 };
      trials.push(trial);
      if (!trial.reachedResultByTab) {
        trial.outcome = 'inconclusive'; trial.ui = await uiSnapshot(f.page); continue;
      }
      const before = contextRequests(f).length;
      await f.page.keyboard.press(key);
      await f.page.waitForTimeout(options.observationMs);
      trial.observationMs = options.observationMs;
      trial.contextRequests = contextRequests(f).length - before;
      trial.ui = await uiSnapshot(f.page);
      trial.selected = trial.ui.searchValue.startsWith('#512 ') && trial.ui.mainInputCount > 0;
      trial.outcome = trial.selected ? 'selected' : trial.contextRequests === 0 ? 'no_selection_within_observation_window' : 'inconclusive';
    }

    await f.page.reload();
    await showSearch(f, '512');
    const box = await f.page.locator('#searchResults .result-item').first().boundingBox();
    assert.ok(box, 'Positive control result has no clickable bounds');
    const before = contextRequests(f).length;
    e.steps.push('Positive control on a fresh page: move the mouse to the same result; real mouse.down()/up(); wait for Main focus.');
    await f.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    try { await f.page.mouse.down(); }
    finally { await f.page.mouse.up(); }
    await f.page.locator('[data-ws-input][data-kind="main"]:focus').first().waitFor({ state: 'visible' });
    const positive = e.observations.mouseDownControl = { ui: await uiSnapshot(f.page), contextRequests: contextRequests(f).length - before };
    positive.selected = positive.ui.searchValue.startsWith('#512 ') && positive.ui.mainInputCount > 0 && positive.contextRequests === 1;
    assert.equal(f.writes().length, 0, 'Search-only case unexpectedly wrote data');
    if (!positive.selected || trials.some(t => t.outcome === 'inconclusive')) {
      e.reason = 'Positive control or keyboard-focus precondition was not established.';
    } else if (trials.some(t => t.outcome === 'no_selection_within_observation_window')) {
      e.status = 'reproduced'; e.reason = 'At least one native button activation did not select within the recorded window; mouse-down selected the same fixture student.';
    } else {
      e.status = 'not_reproduced'; e.reason = 'Both keyboard activations selected the fixture student.';
    }
  });
}

async function dateRecoveryCase(controlFixture, options) {
  const e = caseEvidence('date-patch-history-503', 'Successful date PATCH followed by history 503', [
    'test/worksheetNumberEdit.ui.test.js', 'public/js/worksheet/worksheet.js'
  ]);
  let row = historyRow(), failuresRemaining = 1, patches = 0;
  const data = scenario(enrollment(), () => [row]);
  const baseHandle = data.handle;
  data.handle = async (req, res) => {
    if (req.method === 'PATCH' && req.path === datePath) {
      assert.deepEqual(req.body, { enrollmentId: 1, worksheetDate: '2026-10-21' });
      row = { ...row, worksheetDate: req.body.worksheetDate }; patches++;
      data.send(req, res, 200, { success: true, entry: row, worksheetUsedId: 10 }); return true;
    }
    if (req.method === 'GET' && req.path === historyPath) {
      if (patches > 0 && failuresRemaining > 0) {
        failuresRemaining--;
        data.send(req, res, 503, { success: false, error: 'Fixture history unavailable after date PATCH' });
      } else data.send(req, res, 200, { success: true, history: [row], worksheetMonthSummary: summary });
      return true;
    }
    return baseHandle(req, res);
  };
  e.injectedConditions = ['PATCH persists the submitted date in fixture memory and returns 200 + entry.',
    'First history GET after PATCH returns 503; other history GETs return the stored row. No production service/database is called.'];
  return withFixture(controlFixture, options, e, data, async f => {
    await selectThroughSearch(f, 1);
    const input = f.page.locator('[data-edit-history-date-id="10"]');
    assert.equal(await input.isDisabled(), false, 'Baseline date field must be editable');
    assert.equal(await input.inputValue(), '2026-10-20');
    e.observations.before = { ui: await uiSnapshot(f.page), dateDisabled: await input.isDisabled() };
    e.steps.push('Search 1 and Enter; fill editable history date with 2026-10-21; press Enter.');
    await input.fill('2026-10-21');
    const [response] = await Promise.all([
      f.page.waitForResponse(r => new URL(r.url()).pathname === `/api${historyPath}` && r.request().method() === 'GET'),
      input.press('Enter')
    ]);
    await response.finished();
    assert.equal(response.status(), 503, 'The intended post-PATCH fault was not exercised');
    await waitUntil(f.page, async () => (await f.page.locator('#statusLine').innerText()) !== 'กำลังแก้วันที่...', options.timeoutMs, 'date handler to leave its saving status');
    await f.page.waitForTimeout(options.observationMs);
    const present = await input.count() === 1;
    const observed = e.observations.after503 = { ui: await uiSnapshot(f.page),
      observationMs: options.observationMs, inputPresent: present,
      dateDisabled: present ? await input.isDisabled() : null,
      displayedDate: present ? await input.inputValue() : null,
      patchCount: patches, fixtureStoredRow: structuredClone(row) };
    e.observations.successMessageWithoutFailureDetail = observed.ui.status.isSuccess && !/โหลด|ไม่สำเร็จ|unavailable|503/i.test(observed.ui.status.text);
    assert.equal(patches, 1, 'Expected exactly one date PATCH');
    assert.equal(row.worksheetDate, '2026-10-21');

    // A successful reload is a UI positive control, not a direct handler call.
    e.steps.push('Recovery control: change Show to 50 to request history again through the UI.');
    try {
      const [recovery] = await Promise.all([
        f.page.waitForResponse(r => new URL(r.url()).pathname === `/api${historyPath}` && r.request().method() === 'GET'),
        f.page.locator('#historyLimit').selectOption('50')
      ]);
      await recovery.finished();
      await waitUntil(f.page, async () => await input.count() === 1 && !await input.isDisabled() && await input.inputValue() === row.worksheetDate,
        options.timeoutMs, 'editable, refreshed history date');
      e.observations.recoveryControl = { status: recovery.status(), dateDisabled: await input.isDisabled(), displayedDate: await input.inputValue() };
    } catch (error) { e.observations.recoveryControl = { status: 'inconclusive', error: messageOf(error) }; }

    if (!present) e.reason = 'History date field disappeared; disabled-state claim cannot be assessed.';
    else {
      e.status = observed.dateDisabled ? 'reproduced' : 'not_reproduced';
      e.reason = observed.dateDisabled ? 'Date input remained disabled after PATCH 200 / history 503.' : 'Date input was enabled after PATCH 200 / history 503.';
    }
    e.limitations = ['The fixture proves frontend handling of these HTTP responses, not production date persistence or transaction behavior.'];
  });
}

async function worksheetValues(page, kind) {
  const controls = page.locator(`[data-ws-input][data-kind="${kind}"]`);
  const values = [];
  for (let i = 0; i < await controls.count(); i++) values.push(await controls.nth(i).inputValue());
  return values;
}

async function previewSnapshot(page) {
  return { main: await worksheetValues(page, 'main'), zun: await worksheetValues(page, 'zun'),
    previewCount: await page.locator('#previewCount').innerText(),
    previewLabels: await page.locator('#previewList .preview-label').allTextContents(),
    saveEnabled: !await page.locator('#saveButton').isDisabled(), ui: await uiSnapshot(page) };
}

async function optionalZunCase(controlFixture, options) {
  const e = caseEvidence('daily20-optional-zun', '20/day from empty optional Zun with valid current level and options', [
    'test/worksheetSubjectColors.ui.test.js', 'test/worksheetNumberEdit.ui.test.js',
    'public/js/worksheet/worksheetPreview.js', 'services/worksheetService.js: WORKSHEET_PATTERNS'
  ]);
  const data = scenario(enrollment(1, true));
  e.fixturePreconditions = { subject: 'ME', isKumonConnect: false, currentZunLevelMasterId: 99,
    currentZunLevelCode: 'ZI', history: [], defaultZunWorksheetNo: 1,
    zunOptions: '1, 11, ..., 91', mainOptions: '1, 11, ..., 191', initialPattern: 'daily10' };
  return withFixture(controlFixture, options, e, data, async f => {
    await selectThroughSearch(f, 1);
    e.observations.beforePattern = await previewSnapshot(f.page);
    e.steps.push('Search 1 and Enter; observe optional Zun without touching it; click 20/วัน.');
    await f.page.locator('[data-pattern="daily20"]').click();
    const observed = e.observations.afterPattern = await previewSnapshot(f.page);
    if (observed.main.length !== 2 || observed.zun.length !== 2) {
      e.reason = 'The UI did not expose two Main and two Zun fields; the intended fixture contract was not established.'; return;
    }
    const halfFilled = observed.zun.filter(Boolean).length === 1;
    e.observations.halfFilledWithoutZunInput = halfFilled;
    e.observations.previewAcceptsOneZun = observed.previewLabels.filter(label => label.trim().startsWith('ZI')).length === 1;

    // Clear only through the existing 0 shortcut. Assert each focus transition
    // before Enter so an unexpected field order cannot accidentally submit.
    if (halfFilled && observed.zun[0] === '' && observed.zun[1] !== '') {
      e.steps.push('Blank-Zun control: from Main 1, Enter to Zun 1, Main 2, Zun 2; press 0 to clear; do not save.');
      for (const selector of [
        '[data-kind="main"][data-index="0"]', '[data-kind="zun"][data-index="0"]',
        '[data-kind="main"][data-index="1"]'
      ]) {
        await f.page.locator(`[data-ws-input]${selector}:focus`).waitFor({ state: 'visible' });
        await f.page.keyboard.press('Enter');
      }
      await f.page.locator('[data-ws-input][data-kind="zun"][data-index="1"]:focus').waitFor({ state: 'visible' });
      await f.page.keyboard.press('0');
      e.observations.blankZunControl = await previewSnapshot(f.page);
      assert.deepEqual(e.observations.blankZunControl.zun, ['', ''], '0 shortcut did not establish blank optional Zun');
    }
    assert.equal(f.writes().length, 0, 'This case must not submit or mock a save');
    e.status = halfFilled ? 'reproduced' : 'not_reproduced';
    e.reason = halfFilled ? 'Production UI generated exactly one optional Zun value on switching to 20/day.' : 'Switching to 20/day did not produce a half-filled optional Zun pair.';
    e.limitations = ['Save was not pressed. No POST rejection was mocked; production service validation is not verified by this case.'];
  });
}

/**
 * Run cases sequentially (one fixture/browser at a time); return plain JSON data.
 * Parent workers may call this with { embedded: true, timeoutMs: 30000 }.
 * This export never writes reports; the direct CLI below writes the fixed path.
 * Reproduced is evidence, not a test failure. Setup/runtime errors are inconclusive.
 */
export async function runWorksheetReview({ embedded = false, timeoutMs = 15000, observationMs = 750 } = {}) {
  assert.equal(path.resolve(process.cwd()), path.resolve(repositoryRoot), 'Run from the repository root: controlFixture uses relative static paths');
  assert.equal(typeof embedded, 'boolean');
  assert.ok(Number.isFinite(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 120000, 'Invalid timeoutMs');
  assert.ok(Number.isFinite(observationMs) && observationMs >= 250 && observationMs <= 10000, 'Invalid observationMs');
  const options = { embedded, timeoutMs, observationMs };
  const report = { schemaVersion: 1, reviewDate: '2026-11-24', startedAt: new Date().toISOString(),
    mode: embedded ? 'synthetic-electron' : 'synthetic-browser', options,
    scope: 'Worksheet keyboard entry only; isolated controlFixture, no real account/database/KSIS.',
    results: [] };
  const { controlFixture } = await import('../../test/support/controlFixture.js');
  for (const run of [searchButtonCase, dateRecoveryCase, optionalZunCase]) report.results.push(await run(controlFixture, options));
  report.finishedAt = new Date().toISOString();
  report.counts = Object.fromEntries(['reproduced', 'not_reproduced', 'inconclusive'].map(status => [status, report.results.filter(r => r.status === status).length]));
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let report;
  try {
    assert.ok(process.argv.slice(2).every(arg => arg === '--embedded'), 'Only --embedded is supported');
    report = await runWorksheetReview({ embedded: process.argv.includes('--embedded') });
  } catch (error) {
    report = { schemaVersion: 1, reviewDate: '2026-11-24', finishedAt: new Date().toISOString(),
      status: 'inconclusive', reason: messageOf(error), results: [] };
  }
  const output = process.argv.includes('--embedded')
    ? path.join(path.dirname(defaultOutput), 'worksheet-desktop-evidence.json') : defaultOutput;
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${output}\n`);
  if (report.status === 'inconclusive' || report.counts?.inconclusive) process.exitCode = 1;
}
