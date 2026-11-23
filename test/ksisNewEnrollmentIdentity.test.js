import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchKsisReportIdentity } from '../services/ksisReportIdentity.js';
import { planKsisReportDraft, selectConfirmedKsisDraftRows, groupKsisStudentBatches, summarizeKsisDraft } from '../services/ksisReportDraft.js';
import { planKsisAt, selectConfirmedKsisAt } from '../services/ksisAtEntry.js';
import { compareKsisWs } from '../services/ksisWsAudit.js';
import { compareKsisAt } from '../services/ksisAtAudit.js';

const period = { month: 10, year: 2026 };
const record = (extra = {}) => ({ ID: 1, StudentId: 100, Subject: 'ME', Status1: 'N',
  'รหัสคุมอง': '', 'ชื่อจริง': 'เด็กใหม่', 'นามสกุล': 'ทดสอบ', 'วันเกิด': '18/09/2020',
  CurrentLevel: 'C90', WksUsed: 8, TestType: 'AT', DateTest: '10/10/2026', LevelTest: 'C', Time: 4, Score: 100, Group: 1, ...extra });
const field = (value, options = []) => ({ value, writable: true, options });
const blankAt = () => ({ key: 'test-0', subject: 'ME', date: field(''), level: field('', [{ label: 'C', value: 'C' }]), time: field(''),
  score: field(''), group: field(''), passed: false, dirty: false, error: '' });
const site = (extra = {}) => ({ key: 'student-me', studentKey: 'student-100', kumonId: '',
  fullName: 'เด็กใหม่ ทดสอบ', birthDate: '18/09/2563', subject: 'ME', dirty: false,
  level: field('C', ['C']), worksheet: field('90', ['90']), used: field('8'), status: field('N', ['C', 'N', 'EO', 'IT']),
  tests: [blankAt()], ...extra });
const document = target => ({ context: 'ชื่อศูนย์ TEST ประจำเดือน Oct - 2026', page: 1, modalOpen: false,
  subjectLabel: 'Math', editable: true, rows: [target], students: [target] });

for (const Status1 of ['N', 'EO', 'IT']) test(`${Status1} WS/AT planning and audits ignore absent, temporary and conflicting Kumon IDs`, () => {
  for (const [localId, siteId] of [['', ''], ['', '7642650000001'], ['123456789', ''],
    ['7642650000002', '7642650000001'], ['7642650000001', '7642650000001']]) {
    const source = record({ Status1, 'รหัสคุมอง': localId });
    const target = site({ kumonId: siteId, status: field(Status1, ['N', 'EO', 'IT']) });
    const before = structuredClone({ source, target });
    const [ws] = planKsisReportDraft([source], document(target), period, 'ME', { includeZun: false });
    assert.equal(ws.ready, true); assert.equal(ws.matchMethod, 'name_birth_date');
    assert.equal(ws.requiresIdentityConfirmation, false);
    assert.equal(selectConfirmedKsisDraftRows([ws])[0].ready, true);
    const [at] = planKsisAt([source], document(target), period, 'ME');
    assert.equal(at.outcome, 'ready'); assert.equal(at.matchMethod, 'name_birth_date');
    assert.equal(at.requiresIdentityConfirmation, false);
    assert.equal(selectConfirmedKsisAt([at]).length, 1);
    assert.equal(compareKsisWs([source], [document(target)]).counts.matched, 1);
    const saved = { ...blankAt(), date: field('10/10/2026'), level: field('C'), time: field('4'),
      score: field('100'), group: field('G1'), passed: true };
    const audit = compareKsisAt([source], [document({ ...target, tests: [saved] })], { ...period, subject: 'ME', scope: 'all' });
    assert.equal(audit.counts.matched, 1);
    assert.deepEqual({ source, target }, before);
  }
});

test('First-month matches use exact name, DOB and subject even if an unrelated child has the same ID', () => {
  for (const Status1 of ['N', 'EO', 'IT']) {
    const source = record({ Status1, 'รหัสคุมอง': '7642650000001' });
    const correct = site({ kumonId: '7642650000002' });
    const wrong = site({ key: 'other', studentKey: 'other', fullName: 'คนอื่น ทดสอบ', kumonId: source['รหัสคุมอง'] });
    const match = matchKsisReportIdentity(source, [source], [wrong, correct]);
    assert.deepEqual(match.targets, [correct]); assert.equal(match.reason, '');
    for (const altered of [{ birthDate: '19/09/2020' }, { subject: 'EFL' }, { fullName: 'ชื่ออื่น ทดสอบ' }]) {
      const match = matchKsisReportIdentity(source, [source], [site({ ...altered, kumonId: source['รหัสคุมอง'] })]);
      assert.deepEqual(match.targets, []);
    }
    for (const [records, targets] of [[[source, { ...source, ID: 2, StudentId: 200 }], [correct]],
      [[source], [correct, { ...correct, key: 'duplicate', studentKey: 'duplicate' }]]]) {
      assert.match(matchKsisReportIdentity(source, records, targets).reason, /ซ้ำ/);
    }
  }
});

test('Off-page no-ID children are separated from real missing DOB and DOB conflicts in WS and AT', () => {
  const source = record();
  const elsewhere = document(site({ fullName: 'เด็กอีกหน้า ทดสอบ' }));
  const [ws] = planKsisReportDraft([source], elsewhere, period, 'ME', { includeZun: false });
  assert.equal(ws.outsidePage, true); assert.equal(ws.ready, false);
  const [at] = planKsisAt([source], elsewhere, period, 'ME');
  assert.equal(at.outsidePage, true); assert.equal(at.outcome, 'outside_page');
  assert.equal(compareKsisWs([source], [elsewhere]).outsidePage, 1);
  assert.equal(compareKsisAt([source], [elsewhere], { ...period, subject: 'ME' }).outsidePage, 1);
  for (const [local, target] of [[record({ 'วันเกิด': '' }), site()], [source, site({ birthDate: '19/09/2020' })]]) {
    const [ws] = planKsisReportDraft([local], document(target), period, 'ME', { includeZun: false });
    assert.equal(ws.outsidePage, false); assert.equal(ws.ready, false); assert.match(ws.reason, /วันเกิด/);
    const [at] = planKsisAt([local], document(target), period, 'ME');
    assert.equal(at.outcome, 'review'); assert.equal(at.outsidePage, false);
  }
});

test('Existing C/R matching retains ID matching and review of malformed or conflicting known IDs', () => {
  for (const Status1 of ['C', 'R']) {
    const source = record({ Status1, 'รหัสคุมอง': '7642650000001' });
    const target = site({ kumonId: source['รหัสคุมอง'] });
    assert.equal(matchKsisReportIdentity(source, [source], [target]).method, 'kumon_id');
    const conflict = matchKsisReportIdentity({ ...source, 'รหัสคุมอง': '7642650000002' }, [{ ...source, 'รหัสคุมอง': '7642650000002' }], [target]);
    assert.match(conflict.reason, /ขัดแย้ง/);
    assert.match(matchKsisReportIdentity({ ...source, 'รหัสคุมอง': '123456789' }, [source], [target]).reason, /รูปแบบรหัส/);
  }
});

test('One child with an existing subject and new subject stays together in a single student save batch', () => {
  const records = [record(), record({ ID: 2, Subject: 'EFL', Status1: 'C', 'รหัสคุมอง': '7642650000001' })];
  const targets = [site(), site({ key: 'student-efl', subject: 'EFL', kumonId: '7642650000001', status: field('C', ['C']) })];
  const doc = { ...document(targets[0]), rows: targets };
  const rows = planKsisReportDraft(records, doc, period, 'ALL', { includeZun: false });
  assert.ok(rows.every(row => row.ready));
  const confirmed = selectConfirmedKsisDraftRows(rows);
  const batches = groupKsisStudentBatches(confirmed, 1);
  assert.equal(batches.length, 1); assert.equal(batches[0].length, 2);
  assert.equal(summarizeKsisDraft(confirmed, targets.map(target => target.key)).studentsFilled, 1);
});
