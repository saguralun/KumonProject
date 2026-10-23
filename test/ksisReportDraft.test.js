import assert from "node:assert/strict";
import { test } from "node:test";
import { planKsisReportDraft, ksisContextPeriod, summarizeKsisDraft, isKsisDraftReadRequest, isKsisWsSaveRequest, groupKsisStudentBatches, applyKsisReportDraft, selectConfirmedKsisDraftRows, isUnchangedKsisWorksheetNotice, inspectKsisWsDraft } from "../services/ksisReportDraft.js";

const record = (extra = {}) => ({ ID: 1, Subject: "ME", "รหัสคุมอง": "7642650000001", "ชื่อจริง": "ตัวอย่าง", "นามสกุล": "ทดสอบ",
    "วันเกิด": "01/01/2020", CurrentLevel: "C90", WksUsed: 8, Status1: "C", UsedZI: 2, UsedZII: 3, ZIWorksheetNo: 30, ZIIWorksheetNo: 50, ...extra });
const field = (value, options = null) => ({ value, options, writable: true });
const document = () => ({ context: "ชื่อศูนย์ TEST ประจำเดือน Oct - 2026", page: 1, modalOpen: false,
    rows: [{ key: "student-me", kumonId: "7642650000001", subject: "ME", birthDate: "01/01/2020", dirty: false,
        level: field("C", ["C", "D"]), worksheet: field("80", ["80", "90", "100"]), used: field("0"), status: field("C", ["C", "A", "R", "OT"]) }] });
const period = { month: 10, year: 2026 };

test('WS recovery reads only the current page and unlocks logout without mistaking old results for saved data', async () => {
    for (const mode of ['dirty', 'modal', 'loading', 'login', 'other', 'saving', 'clean']) {
        let releases = 0, reads = 0;
        const doc = document();
        if (mode === 'dirty') doc.rows[0].dirty = true;
        if (mode === 'modal') doc.modalOpen = true;
        if (mode === 'loading') doc.rows = [];
        const session = { pendingDraft: true, draftGuard: { release: async () => { releases++; }, pendingSaveCount: () => mode === 'saving' ? 1 : 0 } };
        const page = { url: () => `https://kao.ksis.kumon.com/kth/#/${mode === 'login' ? 'login' : mode === 'other' ? 'atestentrygrid' : 'reportbeditgrid'}`,
            evaluate: async () => { reads++; return doc; } };
        const result = await inspectKsisWsDraft(page, session);
        assert.equal(result.readOnly, true); assert.equal(result.refreshed, false);
        const recovered = ['clean', 'login'].includes(mode);
        assert.equal(releases, 1); assert.equal(result.recovered, recovered);
        assert.equal(session.pendingDraft, !recovered);
        assert.equal(result.pendingDraft, !recovered);
        assert.equal(result.requiresLogin, mode === 'login');
        assert.equal(reads, ['login', 'other', 'saving'].includes(mode) ? 0 : 1);
        if (mode === 'clean') { assert.equal(session.draftGuard, null); assert.equal(result.saved, undefined); }
    }
});

test('Logout releases only WS editing locks, keeps the prior result unverified and never dismisses an unresolved save', async () => {
    const page = { url: () => 'https://kao.ksis.kumon.com/kth/#/login' };
    const session = { pendingDraft: true };
    const inspected = await inspectKsisWsDraft(page, session);
    assert.equal(inspected.recovered, true); assert.equal(inspected.previousResultUnverified, true);
    const result = await inspectKsisWsDraft(page, session, { acknowledge: true });
    assert.equal(result.acknowledged, true); assert.equal(session.pendingDraft, false);
    assert.equal(result.saved, undefined); assert.equal(result.requiresLogin, true);
    session.pendingDraft = true;
    session.draftGuard = { release: async () => {}, pendingSaveCount: () => 1 };
    assert.equal((await inspectKsisWsDraft(page, session, { acknowledge: true })).recovered, false);
    assert.equal(session.pendingDraft, true);
});

const newStudent = (extra = {}) => record({ StudentId: 100, 'รหัสคุมอง': '', Status1: 'N', ...extra });
const newDocument = () => {
    const doc = document();
    Object.assign(doc.rows[0], { kumonId: '', fullName: 'ตัวอย่าง ทดสอบ', studentKey: 'header:0' });
    doc.rows[0].status.options.push('N', 'EO', 'IT');
    return doc;
};

test('R/IT/N/EO without IDs require an exact name, DOB and subject match plus explicit per-preview confirmation', () => {
    for (const Status1 of ['R', 'IT', 'N', 'EO']) {
        for (const code of ['', '0', '-']) {
            const source = newStudent({ Status1, 'รหัสคุมอง': code, 'วันเกิด': '01/01/2563' });
            const doc = newDocument(); doc.rows[0].kumonId = code; doc.rows[0].fullName = ' ตัวอย่าง   ทดสอบ ';
            const rows = planKsisReportDraft([source], doc, period, 'ME', { includeZun: false });
            assert.equal(rows[0].ready, true);
            assert.equal(rows[0].matchMethod, 'name_birth_date');
            assert.equal(rows[0].requiresIdentityConfirmation, true);
            assert.equal(rows[0].birthDate, source['วันเกิด']);
            assert.equal(groupKsisStudentBatches(rows).length, 0);
            const unconfirmed = selectConfirmedKsisDraftRows(rows);
            assert.equal(unconfirmed[0].ready, false);
            assert.match(unconfirmed[0].reason, /ยังไม่ได้ยืนยัน/);
            const confirmed = selectConfirmedKsisDraftRows(rows, [{ enrollmentId: 1, key: 'student-me' }]);
            assert.equal(confirmed[0].identityConfirmed, true);
            assert.equal(groupKsisStudentBatches(confirmed)[0].length, 1);
            assert.equal(rows[0].identityConfirmed, undefined);
            assert.equal(source['รหัสคุมอง'], code);
        }
    }
});

test('An already-matching fixed ST1 is accepted without permission to change it; mismatched or empty fixed values are blocked', () => {
    for (const Status1 of ['R', 'IT', 'N', 'EO']) {
        const doc = newDocument();
        doc.rows[0].status = { value: Status1, writable: false, options: null };
        const [row] = planKsisReportDraft([newStudent({ Status1 })], doc, period, 'ME', { includeZun: false });
        assert.equal(row.ready, true);
        assert.equal(row.desired.status, Status1);
        for (const value of ['', 'C']) {
            doc.rows[0].status.value = value;
            assert.match(planKsisReportDraft([newStudent({ Status1 })], doc, period, 'ME')[0].reason, /ไม่อนุญาต ST1/);
        }
    }
});

test('Only recognized required-WS notices already present before filling are informational', () => {
    const notices = ['กรุณาใส่หน้าแบบฝึกหัด', '(เตือน) กรุณาใส่จำนวนแบบฝึกหัดที่ใช้', '(เตือน) กรุณาใส่จำนวนวนแบบฝึกหัดที่ใช้'];
    for (const text of [...notices, notices.join('; ')]) assert.equal(isUnchangedKsisWorksheetNotice(text, text), true);
    for (const [current, previous] of [[notices[1], ''], [notices[1], notices[0]], ['', ''],
        ['จำนวนแบบฝึกหัดไม่ถูกต้อง', 'จำนวนแบบฝึกหัดไม่ถูกต้อง'],
        [`${notices[1]}; ข้อมูลผิด`, `${notices[1]}; ข้อมูลผิด`]]) {
        assert.equal(isUnchangedKsisWorksheetNotice(current, previous), false);
    }
});

test('ID-less matching never guesses duplicates, different birthdays, names, subjects or malformed existing codes', () => {
    const cases = [
        [newStudent({ 'วันเกิด': '' }), newDocument(), /วันเกิดไม่ครบ/],
        [newStudent({ 'ชื่อจริง': ' ' }), newDocument(), /ชื่อ/],
        [newStudent({ 'วันเกิด': '02/01/2020' }), newDocument(), /ไม่พบชื่อ/],
        [newStudent({ 'ชื่อจริง': 'คนอื่น' }), newDocument(), /ไม่พบชื่อ/],
        [newStudent({ Subject: 'EFL' }), newDocument(), /ไม่พบชื่อ/],
        [newStudent({ 'รหัสคุมอง': '123456789' }), newDocument(), /13 หลัก/],
        [newStudent({ Status1: 'C' }), newDocument(), /13 หลัก/]
    ];
    const withCode = newDocument(); withCode.rows[0].kumonId = '7642650000001';
    cases.push([newStudent(), withCode, /KSIS มีรหัส/]);
    const duplicateSite = newDocument(); duplicateSite.rows.push({ ...duplicateSite.rows[0], key: 'other', studentKey: 'header:1' });
    cases.push([newStudent(), duplicateSite, /ซ้ำใน KSIS/]);
    for (const [source, doc, reason] of cases) {
        const row = planKsisReportDraft([source], doc, period, source.Subject, { includeZun: false })[0];
        assert.equal(row.ready, false); assert.match(row.reason, reason);
    }
    for (const other of [newStudent({ ID: 2 }), newStudent({ ID: 2, StudentId: 200, Subject: 'EFL' })]) {
        const rows = planKsisReportDraft([newStudent(), other], newDocument(), period, 'ALL', { includeZun: false });
        assert.ok(rows.every((row) => !row.ready)); assert.match(rows[0].reason, /ซ้ำในรายงาน/);
    }
    const splitSite = newDocument(); splitSite.rows.push({ ...splitSite.rows[0], key: 'efl', subject: 'EFL', studentKey: 'header:1' });
    assert.match(planKsisReportDraft([newStudent()], splitSite, period, 'ME')[0].reason, /ซ้ำใน KSIS/);
});

test('Confirmation rejects unknown, duplicated, blocked and ID-based rows and never enables other unconfirmed students', () => {
    const rows = planKsisReportDraft([newStudent()], newDocument(), period, 'ME', { includeZun: false });
    const selection = { enrollmentId: 1, key: 'student-me' };
    for (const invalid of [null, {}, [null], [selection, selection], [{ ...selection, key: 'other' }], [{ ...selection, enrollmentId: 2 }]]) {
        assert.throws(() => selectConfirmedKsisDraftRows(rows, invalid), { statusCode: 400 });
    }
    assert.throws(() => selectConfirmedKsisDraftRows([{ ...rows[0], ready: false }], [selection]), { statusCode: 400 });
    assert.throws(() => selectConfirmedKsisDraftRows([{ ...rows[0], requiresIdentityConfirmation: false }], [selection]), { statusCode: 400 });
    const second = { ...rows[0], enrollmentId: 2, key: 'two', studentKey: 'local:200' };
    assert.deepEqual(selectConfirmedKsisDraftRows([...rows, second], [selection]).map((row) => row.ready), [true, false]);
    const absent = newDocument(); absent.rows[0].status.value = 'A';
    assert.equal(planKsisReportDraft([newStudent()], absent, period, 'ME')[0].skipped, true);
});

test('ID-less students remain distinct for ten-student saves, summaries and multiple subjects', () => {
    const rows = Array.from({ length: 23 }, (_, index) => ['ME', 'EFL'].map((subject) => ({
        enrollmentId: `${index}-${subject}`, key: `${index}-${subject}`, kumonId: '', studentKey: `local:${index}`,
        subject, ready: true, requiresIdentityConfirmation: true, identityConfirmed: true,
        desired: { status: 'N' }, before: { status: { value: 'C' } }
    }))).flat();
    assert.deepEqual(groupKsisStudentBatches(rows).map((batch) => batch.length), [20, 20, 6]);
    assert.equal(summarizeKsisDraft(rows, rows.map((row) => row.key)).studentsFilled, 23);
});

test("WS saves require explicit consent and only allow the exact observed batch endpoint", async () => {
    await assert.rejects(applyKsisReportDraft({ userId: 1, previewId: "old-client" }), { statusCode: 400 });
    const url = "https://kao.ksis.kumon.com/kth/api/reportb/SaveReportBDetailEntryEditItemBatch";
    for (const type of ["fetch", "xhr"]) assert.equal(isKsisWsSaveRequest("POST", url, type), true);
    for (const [method, target, type] of [["PUT", url, "xhr"], ["POST", url, "document"],
        ["POST", `${url}?save=1`, "xhr"], ["POST", `${url}/other`, "xhr"],
        ["POST", url.replace("kao.ksis.kumon.com", "other.example"), "xhr"],
        ["POST", url.replace("https:", "http:"), "xhr"],
        ["POST", "https://kao.ksis.kumon.com/kth/api/levelz/SaveLevelZ", "xhr"]]) {
        assert.equal(isKsisWsSaveRequest(method, target, type), false);
    }
});

test("Save batches count ten students, keep all their subjects together and save a final remainder", () => {
    const rows = ["ME", "EFL", "TRP"].flatMap((subject) => Array.from({ length: 23 }, (_, index) => ({
        kumonId: `student-${index}`, subject, key: `${index}-${subject}`, ready: true,
        desired: { status: "C" }, before: { status: { value: "C" } }
    })));
    rows.push({ ...rows[0], kumonId: "absent", skipped: true });
    rows.push({ ...rows[0], kumonId: "invalid", ready: false });
    rows.push({ ...rows[0], kumonId: "absent-ksis", before: { status: { value: "A" } } });
    const batches = groupKsisStudentBatches(rows);
    assert.deepEqual(batches.map((batch) => new Set(batch.map((row) => row.kumonId)).size), [10, 10, 3]);
    assert.deepEqual(batches.map((batch) => batch.length), [30, 30, 9]);
    assert.equal(new Set(batches.flat().map((row) => row.key)).size, 69);
    assert.deepEqual(batches[0].slice(0, 3).map((row) => row.subject), ["ME", "EFL", "TRP"]);
    assert.deepEqual(groupKsisStudentBatches([]), []);
    assert.throws(() => groupKsisStudentBatches(rows, 0), RangeError);
});

test("Draft permits only the observed Zun read POST, never arbitrary Get paths or writes", () => {
    const url = "https://kao.ksis.kumon.com/kth/api/levelz/GetLevelZListByStudent";
    for (const type of ["fetch", "xhr"]) assert.equal(isKsisDraftReadRequest("POST", url, type), true);
    for (const [method, target, type] of [
        ["PUT", url, "xhr"], ["DELETE", url, "xhr"], ["POST", url, "document"],
        ["POST", `${url}?action=save`, "xhr"], ["POST", `${url}/Save`, "xhr"],
        ["POST", url.replace("GetLevelZListByStudent", "SaveLevelZ"), "xhr"],
        ["POST", url.replace("GetLevelZListByStudent", "GetOtherData"), "xhr"],
        ["POST", url.replace("kao.ksis.kumon.com", "other.example"), "xhr"],
        ["POST", url.replace("https:", "http:"), "xhr"],
        ["POST", "https://kao.ksis.kumon.com/kth/api/reportb/Save", "xhr"]
    ]) assert.equal(isKsisDraftReadRequest(method, target, type), false, `${method} ${target}`);
    for (const method of ["GET", "HEAD", "OPTIONS"]) assert.equal(isKsisDraftReadRequest(method, url, "xhr"), true);
});

test("Draft skips A in either source without changing A to R, even for KC", () => {
    const reportAbsent = planKsisReportDraft([record({ Status1: "A", IsKc: true })], document(), period, "ME")[0];
    assert.equal(reportAbsent.ready, false); assert.equal(reportAbsent.skipped, true);
    const absent = document(); absent.rows[0].status.value = "A";
    const returning = planKsisReportDraft([record({ Status1: "R" })], absent, period, "ME")[0];
    assert.equal(returning.ready, false); assert.equal(returning.skipped, true);
    assert.match(returning.reason, /ข้ามสถานะ A/);
});

test("KC uses exactly one WS while paper WS totals remain unchanged", () => {
    for (const WksUsed of [0, 17, NaN]) {
        const source = record({ IsKc: true, WksUsed });
        const [row] = planKsisReportDraft([source], document(), period, "ME");
        assert.equal(row.isKc, true); assert.equal(row.desired.used, 1); assert.equal(row.ready, true);
        assert.equal(source.WksUsed, WksUsed);
    }
    assert.equal(planKsisReportDraft([record({ IsKc: false, WksUsed: 17 })], document(), period, "ME")[0].desired.used, 17);
});

test("Fill summary separates verified successes, failed rows, skipped A and unattempted rows", () => {
    const doc = document();
    doc.rows = ["ME", "EFL", "TRP"].map((subject) => ({ ...doc.rows[0], subject, key: subject }));
    const rows = planKsisReportDraft([record(), record({ ID: 2, Subject: "EFL" }), record({ ID: 3, Subject: "TRP" })], doc, period, "ALL");
    rows.push({ ...rows[0], key: "absent", skipped: true, ready: false });
    const summary = summarizeKsisDraft(rows, ["ME"], "EFL", "WS used ต้องการ 5 แต่ KSIS แสดง 0");
    assert.deepEqual(summary.rows.map((row) => row.outcome), ["filled", "failed", "not_started", "skipped"]);
    assert.equal(summary.filled, 1); assert.equal(summary.studentsFilled, 1); assert.equal(summary.skipped, 1);
    assert.equal(summary.stopped, true);
    assert.match(summary.rows[1].resultReason, /WS used/);
    assert.equal(summarizeKsisDraft(rows, ["ME", "EFL", "TRP"]).studentsFilled, 1);
});

test("All-subject draft plans ME, EFL and TRP separately for the same student", () => {
    const doc = document();
    doc.rows = ["ME", "EFL", "TRP"].map((subject) => ({ ...doc.rows[0], subject, key: `student-${subject}` }));
    const records = ["TRP", "EFL", "ME", "OTHER"].map((Subject, index) => record({ ID: index + 1, Subject, WksUsed: index + 4 }));
    const rows = planKsisReportDraft(records, doc, period, "ALL");
    assert.deepEqual(rows.map((row) => row.subject), ["ME", "EFL", "TRP"]);
    assert.deepEqual(rows.map((row) => row.desired.used), [6, 5, 4]);
    assert.ok(rows.every((row) => row.ready));
    for (const subject of ["ME", "EFL", "TRP"]) {
        assert.deepEqual(planKsisReportDraft(records, doc, period, subject).map((row) => row.subject), [subject]);
    }
    assert.throws(() => planKsisReportDraft(records, doc, period, "OTHER"), { statusCode: 400 });
});

test("Intentional unfilled filter notices remain informational in successful and partial summaries", () => {
    const doc = document();
    doc.rows = ["ME", "EFL", "TRP"].map((subject) => ({ ...doc.rows[0], subject, key: subject }));
    const rows = planKsisReportDraft([record(), record({ ID: 2, Subject: "EFL" }), record({ ID: 3, Subject: "TRP", Status1: "A" })], doc, period, "ALL");
    const notices = ["ME", "EFL", "TRP"].map((key) => ({ key, message: "KSIS ยังแสดงข้อความตัวกรองเดิม" }));
    const summary = summarizeKsisDraft(rows, ["ME"], "EFL", "หน้าที่อ่านกลับไม่ตรง", notices);
    assert.deepEqual(summary.rows.map((row) => row.outcome), ["filled", "failed", "skipped"]);
    assert.equal(summary.filterNotices, 1); assert.equal(summary.filled, 1);
    assert.equal(summary.rows[0].resultReason, notices[0].message);
    assert.equal(summary.rows[1].resultReason, "หน้าที่อ่านกลับไม่ตรง");
    const success = summarizeKsisDraft(rows, ["ME", "EFL"], null, "", notices);
    assert.equal(success.stopped, false); assert.equal(success.filterNotices, 2);
});

test("All-subject preview keeps invalid and off-page subjects isolated", () => {
    const doc = document();
    doc.rows.push({ ...doc.rows[0], subject: "EFL", key: "student-efl" });
    const rows = planKsisReportDraft([record(), record({ ID: 2, Subject: "EFL", CurrentLevel: "C85" }), record({ ID: 3, Subject: "TRP" })], doc, period, "ALL");
    assert.equal(rows[0].ready, true);
    assert.equal(rows[1].ready, false);
    assert.match(rows[2].reason, /ไม่อยู่ในหน้า/);
});

test("Zun ends at page 100 from packet 91 and never allows a main-level page 190", () => {
    assert.equal(planKsisReportDraft([record({ ZIIWorksheetNo: 100 })], document(), period, "ME")[0].ready, true);
    for (const page of [0, -10, 95, 110, 190, null]) {
        assert.match(planKsisReportDraft([record({ ZIIWorksheetNo: page })], document(), period, "ME")[0].reason, /Zun Zun/);
    }
});

test("KSIS draft plans main fields, separate ZI/ZII and AT, excluding DT", () => {
    const [row] = planKsisReportDraft([record({ TestType: "DT", Score: 99, TestType1: "AT", DateTest1: "01/10/2569", LevelTest1: "C", Time1: 120, Score1: 0, Group1: 5 })], document(), period, "ME", { includeAt: true });
    assert.equal(row.ready, true);
    assert.equal(row.desired.worksheet, 90);
    assert.deepEqual(row.desired.zun, [{ level: "ZI", used: 2, worksheet: 30 }, { level: "ZII", used: 3, worksheet: 50 }]);
    assert.deepEqual(row.desired.at, [{ date: "2026-10-01", level: "C", time: 120, score: 0, group: 5, passed: true }]);
    assert.deepEqual(ksisContextPeriod(document().context), period);
});

test("KSIS draft validates every AT slot and rejects duplicates, but does not cap time", () => {
    const at = { TestType: "AT", DateTest: "01/10/2026", LevelTest: "C", Time: 150, Score: 71, Group: 4 };
    assert.equal(planKsisReportDraft([record(at)], document(), period, "ME", { includeAt: true })[0].ready, true);
    for (const extra of [{ Time: "" }, { Score: null }, { Group: 6 }, { DateTest: "31/02/2026" }, { LevelTest: "" }]) {
        assert.match(planKsisReportDraft([record({ ...at, ...extra })], document(), period, "ME", { includeAt: true })[0].reason, /ข้อมูล AT/);
    }
    const duplicate = Object.fromEntries(Object.entries(at).map(([key, value]) => [`${key}2`, value]));
    assert.match(planKsisReportDraft([record({ ...at, ...duplicate })], document(), period, "ME", { includeAt: true })[0].reason, /AT ซ้ำ/);
});

test("WS plus Zun is the default and ignores AT data and AT validation unless explicitly enabled", () => {
    const source = record({ TestType: "AT", DateTest: "bad-date", LevelTest: "C", Time: null, Score: null, Group: 9 });
    for (const options of [undefined, { includeAt: false }, { includeAt: "true" }]) {
        const [row] = planKsisReportDraft([source], document(), period, "ME", options);
        assert.equal(row.ready, true); assert.deepEqual(row.desired.at, []);
        assert.equal(row.desired.zun.length, 2); assert.equal(row.desired.used, 8);
    }
    assert.equal(planKsisReportDraft([source], document(), period, "ME", { includeAt: true })[0].ready, false);
});

test("Basic production scope excludes Zun and AT entirely, including their validation failures", () => {
    const source = record({ ZIIWorksheetNo: 190, TestType: "AT", DateTest: "bad-date", Time: null, Group: 9 });
    const [row] = planKsisReportDraft([source], document(), period, "ME", { includeAt: false, includeZun: false });
    assert.equal(row.ready, true);
    assert.deepEqual(row.desired, { level: "C", worksheet: 90, used: 8, status: "C", at: [], zun: [] });
    assert.equal(source.ZIIWorksheetNo, 190); assert.equal(source.TestType, "AT");
});

test("KSIS draft never rounds an invalid current WS and does not guess unsupported statuses", () => {
    assert.equal(planKsisReportDraft([record({ CurrentLevel: "C85" })], document(), period, "ME")[0].ready, false);
    assert.equal(planKsisReportDraft([record({ Status1: "N" })], document(), period, "ME")[0].ready, false);
});

test("KSIS draft blocks wrong periods and unsaved edits before any fill", () => {
    assert.throws(() => planKsisReportDraft([record()], document(), { month: 9, year: 2026 }, "ME"), { statusCode: 409 });
    const dirty = document(); dirty.rows[0].dirty = true;
    assert.throws(() => planKsisReportDraft([record()], dirty, period, "ME"), { statusCode: 409 });
});

test("KSIS draft isolates missing IDs, duplicate IDs, wrong DOB and other pages", () => {
    assert.equal(planKsisReportDraft([record({ "รหัสคุมอง": "" })], document(), period, "ME")[0].ready, false);
    assert.ok(planKsisReportDraft([record(), record({ ID: 2 })], document(), period, "ME").every((row) => !row.ready));
    assert.equal(planKsisReportDraft([record({ "วันเกิด": "01/01/2021" })], document(), period, "ME")[0].ready, false);
    assert.match(planKsisReportDraft([record({ "รหัสคุมอง": "7642650000002" })], document(), period, "ME")[0].reason, /ไม่อยู่ในหน้า/);
});
