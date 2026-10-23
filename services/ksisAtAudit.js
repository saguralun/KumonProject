import { buildMonthlyReport, periodDateRange } from './reportService.js';
import { withKsisWorkspacePage as withKsisPage } from './ksisStudentService.js';
import { KSIS_AT_URL, readKsisAtDocument, sameKsisAt, isBlankKsisAt } from './ksisAtEntry.js';
import { ksisContextPeriod } from './ksisReportDraft.js';
import { readKsisRosterDocument } from './ksisRosterService.js';
import { matchKsisReportIdentity } from './ksisReportIdentity.js';
import { normalizeKsisBirthDate } from './ksisStudentData.js';
import { normalizeKumonStudentId } from './kumonStudentId.js';
import { httpError } from './httpError.js';

const subjects = { ME: 'Math', EFL: 'English EFL', TRP: 'Thai Reading' };
const readUrl = 'https://kao.ksis.kumon.com/kth/api/reportb/GetReportBTestResultEntryListPageByCriteria';
const readUrls = new Set([readUrl, 'https://kao.ksis.kumon.com/kth/api/reportb/GetReportBTestResultErrorCount']);
const outcomes = ['matched', 'mismatch', 'review', 'missing_ksis', 'missing_report'];
const numeric = (value) => value == null || String(value).trim() === '' ? null : Number(value);
const values = (test) => test ? ({ date: normalizeKsisBirthDate(test.date.value), level: test.level.value,
    time: numeric(test.time.value), score: numeric(test.score.value), group: numeric(test.group.code || test.group.value.replace(/^G\s*/, '')), passed: test.passed }) : null;

export function isKsisAtAuditReadRequest(method, url, type) {
    return ['GET', 'HEAD', 'OPTIONS'].includes(method) || method === 'POST' && ['xhr', 'fetch'].includes(type) && readUrls.has(url);
}

export function compareKsisAt(records, documents, { month, year, subject, scope = 'current' }) {
    if (!Object.hasOwn(subjects, subject) || !['current', 'all'].includes(scope)) throw httpError(400, 'กรุณาเลือกวิชาและขอบเขตการตรวจ AT');
    const range = periodDateRange(Number(month), Number(year));
    const website = [], headers = new Map(), seenTests = new Set();
    let ignoredBlankRows = 0, outsidePeriod = 0, outsidePage = 0;
    for (const doc of documents) for (const student of doc.students) {
        if (student.subject !== subject) continue;
        const identity = JSON.stringify([student.studentKey || `${doc.page}:${student.key}`, student.kumonId, student.fullName, student.birthDate, subject]);
        let merged = headers.get(identity);
        if (!merged) { merged = { ...student, page: doc.page, tests: [] }; headers.set(identity, merged); website.push(merged); }
        for (const test of student.tests) {
            if (isBlankKsisAt(test)) { ignoredBlankRows++; continue; }
            const date = normalizeKsisBirthDate(test.date.value);
            if (date && (date < range.start || date >= range.end)) { outsidePeriod++; continue; }
            const key = test.key ? JSON.stringify([identity, test.key, values(test), test.error, test.dirty]) : null;
            if (key && seenTests.has(key)) continue;
            if (key) seenTests.add(key);
            merged.tests.push({ ...test, page: doc.page });
        }
    }
    const rows = [], claimed = new Set();
    for (const record of records.filter((item) => item.Subject === subject)) {
        const expected = ['', '1', '2'].filter((suffix) => record[`TestType${suffix}`] === 'AT').map((suffix) => ({ suffix,
            date: normalizeKsisBirthDate(record[`DateTest${suffix}`]), level: String(record[`LevelTest${suffix}`] || '').trim(),
            time: numeric(record[`Time${suffix}`]), score: numeric(record[`Score${suffix}`]), group: numeric(record[`Group${suffix}`]), passed: true }));
        const match = matchKsisReportIdentity(record, records, website), target = match.targets[0];
        for (const desired of expected) {
            if (scope === 'current' && !target && !match.reason) { outsidePage++; continue; }
            const sameEvent = target?.tests.filter((test) => normalizeKsisBirthDate(test.date.value) === desired.date && test.level.value === desired.level) || [];
            const exact = sameEvent.filter((test) => sameKsisAt(test, desired));
            const actual = exact[0] || sameEvent[0] || null;
            for (const test of sameEvent) claimed.add(test);
            const row = { key: `${record.ID}:${desired.suffix || '0'}`, name: `${record['ชื่อจริง'] || ''} ${record['นามสกุล'] || ''}`.trim(),
                kumonId: normalizeKumonStudentId(record['รหัสคุมอง']), birthDate: record['วันเกิด'], subject, matchMethod: match.method,
                page: actual?.page || target?.page || null, expected: desired, actual: values(actual), differences: [], outcome: 'matched', reason: '' };
            let reason = match.reason;
            if (!reason && target && (!normalizeKsisBirthDate(record['วันเกิด']) || normalizeKsisBirthDate(record['วันเกิด']) !== normalizeKsisBirthDate(target.birthDate))) reason = 'วันเกิดไม่ตรงกันหรือไม่ครบ';
            if (!reason && (!desired.date || desired.date < range.start || desired.date >= range.end || !desired.level
                || !Number.isInteger(desired.time) || desired.time < 0 || desired.time > 999 || !Number.isInteger(desired.score) || desired.score < 0 || desired.score > 999
                || !Number.isInteger(desired.group) || desired.group < 1 || desired.group > 5)) reason = 'ข้อมูล AT ใน Report ไม่ครบหรืออยู่นอกงวด 21–20';
            if (!reason && expected.filter((test) => test.date === desired.date && test.level === desired.level).length > 1) reason = 'มีผลสอบวันและระดับเดียวกันซ้ำใน Report';
            if (!reason && sameEvent.length > 1) reason = 'มีผลสอบวันและระดับเดียวกันหลายแถวใน KSIS';
            if (!reason && actual && (actual.dirty || actual.error)) reason = actual.error || 'มีข้อมูล AT ที่ยังไม่บันทึก';
            if (reason) { row.outcome = 'review'; row.reason = reason; }
            else if (!actual) { row.outcome = 'missing_ksis'; row.reason = target ? 'ไม่พบผลสอบวันที่และระดับนี้ใน KSIS' : 'ไม่พบเด็กในหน้าที่ตรวจ กรุณาตรวจตัวกรอง'; }
            else {
                for (const [field, label] of [['date', 'วันที่'], ['level', 'ระดับ'], ['time', 'เวลา'], ['score', 'คะแนน'], ['group', 'Group'], ['passed', 'ผ่าน']]) {
                    if (row.actual[field] !== desired[field]) row.differences.push({ field, label, expected: desired[field], actual: row.actual[field] });
                }
                if (row.differences.length) { row.outcome = 'mismatch'; row.reason = row.differences.map((item) => item.label).join(', '); }
            }
            rows.push(row);
        }
        // Ambiguous identity cannot be reported as a confident extra result for a different student.
        if (match.reason) for (const student of match.targets) for (const test of student.tests) claimed.add(test);
    }
    for (const student of website) for (const test of student.tests) if (!claimed.has(test)) rows.push({
        key: `ksis:${student.studentKey}:${test.key}:${test.page}`, name: student.fullName, kumonId: student.kumonId, birthDate: student.birthDate,
        subject, page: test.page, expected: null, actual: values(test), differences: [], outcome: test.error || test.dirty ? 'review' : 'missing_report',
        reason: test.error || (test.dirty ? 'มีข้อมูล AT ที่ยังไม่บันทึก' : 'ไม่พบผลสอบนี้ใน Report ของงวดที่เลือก')
    });
    return { rows, outsidePage, ignoredBlankRows, outsidePeriod, range,
        counts: Object.fromEntries(outcomes.map((outcome) => [outcome, rows.filter((row) => row.outcome === outcome).length])) };
}

export async function readSavedKsisAtPages(page, { month, year, subject, scope = 'current' }) {
    if (!Object.hasOwn(subjects, subject) || !['current', 'all'].includes(scope)) throw httpError(400, 'กรุณาเลือก AT ทีละวิชาและขอบเขตการตรวจ');
    const load = async () => {
        await page.waitForFunction(() => location.hash.includes('/login') || Boolean(document.querySelector('#btnToolbarFilterSort')?.disabled === false && document.querySelector('.filter-label-container .filter-label-item')?.textContent.trim()), {}, { timeout: 20000 });
        if (page.url().includes('/login')) return null;
        if (page.url() !== KSIS_AT_URL) throw httpError(409, 'กรุณาเปิดหน้า AT ใน KSIS ก่อนตรวจ ไม่เปลี่ยนหน้าให้อัตโนมัติ');
        const doc = await page.evaluate(readKsisAtDocument), period = ksisContextPeriod(doc.context);
        if (!period || period.month !== Number(month) || period.year !== Number(year) || doc.subjectLabel !== subjects[subject]) throw httpError(409, 'เดือนหรือวิชา KSIS ไม่ตรงกับรายการตรวจ AT');
        if (doc.modalOpen || doc.students.some((student) => student.tests.some((test) => test.dirty))) throw httpError(409, 'มีหน้าต่างย่อยหรือข้อมูล AT แก้ค้าง ไม่อ่านใหม่ทิ้งข้อมูล');
        return doc;
    };
    const initial = await load();
    if (!initial) return { requiresLogin: true };
    let blocked = false;
    const route = (route) => {
        const request = route.request();
        if (isKsisAtAuditReadRequest(request.method(), request.url(), request.resourceType())) return route.fallback();
        blocked = true; return route.abort('blockedbyclient');
    };
    await page.route('**/*', route);
    try {
        const read = async (action) => {
            if (blocked) throw httpError(409, 'มีคำขอบันทึกระหว่างตรวจ AT ถูกกันไว้แล้ว ไม่ยืนยันผลตรวจ');
            const response = page.waitForResponse((item) => item.url() === readUrl && item.request().method() === 'POST', { timeout: 20000 }).catch(() => null);
            await action();
            const result = await response;
            if (!result?.ok() || await result.finished()) throw httpError(409, 'KSIS ยังไม่ยืนยันการอ่าน AT ที่บันทึกใหม่ ไม่ยืนยันผลตรวจ');
            const doc = await load();
            if (!doc || doc.context !== initial.context || blocked) throw httpError(409, 'หน้า KSIS เปลี่ยนหรือมีคำขอบันทึกระหว่างตรวจ AT หยุดตรวจ');
            return doc;
        };
        await page.locator('#btnToolbarFilterSort').click({ timeout: 8000 });
        const modal = page.locator('.modal:visible').filter({ has: page.locator('#filterSubject') });
        if ((await modal.locator('#filterSubject option:checked').textContent())?.trim() !== subjects[subject]) throw httpError(409, 'ตัวกรองวิชา KSIS เปลี่ยน หยุดตรวจ');
        if ((await page.evaluate(readKsisAtDocument)).students.some((student) => student.tests.some((test) => test.dirty))) throw httpError(409, 'พบ AT แก้ค้าง ไม่อ่านใหม่ทิ้งข้อมูล');
        let doc = await read(() => modal.locator('button[ng-click="vm.ok()"],button[data-ng-click="vm.ok()"]').click({ timeout: 8000 }));
        if (doc.page !== 1) throw httpError(409, 'KSIS ไม่กลับหน้าแรกหลังอ่านใหม่ ไม่ยืนยันขอบเขตการตรวจ');
        const move = async () => {
            const target = doc.page + 1;
            const before = await load();
            if (!before || before.page !== doc.page || before.context !== doc.context) throw httpError(409, 'หน้า KSIS เปลี่ยนก่อนอ่านหน้าถัดไป');
            doc = await read(() => page.locator('ul.pagination a').filter({ hasText: /^›$/ }).click({ timeout: 8000 }));
            if (doc.page !== target) throw httpError(409, 'เลขหน้า KSIS ไม่ตรงกับหน้าที่อ่าน หยุดตรวจ AT');
        };
        while (scope === 'current' && doc.page < initial.page) {
            if (!(await page.evaluate(readKsisRosterDocument)).hasNext) throw httpError(409, 'ไม่พบหน้าเดิมหลังอ่านข้อมูล AT ใหม่');
            await move();
        }
        const documents = [], seen = new Set();
        while (true) {
            if (seen.has(doc.page) || seen.size >= 200) throw httpError(409, 'หน้ารายชื่อ AT ซ้ำหรือเกินขอบเขต');
            seen.add(doc.page); documents.push(doc);
            if (scope === 'current' || !(await page.evaluate(readKsisRosterDocument)).hasNext) break;
            await move();
        }
        return { requiresLogin: false, documents, context: initial.context, originalPage: initial.page, page: doc.page,
            pagesRead: documents.length, verifiedAt: new Date().toISOString(), readOnly: true };
    } finally { await page.unroute('**/*', route); }
}

export async function auditKsisAt({ userId, month, year, subject, scope = 'current' }) {
    if (!Object.hasOwn(subjects, subject) || !['current', 'all'].includes(scope)) throw httpError(400, 'กรุณาเลือกวิชาและขอบเขตการตรวจ AT');
    const records = await buildMonthlyReport({ month, year });
    return withKsisPage({ sourceUrl: KSIS_AT_URL, userId, requireCurrentPage: true }, async (page) => {
        const data = await readSavedKsisAtPages(page, { month, year, subject, scope });
        if (data.requiresLogin) return data;
        const { documents, ...metadata } = data;
        return { ...metadata, ...compareKsisAt(records, documents, { month, year, subject, scope }), period: { month: Number(month), year: Number(year) }, subject, scope };
    });
}
