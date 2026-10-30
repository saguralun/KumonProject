import assert from 'node:assert/strict';
import { test } from 'node:test';
import { controlFixture } from './support/controlFixture.js';

const ui = { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 25000 };
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
async function waitForSignal(signal) {
  let timer;
  try {
    await Promise.race([signal.promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Fixture request did not arrive')), 5000); })]);
  } finally { clearTimeout(timer); }
}
const students = [1, 2].map(studentId => ({ studentId, displayName: `Student ${studentId}`, firstName: `First${studentId}`,
  lastName: 'Fixture', prefixId: 1, genderId: 1, schoolGradeId: 1 }));
const profile = id => ({ student: students[id - 1], enrollments: [{ enrollmentId: id * 10, subjectId: 1, subjectCode: 'ME',
  currentLevelMasterId: 1, currentLevelCode: 'A', startingWorksheetMasterId: 1, enStartDate: '2026-01-01',
  currentStatusGroup1Id: 1, statusGroup1Code: 'C', statusGroup1Name: 'Continue' }] });
const masters = { prefixes: [{ id: 1, name: 'ด.ช.' }], genders: [{ id: 1, name: 'ชาย' }], grades: [{ id: 1, label: 'PK3' }],
  subjects: [{ id: 1, code: 'ME', name: 'Math' }], statuses: [{ id: 1, group: 1, code: 'C', name: 'Continue' }],
  levels: [{ id: 1, subjectId: 1, code: 'A', type: 1 }], worksheets: [{ id: 1, levelMasterId: 1, worksheetNo: 1 }],
  schedules: [], dtMasters: [], studentHints: {}, addressRows: [] };

async function studentFixture(handle = async () => false) {
  const f = await controlFixture('student-manager', async (req, res) => {
    if (await handle(req, res)) return true;
    if (req.path === '/students/masters') res.json({ success: true, masters });
    else if (req.path === '/students/search') res.json({ success: true, rows: students });
    else if (/^\/students\/[12]$/.test(req.path)) res.json({ success: true, ...profile(Number(req.path.split('/').at(-1))) });
    else if (/\/history$/.test(req.path)) res.json({ success: true, type: req.query.type, columns: ['name'], rows: [{ name: `Current ${req.path}` }] });
    else return false;
    return true;
  });
  await f.page.waitForFunction(() => document.querySelector('#enrollmentForm [name=enrollmentId]').value === '10'
    && !document.getElementById('saveStudentButton').disabled);
  return f;
}

for (const kind of ['student', 'enrollment']) test(`Student ${kind} save locks selection, rejects duplicate submit, and preserves failed input for retry`, ui, async () => {
  const started = deferred(), release = deferred(); let fail = true;
  const endpoint = kind === 'student' ? '/students/1' : '/students/1/enrollments/10';
  const f = await studentFixture(async (req, res) => {
    if (req.path !== endpoint || req.method !== 'PUT') return false;
    started.resolve(); await release.promise;
    if (fail) res.status(503).json({ success: false, error: 'Fixture save rejected' });
    else res.json(kind === 'student' ? { success: true, ...profile(1) } : { success: true, profile: profile(1), enrollmentId: 10 });
    return true;
  });
  try {
    const { page } = f, form = kind === 'student' ? '#studentForm' : '#enrollmentForm';
    if (kind === 'student') await page.locator(`${form} [name=firstName]`).fill('Keep pending edit');
    await page.locator(kind === 'student' ? '#saveStudentButton' : '#saveEnrollmentButton').click(); await waitForSignal(started);
    assert.equal(await page.locator('#studentSearch').isDisabled(), true);
    assert.equal(await page.locator('[data-student-id="2"]').isDisabled(), true);
    assert.equal(await page.locator('#saveStudentButton').isDisabled(), true);
    assert.equal(await page.locator('#saveEnrollmentButton').isDisabled(), true);
    await page.locator(form).evaluate(node => node.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await page.locator('[data-student-id="2"]').evaluate(node => node.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    assert.equal(f.requests.some(req => req.path === '/students/2'), false);
    assert.equal(f.writes().length, 1);
    release.resolve();
    await page.waitForFunction(() => document.getElementById('statusLine').textContent.includes('Fixture save rejected'));
    assert.equal(await page.locator('#saveStudentButton').isEnabled(), true);
    if (kind === 'student') assert.equal(await page.locator(`${form} [name=firstName]`).inputValue(), 'Keep pending edit');
    fail = false;
    await page.locator(kind === 'student' ? '#saveStudentButton' : '#saveEnrollmentButton').click();
    await page.waitForFunction(() => document.getElementById('statusLine').textContent.includes('บันทึก') && !document.getElementById('saveStudentButton').disabled);
    assert.equal(f.writes().length, 2);
    assert.equal(f.writes().every(req => req.path === endpoint), true);
    await page.locator('[data-student-id="2"]').click();
    await page.waitForFunction(() => document.querySelector('#studentForm [name=firstName]').value === 'First2');
    assert.deepEqual(await page.evaluate(async () => {
      const { state } = await import('/js/student-manager.js');
      return [state.selectedStudentId, state.profile.student.studentId];
    }), [2, 2]);
    assert.deepEqual(f.errors, []);
  } finally { release.resolve(); await f.close(); }
});

test('Student history and profile ignore late responses and remove old billing actions while loading', ui, async () => {
  const historyStarted = deferred(), releaseHistory = deferred(), profileStarted = deferred(), releaseProfile = deferred();
  let holdProfile = false;
  const f = await studentFixture(async (req, res) => {
    if (req.path === '/students/1/history' && req.query.type === 'billing') {
      historyStarted.resolve(); await releaseHistory.promise;
      res.json({ success: true, type: 'billing', columns: ['name'], rows: [{ name: 'OLD A BILL', billingId: 999 }] }); return true;
    }
    if (req.path === '/students/1' && holdProfile) {
      profileStarted.resolve(); await releaseProfile.promise; res.json({ success: true, ...profile(1) }); return true;
    }
    return false;
  });
  try {
    const { page } = f;
    await page.locator('[data-history="billing"]').click(); await waitForSignal(historyStarted);
    assert.equal(await page.locator('[data-cancel-billing-id]').count(), 0);
    await page.locator('[data-student-id="2"]').click();
    await page.waitForFunction(() => document.querySelector('#historyTableWrap').textContent.includes('/students/2/history'));
    const lateHistory = page.waitForResponse(response => response.url().includes('/students/1/history?type=billing'));
    releaseHistory.resolve(); await (await lateHistory).finished();
    holdProfile = true;
    await page.locator('[data-student-id="1"]').click(); await waitForSignal(profileStarted);
    assert.equal(await page.locator('[data-cancel-billing-id]').count(), 0);
    await page.locator('#studentForm').evaluate(node => node.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await page.locator('[data-student-id="2"]').click();
    await page.waitForFunction(() => !document.getElementById('saveStudentButton').disabled);
    const lateProfile = page.waitForResponse(response => new URL(response.url()).pathname === '/api/students/1');
    releaseProfile.resolve(); await (await lateProfile).finished();
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 30)));
    assert.equal(await page.locator('#studentForm [name=firstName]').inputValue(), 'First2');
    assert.doesNotMatch(await page.locator('#historyTableWrap').innerText(), /OLD A BILL/);
    assert.equal(await page.locator('[data-cancel-billing-id="999"]').count(), 0);
    assert.equal(f.writes().length, 0); assert.deepEqual(f.errors, []);
  } finally { releaseHistory.resolve(); releaseProfile.resolve(); await f.close(); }
});

test('Add Student displays duplicate preflight failure, blocks overlapping submits, and restores controls', ui, async () => {
  const started = deferred(), release = deferred(); let fail = true;
  const f = await studentFixture(async (req, res) => {
    if (req.path !== '/students/duplicate') return false;
    started.resolve(); await release.promise;
    if (fail) res.status(503).json({ success: false, error: 'Fixture duplicate preflight failed' });
    else res.json({ success: true, duplicate: null });
    return true;
  });
  try {
    const { page } = f;
    await page.locator('#newStudentButton').click();
    await page.locator('#addStudentForm [name=firstName]').fill('Typed');
    await page.locator('#addStudentForm [name=lastName]').fill('Input');
    await page.locator('#addStudentSave').click(); await waitForSignal(started);
    await page.locator('#addStudentForm').evaluate(node => node.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    assert.equal(await page.locator('#addStudentCancel').isDisabled(), true);
    release.resolve();
    await page.waitForFunction(() => document.getElementById('addStudentMessage').textContent.includes('Fixture duplicate preflight failed'));
    assert.equal(await page.locator('#addStudentSave').isEnabled(), true);
    assert.equal(await page.locator('#addStudentCancel').isEnabled(), true);
    assert.equal(await page.locator('#addStudentForm [name=firstName]').inputValue(), 'Typed');
    fail = false; await page.locator('#addStudentSave').click();
    await page.waitForFunction(() => !document.getElementById('addStudentSave').disabled && !document.getElementById('addStudentMessage').textContent.includes('Fixture duplicate preflight failed'));
    await page.waitForFunction(() => document.activeElement.name === 'nickname');
    assert.equal(f.writes().length, 0); assert.deepEqual(f.errors, []);
  } finally { release.resolve(); await f.close(); }
});

test('Student failed profile selection keeps edits locked until a profile loads successfully', ui, async () => {
  const started = deferred(), release = deferred();
  const f = await studentFixture(async (req, res) => {
    if (req.path !== '/students/2') return false;
    started.resolve(); await release.promise;
    res.status(503).json({ success: false, error: 'Fixture selected profile failed' }); return true;
  });
  try {
    const { page } = f;
    await page.locator('[data-student-id="2"]').click(); await waitForSignal(started);
    release.resolve();
    await page.waitForFunction(() => document.getElementById('statusLine').textContent.includes('Fixture selected profile failed'));
    assert.equal(await page.locator('#saveStudentButton').isDisabled(), true);
    assert.equal(await page.locator('#saveEnrollmentButton').isDisabled(), true);
    assert.equal(await page.locator('#studentForm').evaluate(node => node.inert), true);
    await page.locator('#studentForm').evaluate(node => node.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    assert.equal(f.writes().length, 0);
    await page.locator('[data-student-id="1"]').click();
    await page.waitForFunction(() => !document.getElementById('saveStudentButton').disabled);
    assert.equal(await page.locator('#studentForm [name=firstName]').inputValue(), 'First1');
    assert.deepEqual(f.errors, []);
  } finally { release.resolve(); await f.close(); }
});

test('Student history failure leaves the successfully selected profile editable', ui, async () => {
  const f = await studentFixture(async (req, res) => {
    if (req.path !== '/students/2/history') return false;
    res.status(503).json({ success: false, error: 'Fixture history unavailable' }); return true;
  });
  try {
    const { page } = f;
    await page.locator('[data-student-id="2"]').click();
    await page.waitForFunction(() => document.getElementById('statusLine').textContent.includes('Fixture history unavailable'));
    assert.equal(await page.locator('#saveStudentButton').isEnabled(), true);
    assert.equal(await page.locator('#studentForm [name=firstName]').inputValue(), 'First2');
    assert.deepEqual(await page.evaluate(async () => {
      const { state } = await import('/js/student-manager.js');
      return [state.selectedStudentId, state.profile.student.studentId];
    }), [2, 2]);
    assert.equal(await page.locator('#historyTableWrap button').count(), 0);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('Student unlocking preserves status, no-enrollment, deletion and three-subject restrictions', ui, async () => {
  let current = profile(1);
  const f = await studentFixture(async (req, res) => {
    if (req.method === 'PUT') { res.status(503).json({ success: false, error: 'Fixture save rejected' }); return true; }
    if (req.path === '/students/1') { res.json({ success: true, ...current }); return true; }
    return false;
  });
  try {
    const { page } = f;
    for (const status of ['A', 'C', 'CP', 'none', 'three']) {
      current = profile(1);
      if (status === 'none') current.enrollments = [];
      else if (status === 'three') current.enrollments = [10, 11, 12].map(enrollmentId => ({ ...current.enrollments[0], enrollmentId }));
      else Object.assign(current.enrollments[0], { statusGroup1Code: status, canDeleteEnrollment: status === 'A', canComplete: status !== 'C' });
      await page.locator('[data-student-id="1"]').click();
      await page.waitForFunction(() => !document.getElementById('saveStudentButton').disabled);
      await page.locator('#saveStudentButton').click();
      await page.waitForFunction(() => !document.getElementById('saveStudentButton').disabled && document.getElementById('statusLine').textContent.includes('Fixture save rejected'));
      assert.equal(await page.locator('#saveEnrollmentButton').isDisabled(), status === 'none');
      assert.equal(await page.locator('#deleteEnrollmentButton').isDisabled(), status !== 'A');
      assert.equal(await page.locator('#enrollmentAbsentButton').isDisabled(), !['C', 'three'].includes(status));
      assert.equal(await page.locator('#enrollmentResumeButton').isDisabled(), status !== 'A');
      assert.equal(await page.locator('#enrollmentCompleterButton').isDisabled(), status !== 'A');
      assert.equal(await page.locator('#newEnrollmentButton').isDisabled(), status === 'three');
      assert.equal(await page.locator('#deleteStudentButton').isDisabled(), status !== 'none');
    }
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

const roles = [{ role_code: 'admin', role_name: 'Admin', is_system: true }, { role_code: 'staff', role_name: 'Staff', is_system: true }];
const permissions = ['page:report', 'page:stock'].map(permission_key => ({ permission_key, permission_label: permission_key, nav_group: 'management' }));
test('Users delayed refresh preserves a permission saved during the refresh and the next toggle retains it', ui, async () => {
  const putStarted = deferred(), releasePut = deferred(), refreshStarted = deferred(), releaseRefresh = deferred();
  let grants = [], roleReads = 0;
  const f = await controlFixture('users', async (req, res) => {
    if (req.path === '/users') { res.json({ success: true, users: [] }); return true; }
    if (req.path === '/roles' && req.method === 'POST') { res.json({ success: true }); return true; }
    if (req.path === '/roles') {
      const snapshot = structuredClone(grants);
      if (++roleReads === 2) { refreshStarted.resolve(); await releaseRefresh.promise; }
      res.json({ success: true, roles, permissions, grants: snapshot }); return true;
    }
    if (req.path === '/roles/staff/permissions') {
      if (!grants.length) { putStarted.resolve(); await releasePut.promise; }
      grants = req.body.permissionKeys.map(permission_key => ({ role_code: 'staff', permission_key }));
      res.json({ success: true }); return true;
    }
  });
  try {
    const { page } = f, report = page.locator('[data-role-code="staff"][data-permission-key="page:report"]');
    await report.waitFor(); await page.locator('#createRoleSelect').selectOption('staff');
    await report.check(); await waitForSignal(putStarted);
    await page.locator('#createRoleForm [name=roleCode]').fill('extra');
    await page.locator('#createRoleForm [name=roleName]').fill('Extra');
    await page.locator('#createRoleSubmit').click(); await waitForSignal(refreshStarted);
    const permissionResponse = page.waitForResponse(response => response.url().includes('/roles/staff/permissions'));
    releasePut.resolve(); await (await permissionResponse).finished();
    await page.waitForFunction(() => document.getElementById('statusLine').textContent.includes('อัพเดทสิทธิ์'));
    releaseRefresh.resolve(); await report.waitFor();
    assert.equal(await report.isChecked(), true);
    assert.equal(await page.locator('#createRoleSelect').inputValue(), 'staff');
    await page.locator('[data-role-code="staff"][data-permission-key="page:stock"]').check();
    await page.waitForFunction(() => !document.querySelector('[data-role-code="staff"][data-permission-key="page:stock"]').disabled);
    assert.deepEqual(new Set(f.writes().at(-1).body.permissionKeys), new Set(['page:report', 'page:stock']));
    assert.deepEqual(f.errors, []);
  } finally { releasePut.resolve(); releaseRefresh.resolve(); await f.close(); }
});

for (const rejectLate of [false, true]) test(`Users ignores an older ${rejectLate ? 'failed' : 'successful'} list load after a newer load`, ui, async () => {
  const started = deferred(), release = deferred(); let reads = 0;
  const f = await controlFixture('users', async (req, res) => {
    if (req.path === '/users') { res.json({ success: true, users: [] }); return true; }
    if (req.path === '/roles' && req.method === 'POST') { res.json({ success: true }); return true; }
    if (req.path === '/roles') {
      const read = ++reads;
      if (read === 2) { started.resolve(); await release.promise; }
      if (read === 2 && rejectLate) res.status(503).json({ success: false, error: 'Stale roles failure' });
      else res.json({ success: true, roles: read >= 3 ? [...roles, { role_code: 'latest', role_name: 'Latest role', is_system: true }] : roles, permissions, grants: [] });
      return true;
    }
  });
  try {
    const { page } = f;
    await page.locator('#createRoleSelect option[value=staff]').waitFor({ state: 'attached' });
    const create = async code => {
      await page.locator('#createRoleForm [name=roleCode]').fill(code);
      await page.locator('#createRoleForm [name=roleName]').fill(code);
      await page.locator('#createRoleSubmit').click();
    };
    await create('first'); await waitForSignal(started);
    // Creating a user is an independent control and can refresh the list while role creation is still awaiting its refresh.
    await page.locator('#createForm [name=username]').fill('fixture-user');
    await page.locator('#createForm [name=password]').fill('fixture-password');
    await page.locator('#createForm [name=displayName]').fill('Fixture');
    await page.route('**/api/users', route => route.request().method() === 'POST'
      ? route.fulfill({ json: { success: true } }) : route.continue());
    await page.locator('#createSubmit').click();
    await page.locator('#createRoleSelect option[value=latest]').waitFor({ state: 'attached' });
    const late = page.waitForResponse(response => response.url().endsWith('/api/roles'));
    release.resolve(); await (await late).finished();
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 30)));
    assert.equal(await page.locator('#createRoleSelect option[value=latest]').count(), 1);
    assert.doesNotMatch(await page.locator('#permissionMatrixWrap').innerText(), /Stale roles failure/);
    assert.match(await page.locator('#permissionMatrixWrap').innerText(), /Latest role/);
    assert.deepEqual(f.errors, []);
  } finally { release.resolve(); await f.close(); }
});

const summary = { billingMonth: 10, billingYear: 2026, usedDays: 1, cpwsRecords: 1 };
const wsContext = id => ({ enrollment: { enrollmentId: id, subjectCode: 'ME', studentName: `Student ${id}`,
  currentLevelMasterId: id * 111, currentZunLevelMasterId: id === 1 ? null : 444, currentLevelCode: 'C', statusName: 'Continue' },
  studentEnrollments: [], defaults: { patternCode: 'daily10', receiveDate: '2026-10-20', mainWorksheetNo: 101 },
  patterns: [{ code: 'daily10', shortLabel: '10/day', suffixes: [1], dayOffsets: [0] }], worksheetOptions: { main: [{ worksheetNo: 101 }], zun: [] },
  history: [{ worksheetUsedId: id * 10, worksheetType: 'WS', worksheetDate: '2026-10-10', worksheetLabel: `OWN-${id}`, isStockProcessed: false }], worksheetMonthSummary: summary });
const loadWs = async (page, id) => {
  await page.evaluate(async value => { await (await import('/js/worksheet/worksheet.js')).loadEnrollmentContext(value); }, id);
  // Context loading schedules entry-field focus; let it finish before editing a history date.
  await page.waitForFunction(() => document.activeElement?.matches('[data-ws-input]'));
};

for (const rejectLate of [false, true]) test(`WS date edit ignores a late ${rejectLate ? 'error' : 'success'} after selection changes`, ui, async () => {
  const started = deferred(), release = deferred();
  const f = await controlFixture('worksheet', async (req, res) => {
    const match = req.path.match(/enrollments\/(\d+)\/context/);
    if (match) { res.json(wsContext(Number(match[1]))); return true; }
    if (req.path.endsWith('/worksheet-summary')) { res.json({ success: true, worksheetMonthSummary: summary }); return true; }
    if (req.path === '/worksheet/entries/10/date') {
      started.resolve(); await release.promise;
      if (rejectLate) res.status(503).json({ success: false, error: 'OLD date failure' });
      else res.json({ success: true, worksheetProgress: { owner: 'OLD A PROGRESS' }, completionState: { owner: 'OLD A COMPLETION' } });
      return true;
    }
  });
  try {
    const { page } = f; await loadWs(page, 1);
    const input = page.locator('[data-edit-history-date-id="10"]');
    await input.fill('2026-10-11'); await input.press('Enter'); await waitForSignal(started);
    await input.evaluate(node => node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    assert.equal(f.writes().length, 1);
    await loadWs(page, 2);
    const late = page.waitForResponse(response => response.url().includes('/entries/10/date'));
    release.resolve(); await (await late).finished();
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 30)));
    assert.equal(await page.locator('#studentSearch').inputValue(), '#2 Student 2');
    assert.match(await page.locator('#historyTableWrap').innerText(), /OWN-2/);
    assert.doesNotMatch(await page.locator('#statusLine').innerText(), /OLD date failure|แก้วันที่แล้ว/);
    assert.deepEqual(await page.evaluate(async () => {
      const { state } = await import('/js/worksheet/worksheetState.js');
      return [state.context.enrollment.enrollmentId, state.context.worksheetProgress?.owner || null, state.context.completionState?.owner || null];
    }), [2, null, null]);
    assert.equal(f.requests.some(req => req.path.includes('/enrollments/2/history')), false);
    assert.deepEqual(f.errors, []);
  } finally { release.resolve(); await f.close(); }
});

test('WS save sends the captured main and explicit nullable Zun context and preserves input after a 409', ui, async () => {
  const f = await controlFixture('worksheet', async (req, res) => {
    const match = req.path.match(/enrollments\/(\d+)\/context/);
    if (match) { res.json(wsContext(Number(match[1]))); return true; }
    if (req.path.endsWith('/worksheet-summary')) { res.json({ success: true, worksheetMonthSummary: summary }); return true; }
    if (req.path === '/worksheet/entries') { res.status(409).json({ success: false, error: 'Fixture level changed; reload context' }); return true; }
  });
  try {
    const { page } = f;
    for (const id of [1, 2]) {
      await loadWs(page, id); await page.locator('#saveButton:enabled').waitFor();
      await page.locator('#saveButton').click();
      await page.waitForFunction(() => !document.getElementById('saveButton').disabled && document.getElementById('statusLine').textContent.includes('Fixture level changed'));
      const payload = f.writes().at(-1).body;
      assert.equal(payload.expectedMainLevelMasterId, id * 111);
      assert.equal(payload.expectedZunLevelMasterId, id === 1 ? null : 444);
      assert.equal(Object.hasOwn(payload, 'expectedZunLevelMasterId'), true);
      assert.deepEqual(payload.mainWorksheetNos, ['101']);
      assert.equal(await page.locator('[data-ws-input][data-kind=main]').first().inputValue(), '101');
    }
    assert.equal(f.writes().length, 2); assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('WS date edit failure retains its original date and can be retried successfully in the same context', ui, async () => {
  let fail = true, savedDate = '2026-10-10';
  const f = await controlFixture('worksheet', async (req, res) => {
    if (req.path.endsWith('/context')) { res.json(wsContext(1)); return true; }
    if (req.path.endsWith('/worksheet-summary')) { res.json({ success: true, worksheetMonthSummary: summary }); return true; }
    if (req.path.endsWith('/history')) {
      const row = { ...wsContext(1).history[0], worksheetDate: savedDate };
      res.json({ success: true, history: [row], worksheetMonthSummary: summary }); return true;
    }
    if (req.path === '/worksheet/entries/10/date') {
      if (fail) res.status(503).json({ success: false, error: 'Fixture date rejected' });
      else { savedDate = req.body.worksheetDate; res.json({ success: true }); }
      return true;
    }
  });
  try {
    const { page } = f; await loadWs(page, 1);
    const input = page.locator('[data-edit-history-date-id="10"]');
    await input.fill('2026-10-11'); await input.press('Enter');
    await page.waitForFunction(() => document.getElementById('statusLine').textContent.includes('Fixture date rejected'));
    assert.equal(await input.isEnabled(), true); assert.equal(await input.inputValue(), '2026-10-10');
    fail = false; await input.fill('2026-10-11'); await input.press('Enter');
    await page.waitForFunction(() => document.getElementById('statusLine').textContent.includes('แก้วันที่แล้ว'));
    assert.equal(await input.inputValue(), '2026-10-11'); assert.equal(f.writes().length, 2);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

for (const kind of ['student', 'enrollment']) test(`Deleting a ${kind} captures its target, locks selection, and restores restrictions after rejection`, ui, async () => {
  const started = deferred(), release = deferred(); let fail = true;
  let current = profile(1); current.enrollments[0].canDeleteEnrollment = true;
  const endpoint = kind === 'student' ? '/students/1' : '/students/1/enrollments/10';
  const f = await studentFixture(async (req, res) => {
    if (req.path === endpoint && req.method === 'DELETE') {
      started.resolve(); await release.promise;
      if (fail) res.status(503).json({ success: false, error: 'Fixture delete rejected' });
      else { current = { student: students[0], enrollments: [] }; res.json({ success: true, profile: current }); }
      return true;
    }
    if (req.path === '/students/1' && req.method === 'GET') { res.json({ success: true, ...current }); return true; }
    return false;
  });
  try {
    const { page } = f, button = kind === 'student' ? '#deleteStudentButton' : '#deleteEnrollmentButton';
    if (kind === 'student') {
      current = { student: students[0], enrollments: [] };
      await page.locator('[data-student-id="1"]').click();
      await page.waitForFunction(() => !document.getElementById('deleteStudentButton').disabled);
    }
    await page.locator(button).click(); await f.choose(true); await waitForSignal(started);
    assert.equal(await page.locator('#studentSearch').isDisabled(), true);
    assert.equal(await page.locator('[data-student-id="2"]').isDisabled(), true);
    await page.locator('[data-student-id="2"]').evaluate(node => node.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await page.locator(button).evaluate(node => node.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    assert.equal(f.requests.some(req => req.path === '/students/2'), false);
    assert.equal(f.writes().length, 1);
    release.resolve();
    await page.waitForFunction(() => document.getElementById('statusLine').textContent.includes('Fixture delete rejected'));
    assert.equal(await page.locator(button).isEnabled(), true);
    assert.equal(await page.locator('#saveEnrollmentButton').isDisabled(), kind === 'student');
    assert.equal(await page.locator('#enrollmentResumeButton').isDisabled(), true);
    fail = false; await page.locator(button).click(); await f.choose(true);
    await page.waitForFunction(() => !document.getElementById('studentSearch').disabled && document.getElementById('statusLine').textContent.includes('ลบ'));
    const stateAfter = await page.evaluate(async () => {
      const { state } = await import('/js/student-manager.js');
      return [state.selectedStudentId, state.profile?.student?.studentId || null];
    });
    assert.deepEqual(stateAfter, kind === 'student' ? [null, null] : [1, 1]);
    assert.equal(await page.locator('#saveEnrollmentButton').isDisabled(), true);
    assert.equal(await page.locator('#deleteEnrollmentButton').isDisabled(), true);
    assert.equal(await page.locator('#deleteStudentButton').isDisabled(), kind === 'student');
    assert.equal(f.writes().length, 2); assert.equal(f.writes().every(req => req.path === endpoint), true);
    await page.locator('[data-student-id="2"]').click();
    await page.waitForFunction(() => document.querySelector('#studentForm [name=firstName]').value === 'First2');
    assert.deepEqual(f.errors, []);
  } finally { release.resolve(); await f.close(); }
});

for (const kind of ['student', 'enrollment']) test(`Deleting a ${kind} aborts if its selection changes during confirmation`, ui, async () => {
  let current = profile(1); current.enrollments[0].canDeleteEnrollment = true;
  const f = await studentFixture(async (req, res) => {
    if (req.path === '/students/1') { res.json({ success: true, ...current }); return true; }
    return false;
  });
  try {
    const { page } = f;
    if (kind === 'student') {
      current = { student: students[0], enrollments: [] };
      await page.locator('[data-student-id="1"]').click();
      await page.waitForFunction(() => !document.getElementById('deleteStudentButton').disabled);
    }
    await page.locator(kind === 'student' ? '#deleteStudentButton' : '#deleteEnrollmentButton').click();
    await page.locator('#appActionDialog').waitFor();
    // Exercise the real navigation handler while the asynchronous confirmation is pending.
    await page.locator('[data-student-id="2"]').evaluate(node => node.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await page.waitForFunction(() => document.querySelector('#studentForm [name=firstName]').value === 'First2' && !document.getElementById('saveStudentButton').disabled);
    await f.choose(true);
    await page.waitForFunction(() => !document.getElementById('appActionDialog')?.open);
    assert.equal(f.writes().length, 0);
    assert.equal(await page.locator('#studentForm [name=firstName]').inputValue(), 'First2');
    assert.equal(await page.locator('#enrollmentForm [name=enrollmentId]').inputValue(), '20');
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('Pending CD return stays locked through student-list and history rerenders and recovers after failure', ui, async () => {
  const started = deferred(), release = deferred(); let fail = true, cdExists = true;
  const f = await studentFixture(async (req, res) => {
    if (req.path === '/students/1/history' && req.query.type === 'cd') {
      res.json({ success: true, type: 'cd', columns: ['name'], rows: cdExists ? [{ name: 'Fixture CD', cdUsedId: 77, cpcd: true, stock: false }] : [] }); return true;
    }
    if (req.path === '/students/1/history/cd/77') {
      started.resolve(); await release.promise;
      if (fail) res.status(503).json({ success: false, error: 'Fixture CD return rejected' });
      else { cdExists = false; res.json({ success: true, stockReturned: false }); }
      return true;
    }
    return false;
  });
  try {
    const { page } = f, button = page.locator('[data-return-cd-id="77"]');
    await page.locator('[data-history="cd"]').click(); await button.waitFor();
    await button.click(); await f.choose(true); await waitForSignal(started);
    assert.equal(await button.isDisabled(), true);
    const directory = page.waitForResponse(response => response.url().includes('/students/search?') && new URL(response.url()).searchParams.get('query') === 'fixture');
    await page.locator('#studentSearch').fill('fixture'); await (await directory).finished();
    assert.equal(await button.isDisabled(), true);
    const history = page.waitForResponse(response => response.url().includes('/students/1/history?type=cd'));
    await page.locator('[data-history="cd"]').click(); await (await history).finished(); await button.waitFor();
    assert.equal(await button.isDisabled(), true);
    await button.evaluate(node => node.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    assert.equal(f.writes().length, 1);
    assert.equal(await page.locator('#appActionDialog[open]').count(), 0);
    release.resolve(); await page.waitForFunction(() => document.getElementById('statusLine').textContent.includes('Fixture CD return rejected'));
    assert.equal(await button.isEnabled(), true);
    fail = false; await button.click(); await f.choose(true);
    await page.waitForFunction(() => document.querySelector('[data-return-cd-id="77"]') === null && document.getElementById('statusLine').textContent.includes('เอา CD คืนแล้ว'));
    assert.equal(f.writes().length, 2); assert.deepEqual(f.errors, []);
  } finally { release.resolve(); await f.close(); }
});

test('Status action verifies its confirmed target and blocks selection while its response is pending', ui, async () => {
  const started = deferred(), release = deferred(); let current = profile(1);
  const f = await studentFixture(async (req, res) => {
    if (req.path === '/students/1' && req.method === 'GET') { res.json({ success: true, ...current }); return true; }
    if (req.path === '/students/1/enrollments/10/status-action') {
      started.resolve(); await release.promise;
      current = profile(1); Object.assign(current.enrollments[0], { statusGroup1Code: 'A', statusGroup1Name: 'Absent' });
      res.json({ success: true, profile: current, enrollmentId: 10, message: 'Fixture absent saved' }); return true;
    }
    return false;
  });
  try {
    const { page } = f;
    const open = async () => {
      await page.locator('#enrollmentActionBar').evaluate(node => { node.closest('details').open = true; });
      await page.locator('#enrollmentAbsentButton').click(); await page.locator('#enrollmentResumeDialog').waitFor();
    };
    await open();
    await page.locator('[data-student-id="2"]').evaluate(node => node.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await page.waitForFunction(() => document.querySelector('#studentForm [name=firstName]').value === 'First2' && !document.getElementById('saveStudentButton').disabled);
    await page.locator('#enrollmentResumeSave').click();
    assert.equal(f.writes().length, 0);
    assert.equal(await page.locator('#enrollmentResumeError').isVisible(), true);
    await page.locator('#enrollmentResumeCancel').click(); await page.locator('[data-student-id="1"]').click();
    await page.waitForFunction(() => !document.getElementById('saveStudentButton').disabled);
    await open(); await page.locator('#enrollmentResumeSave').click(); await waitForSignal(started);
    assert.equal(await page.locator('#studentSearch').isDisabled(), true);
    await page.locator('[data-student-id="2"]').evaluate(node => node.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await page.locator('#enrollmentResumeForm').evaluate(node => node.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    assert.equal(f.writes().length, 1);
    release.resolve(); await page.waitForFunction(() => document.getElementById('statusLine').textContent.includes('Fixture absent saved'));
    assert.equal(await page.locator('#studentForm [name=firstName]').inputValue(), 'First1');
    assert.equal(await page.locator('#enrollmentAbsentButton').isDisabled(), true);
    assert.equal(await page.locator('#enrollmentResumeButton').isEnabled(), true);
    assert.deepEqual(f.errors, []);
  } finally { release.resolve(); await f.close(); }
});

test('New enrollment save captures its student and prevents navigation or duplicate submission while pending', ui, async () => {
  const started = deferred(), release = deferred();
  const enrollmentMasters = { ...masters,
    subjects: [...masters.subjects, { id: 2, code: 'EFL', name: 'English' }],
    statuses: [...masters.statuses, { id: 4, group: 1, code: 'EO', name: 'Other subject' }],
    levels: [...masters.levels, { id: 2, subjectId: 2, code: 'A', type: 1 }],
    worksheets: [...masters.worksheets, { id: 2, levelMasterId: 2, worksheetNo: 1 }],
    dtMasters: [{ id: 2, subjectId: 2, testLevel: 'A', maxScore: 100, maxTime: 30 }],
    dtResults: [{ dtMasterId: 2, worksheetMasterId: 2 }],
    schedules: [{ id: 1, weekdayCode: 'MON', weekdayName: 'Monday', startTime: '09:00', endTime: '09:30', isActive: true, label: 'Monday 09:00' }] };
  const f = await studentFixture(async (req, res) => {
    if (req.path === '/students/masters') { res.json({ success: true, masters: enrollmentMasters }); return true; }
    if (req.path === '/students/1/enrollments' && req.method === 'POST') {
      started.resolve(); await release.promise;
      const updated = profile(1); updated.enrollments.push({ ...updated.enrollments[0], enrollmentId: 11, subjectId: 2, subjectCode: 'EFL', currentLevelMasterId: 2, startingWorksheetMasterId: 2 });
      res.json({ success: true, profile: updated, enrollmentId: 11 }); return true;
    }
    return false;
  });
  try {
    const { page } = f;
    await page.locator('#newEnrollmentButton').click();
    await page.locator('#addEnrollmentForm [name=dtMasterId]').selectOption('2');
    await page.locator('#addEnrollmentForm [name=score]').fill('90');
    await page.locator('#addEnrollmentForm [name=usedTime]').fill('10');
    await page.locator('#addEnrollmentForm [name=openingDay1]').selectOption('MON');
    await page.locator('#addEnrollmentForm [name=openingTime1]').selectOption('09:00');
    await page.locator('#addEnrollmentSave').click(); await waitForSignal(started);
    assert.equal(await page.locator('#studentSearch').isDisabled(), true);
    assert.equal(await page.locator('#addEnrollmentCancel').isDisabled(), true);
    await page.locator('[data-student-id="2"]').evaluate(node => node.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await page.locator('#addEnrollmentForm').evaluate(node => node.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    assert.equal(f.requests.some(req => req.path === '/students/2'), false);
    assert.equal(f.writes().length, 1);
    release.resolve(); await page.waitForFunction(() => !document.getElementById('studentSearch').disabled && document.getElementById('statusLine').textContent.includes('เพิ่มวิชาแล้ว'));
    assert.equal(await page.locator('#studentForm [name=firstName]').inputValue(), 'First1');
    assert.equal(await page.locator('#enrollmentForm [name=enrollmentId]').inputValue(), '11');
    assert.equal(await page.locator('#deleteEnrollmentButton').isDisabled(), true);
    assert.deepEqual(f.errors, []);
  } finally { release.resolve(); await f.close(); }
});
