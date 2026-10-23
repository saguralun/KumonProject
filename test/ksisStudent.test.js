import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright-core";
import vm from "node:vm";
import { normalizeKsisStudentUrl, normalizeKsisBirthDate, normalizeKsisStudentData, readKsisStudentDocument } from "../services/ksisStudentData.js";
import { previewKsisStudent, ksisProfileDirectory, withKsisPage } from "../services/ksisStudentService.js";
import { ksisPreviewFields, splitKsisStreet, ksisPrefixName } from "../public/js/ksisStudentMapping.js";

const url = "https://kao.ksis.kumon.com/kth/#/student/11111111-1111-4111-8111-111111111111";
const raw = { firstName: "ตัวอย่าง", lastName: "ทดสอบ", birthDate: "29/06/2023", gender: "หญิง", grade: "PK3", addressLine2: "19" };

test("KSIS only accepts exact student links on the allowed origin", () => {
    assert.equal(normalizeKsisStudentUrl(url), url);
    for (const invalid of ["http://127.0.0.1/", url.replace("https:", "http:"), url.replace("kao.ksis.kumon.com", "kao.ksis.kumon.com.evil.test"),
        url.replace("/student/", "/login/"), url.replace("/kth/", "/other/"), url.replace("/kth/", "/kth/?x=1"), url.replace("https://", "https://user:password@")]) {
        assert.throws(() => normalizeKsisStudentUrl(invalid), { statusCode: 400 });
    }
});

test("birth date handles AD and BE and rejects impossible dates", () => {
    assert.equal(normalizeKsisBirthDate("29/06/2023"), "2023-06-29");
    assert.equal(normalizeKsisBirthDate("29/06/2566"), "2023-06-29");
    assert.equal(normalizeKsisBirthDate("29/02/2023"), "");
    assert.equal(normalizeKsisBirthDate("31/04/2569"), "");
});

test("preview maps master IDs without mistaking middle names or alley/road for other fields", () => {
    const student = normalizeKsisStudentData({ ...raw, additional1Name: "ชื่อกลาง", personalId: "do-not-import" });
    const fields = ksisPreviewFields(student, { genders: [{ id: 2, name: "หญิง" }], grades: [{ id: 1, label: "เตรียมอ. (PK3)" }] });
    assert.equal(fields.find((row) => row.field === "genderId").value, 2);
    assert.equal(fields.find((row) => row.field === "schoolGradeId").value, 1);
    assert.equal(fields.find((row) => row.field === "addressAlley").value, "19");
    assert.equal(fields.find((row) => row.field === "addressRoad").value, "");
    assert.ok(!fields.some((row) => row.field === "nickname"));
    assert.ok(!("personalId" in student));
    assert.throws(() => normalizeKsisStudentData({ firstName: "" }), { statusCode: 422 });
});

test("numeric and named street parts become alley and road", () => {
    assert.deepEqual(splitKsisStreet("9 เจษฏา"), { alley: "9", road: "เจษฏา", unparsed: "" });
    assert.deepEqual(splitKsisStreet(""), { alley: "", road: "", unparsed: "" });
    assert.deepEqual(splitKsisStreet("   "), { alley: "", road: "", unparsed: "" });
    assert.deepEqual(splitKsisStreet("๙ เจษฏา"), { alley: "๙", road: "เจษฏา", unparsed: "" });
    assert.deepEqual(splitKsisStreet("19"), { alley: "19", road: "", unparsed: "" });
    for (const value of ["เจษฏา 9", "เจษฏา", "ถนน เจษฏา", "ซอย 9 ถนนเจษฏา", "ซ.9 ถ.เจษฏา"]) {
        assert.deepEqual(splitKsisStreet(value), { alley: "", road: value, unparsed: "" });
        const fields = ksisPreviewFields({ ...raw, addressLine2: value }, { genders: [], grades: [] });
        assert.equal(fields.find((row) => row.field === "addressRoad").value, value);
        assert.equal(fields.find((row) => row.field === "addressAlley").value, "");
    }
    assert.deepEqual(splitKsisStreet("9 เจษฏา พัฒนา"), { alley: "9", road: "เจษฏา พัฒนา", unparsed: "" });
    assert.deepEqual(splitKsisStreet("9 เจษฏา 10"), { alley: "9", road: "เจษฏา 10", unparsed: "" });
    for (const value of ["9 10", "9 -"]) {
        assert.deepEqual(splitKsisStreet(value), { alley: "", road: "", unparsed: value });
    }
    const fields = ksisPreviewFields({ ...raw, addressLine2: "9 เจษฏา" }, { genders: [], grades: [] });
    assert.equal(fields.find((row) => row.field === "addressAlley").value, "9");
    assert.equal(fields.find((row) => row.field === "addressRoad").value, "เจษฏา");
    assert.ok(!fields.some((row) => row.field === "remark"));
});

test("prefix uses child titles below 15 and adult titles from the 15th birthday", () => {
    for (const [gender, child, adult] of [["ชาย", "ด.ช.", "นาย"], ["หญิง", "ด.ญ.", "นางสาว"]]) {
        assert.equal(ksisPrefixName("2011-10-20", gender, "2026-10-19"), child);
        assert.equal(ksisPrefixName("2011-10-19", gender, "2026-10-19"), adult);
        assert.equal(ksisPrefixName("2000-10-19", gender, "2026-10-19"), adult);
    }
    for (const birthDate of ["", "2023-02-29", "2030-01-01"]) assert.equal(ksisPrefixName(birthDate, "หญิง", "2026-10-19"), "");
    assert.equal(ksisPrefixName("2011-10-19", "ไม่ทราบ", "2026-10-19"), "");
});

test("DOM reader reads only student and contact email fields, not private guardian details", () => {
    const observedIds = [];
    const document = { getElementById(id) {
        observedIds.push(id);
        if (id === "firstName") return { value: "ตัวอย่าง" };
        if (id === "lastName") return { value: "ทดสอบ" };
        return null;
    } };
    const student = vm.runInNewContext(`(${readKsisStudentDocument.toString()})()`, { document });
    assert.equal(student.firstName, "ตัวอย่าง");
    assert.ok(observedIds.every((id) => !/personalId|piAccept|password/i.test(id)));
    assert.ok(observedIds.filter((id) => id.startsWith("guardian")).every((id) => /^guardian(Mother|Father|Other)Email(Presence)?$/.test(id)));
});

test("contact emails honor disabled fields and no-email reasons", () => {
    const elements = {
        firstName: { value: "ตัวอย่าง" }, lastName: { value: "ทดสอบ" },
        guardianMotherEmail: { value: "mother@example.test", disabled: true },
        guardianMotherEmailPresence: { selectedOptions: [{ textContent: "ไม่ทราบ" }] },
        guardianFatherEmail: { value: "father@example.test" },
        guardianFatherEmailPresence: { selectedOptions: [{ textContent: "---" }] },
        guardianOtherEmail: { value: "other@example.test" },
        guardianOtherEmailPresence: { selectedOptions: [{ textContent: "ข้าพเจ้าไม่ประสงค์ที่จะให้ Email" }] }
    };
    const raw = vm.runInNewContext(`(${readKsisStudentDocument.toString()})()`, { document: { getElementById: (id) => elements[id] } });
    const data = normalizeKsisStudentData(raw);
    assert.deepEqual(data.emailCandidates, [{ source: "บิดา", email: "father@example.test" }]);
    assert.equal(data.email, "father@example.test");
    elements.guardianFatherEmail.value = "";
    const empty = normalizeKsisStudentData(vm.runInNewContext(`(${readKsisStudentDocument.toString()})()`, { document: { getElementById: (id) => elements[id] } }));
    assert.equal(empty.email, "");
    assert.equal(empty.emailCandidates.length, 0);
});

test("multiple contact emails offer one default selection with the source shown", () => {
    const data = normalizeKsisStudentData({ ...raw, emailCandidates: [
        { source: "มารดา", email: "mother@example.test" }, { source: "บิดา", email: "father@example.test" }
    ] });
    const choices = ksisPreviewFields(data, { genders: [], grades: [] }).filter((row) => row.field === "email");
    assert.equal(choices.length, 2);
    assert.equal(choices.filter((row) => row.selected).length, 1);
    assert.ok(choices.every((row) => row.radio));
    assert.match(choices[0].label, /มารดา/);
});

test("KSIS profile is isolated per KumonDB account", () => {
    assert.notEqual(ksisProfileDirectory(1), ksisProfileDirectory(2));
});

test("preview asks for manual login and reuses the isolated session afterward", async (t) => {
    let currentUrl = "about:blank";
    let loggedIn = false;
    let launches = 0;
    const page = {
        isClosed: () => false, bringToFront: async () => {}, url: () => currentUrl,
        goto: async (target) => { currentUrl = target === url && !loggedIn ? target.replace("#/student/", "#/login/student/") : target; },
        waitForFunction: async () => {}, evaluate: async (reader) => reader.name === 'readKsisStudentDocument' ? raw : false
    };
    t.mock.method(chromium, "launchPersistentContext", async (profile, options) => {
        launches++;
        assert.equal(options.headless, false);
        assert.equal(options.channel, "chrome");
        return { pages: () => [page], on() {} };
    });
    assert.equal((await previewKsisStudent({ url, userId: 987654 })).requiresLogin, true);
    loggedIn = true;
    currentUrl = url;
    const result = await previewKsisStudent({ url, userId: 987654 });
    assert.equal(result.requiresLogin, false);
    assert.equal(result.student.birthDate, "2023-06-29");
    assert.equal(launches, 1);
});

test('Changing KSIS routes never navigates through about:blank or launches another browser session', async (t) => {
    let currentUrl = 'https://kao.ksis.kumon.com/kth/#/reportbeditgrid';
    const visits = []; let launches = 0;
    const page = { isClosed: () => false, bringToFront: async () => {}, url: () => currentUrl, evaluate: async () => false, goto: async (target) => { visits.push(target); currentUrl = target; } };
    t.mock.method(chromium, 'launchPersistentContext', async () => { launches++; return { pages: () => [page], on() {} }; });
    for (const sourceUrl of [currentUrl, url, 'https://kao.ksis.kumon.com/kth/#/reportbeditgrid']) await withKsisPage({ sourceUrl, userId: 987655 }, async () => {});
    assert.deepEqual(visits, [url, 'https://kao.ksis.kumon.com/kth/#/reportbeditgrid']);
    assert.equal(launches, 1);
});

test('KSIS navigation refuses untracked dirty edits and never navigates a consumed preview to another page', async (t) => {
    let dirty = true;
    const visits = [];
    const page = { isClosed: () => false, bringToFront: async () => {}, url: () => 'https://kao.ksis.kumon.com/kth/#/reportbeditgrid',
        evaluate: async () => dirty, goto: async (target) => visits.push(target) };
    t.mock.method(chromium, 'launchPersistentContext', async () => ({ pages: () => [page], on() {} }));
    const options = { sourceUrl: 'https://kao.ksis.kumon.com/kth/#/atestentrygrid', userId: 987656 };
    await assert.rejects(withKsisPage(options, async () => assert.fail('Must not navigate')), { statusCode: 409 });
    dirty = false;
    await assert.rejects(withKsisPage({ ...options, requireCurrentPage: true }, async () => assert.fail('Must not navigate')), { statusCode: 409 });
    assert.deepEqual(visits, []);
});
