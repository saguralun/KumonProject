import { createHash, randomUUID } from 'node:crypto';
import { buildMonthlyReport, periodDateRange } from './reportService.js';
import { withKsisWorkspacePage as withKsisPage } from './ksisStudentService.js';
import { ksisContextPeriod } from './ksisReportDraft.js';
import { matchKsisReportIdentity } from './ksisReportIdentity.js';
import { normalizeKsisBirthDate } from './ksisStudentData.js';
import { normalizeKumonStudentId } from './kumonStudentId.js';
import { httpError } from './httpError.js';

export const KSIS_AT_URL = 'https://kao.ksis.kumon.com/kth/#/atestentrygrid';
const SAVE_URL = 'https://kao.ksis.kumon.com/kth/api/reportb/SaveReportBTestResultEntryEditItemBatch';
const READ_URL = 'https://kao.ksis.kumon.com/kth/api/reportb/GetReportBTestResultEntryListPageByCriteria';
const READ_POST_URLS = [READ_URL, 'https://kao.ksis.kumon.com/kth/api/reportb/GetReportBTestResultErrorCount'];
const previews = new Map();
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const number = (value) => value == null || String(value).trim() === '' ? NaN : Number(String(value).replaceAll(',', ''));
const code = (value) => String(value ?? '').replace(/^string:/, '');
const subjectNames = { ME: 'Math', EFL: 'English EFL', TRP: 'Thai Reading' };
async function boundedResult(promise) {
    let timer;
    try { return await Promise.race([promise, new Promise((resolve) => { timer = setTimeout(() => resolve(false), 20000); })]); }
    finally { clearTimeout(timer); }
}

export function readKsisAtDocument() {
    const visible = (element) => Boolean(element?.getClientRects().length && getComputedStyle(element).visibility !== 'hidden');
    const field = (cell) => {
        const control = [...cell?.querySelectorAll('select,input') || []].find(visible);
        return { value: control?.tagName === 'SELECT' ? control.selectedOptions[0]?.textContent.trim() || '' : control ? control.value.trim() : cell?.innerText.trim() || '',
            code: control?.tagName === 'SELECT' ? control.value.replace(/^string:/, '') : '',
            writable: Boolean(control && !control.disabled && !control.readOnly),
            options: control?.tagName === 'SELECT' ? [...control.options].map((option) => ({ label: option.textContent.trim(), value: option.value })) : [] };
    };
    return { context: (document.querySelector('.container-header')?.textContent || '').replace(/\s+/g, ' ').trim(),
        subjectLabel: document.querySelector('.filter-label-container .filter-label-item')?.textContent.replace(/[\[\]]/g, '').trim() || '',
        page: Number(document.querySelector('ul.pagination li.active')?.textContent.trim() || 1),
        modalOpen: [...document.querySelectorAll('.modal')].some(visible),
        editable: Boolean(document.querySelector('#btnToolbarSave') && !document.querySelector('#btnToolbarSave').disabled),
        students: [...document.querySelectorAll('table.vk-grid-content-student')].map((table, index) => {
            const cells = table.rows[0]?.cells || [];
            const rows = [...table.parentElement.querySelector('table.vk-grid-content-subject')?.rows || []];
            const tests = rows.map((row) => ({ key: row.getAttribute('data-clrowid'),
                subject: ({ Math: 'ME', 'English EFL': 'EFL', 'Thai Reading': 'TRP' })[row.cells[1]?.innerText.trim()] || '',
                dirty: [...row.querySelectorAll('[data-ng-show*="isDirty"]')].some(visible),
                date: field(row.cells[2]), level: field(row.cells[3]), time: field(row.cells[4]), score: field(row.cells[6]), group: field(row.cells[8]),
                passed: Boolean(row.cells[9]?.querySelector('input[type=checkbox]')?.checked),
                notes: field(row.cells[10]).value, error: row.cells[11]?.innerText.trim() || '' }));
            return { key: tests[0]?.key || '', studentKey: table.rows[0]?.getAttribute('data-studentguid') || `header:${index}`,
                kumonId: cells[2]?.textContent.trim() || '', fullName: cells[1]?.textContent.trim() || '', birthDate: cells[4]?.textContent.trim() || '',
                subject: tests[0]?.subject || '', tests };
        }) };
}

function assertDocument(document, period, subject) {
    const actual = ksisContextPeriod(document.context);
    if (!actual || actual.month !== Number(period.month) || actual.year !== Number(period.year)) throw httpError(409, 'เดือน/ปีใน KSIS ไม่ตรงกับ Report ไม่เริ่มกรอก AT');
    if (document.modalOpen || document.students.some((student) => student.tests.some((test) => test.dirty))) throw httpError(409, 'KSIS มีหน้าต่างย่อยหรือข้อมูลที่แก้ค้างอยู่ กรุณาจัดการก่อนเตรียม AT');
    if (document.subjectLabel !== subjectNames[subject] || document.students.some((student) => student.tests.some((test) => test.subject !== subject))) throw httpError(409, `กรุณาเลือกวิชา ${subject} ในตัวกรองหน้า AT ของ KSIS ให้ตรงกันก่อน`);
    if (!document.editable) throw httpError(409, 'KSIS ยังไม่เปิดให้แก้ไขหรือบันทึก AT');
}

export const isBlankKsisAt = (test) => !test.date.value && !test.level.value && !test.time.value && !test.score.value && ['', '0'].includes(test.group.code ?? test.group.value) && !test.passed && !test.notes && !test.error;
export function sameKsisAt(test, desired) {
    return normalizeKsisBirthDate(test.date.value) === desired.date && test.level.value === desired.level
        && number(test.time.value) === desired.time && number(test.score.value) === desired.score
        && number(test.group.code || test.group.value.replace(/^G\s*/, '')) === desired.group && test.passed === desired.passed;
}

export function planKsisAt(records, document, period, subject) {
    if (!Object.hasOwn(subjectNames, subject)) throw httpError(400, 'กรุณาเลือก AT ทีละวิชา ME, EFL หรือ TRP');
    assertDocument(document, period, subject);
    const range = periodDateRange(Number(period.month), Number(period.year));
    const rows = [];
    for (const record of records.filter((row) => row.Subject === subject)) {
        const tests = ['', '1', '2'].filter((suffix) => record[`TestType${suffix}`] === 'AT').map((suffix) => ({
            suffix, date: normalizeKsisBirthDate(record[`DateTest${suffix}`]), level: String(record[`LevelTest${suffix}`] || '').trim(),
            time: number(record[`Time${suffix}`]), score: number(record[`Score${suffix}`]), group: number(record[`Group${suffix}`]), passed: true
        }));
        if (!tests.length) continue;
        const matched = matchKsisReportIdentity(record, records, document.students);
        const student = matched.targets[0];
        for (const test of tests) {
            const { suffix, ...desired } = test;
            const identical = student?.tests.filter((item) => sameKsisAt(item, desired)) || [];
            const sameEvent = student?.tests.filter((item) => normalizeKsisBirthDate(item.date.value) === desired.date && item.level.value === desired.level) || [];
            let reason = matched.reason || (!student ? 'ไม่อยู่ในหน้า AT ปัจจุบัน' : !student.key ? 'ไม่พบตัวระบุแถวนักเรียน' :
                normalizeKsisBirthDate(student.birthDate) !== normalizeKsisBirthDate(record['วันเกิด']) || !normalizeKsisBirthDate(record['วันเกิด']) ? 'วันเกิดไม่ตรงกันหรือไม่ครบ' : '');
            if (!reason && (!desired.date || desired.date < range.start || desired.date >= range.end
                || !desired.level || !Number.isInteger(desired.time) || desired.time < 0 || desired.time > 999
                || !Number.isInteger(desired.score) || desired.score < 0 || desired.score > 999 || !Number.isInteger(desired.group) || desired.group < 1 || desired.group > 5)) reason = 'ข้อมูล AT ไม่ครบหรือไม่ถูกต้อง กรุณาตรวจวันที่ ระดับ เวลา คะแนน และ Group';
            if (!reason && tests.filter((item) => item.date === desired.date && item.level === desired.level).length > 1) reason = 'มี AT วันและระดับเดียวกันซ้ำใน Report';
            if (!reason && (sameEvent.length > 1 || sameEvent.length && identical.length !== 1)) reason = 'KSIS มีผลสอบวันและระดับเดียวกัน แต่ข้อมูลต่างกัน ไม่เขียนทับ';
            if (!reason && identical.some((item) => item.error)) reason = 'ผลสอบเดิมใน KSIS มีข้อความผิดพลาด กรุณาตรวจก่อน';
            if (!reason && !identical.length && !student.tests.some((item) => item.level.options.some((option) => option.label === desired.level))) reason = `KSIS ไม่มีแบบทดสอบ AT ระดับ ${desired.level}`;
            if (!reason && !identical.length && student.tests.some((item) => !isBlankKsisAt(item) && (!item.date.value || !item.level.value))) reason = 'มีแถว AT เดิมที่ข้อมูลไม่ครบ ไม่เพิ่มซ้ำ';
            rows.push({ id: `${record.ID}:${suffix || '0'}`, enrollmentId: record.ID, subject, name: `${record['ชื่อจริง']} ${record['นามสกุล']}`,
                kumonId: normalizeKumonStudentId(record['รหัสคุมอง']), birthDate: record['วันเกิด'], targetBirthDate: student?.birthDate || '', targetName: student?.fullName || '',
                studentKey: student?.studentKey, key: student?.key, matchMethod: matched.method,
                requiresIdentityConfirmation: matched.method === 'name_birth_date', desired,
                outcome: reason ? 'review' : identical.length ? 'existing' : 'ready', reason });
        }
    }
    return rows;
}

async function loaded(page) {
    await page.waitForFunction(() => location.hash.includes('/login') || Boolean(document.querySelector('#btnToolbarATest') && document.querySelector('#btnToolbarFilterSort')?.disabled === false && document.querySelector('.filter-label-container .filter-label-item')?.textContent.trim()), {}, { timeout: 20000 });
    if (page.url().includes('/login')) return null;
    if (page.url() !== KSIS_AT_URL) throw httpError(409, 'กรุณาเปิดหน้า AT ใน KSIS ก่อนเตรียมข้อมูล');
    return page.evaluate(readKsisAtDocument);
}

export async function selectKsisAtSubject(page, subject, period) {
    if (!Object.hasOwn(subjectNames, subject)) throw httpError(400, 'กรุณาเลือก AT ทีละวิชา');
    const document = await loaded(page);
    if (!document) return null;
    const current = ksisContextPeriod(document.context);
    if (!current || current.month !== Number(period.month) || current.year !== Number(period.year)) throw httpError(409, 'เดือน/ปีใน KSIS ไม่ตรงกับ Report');
    if (document.modalOpen || document.students.some((student) => student.tests.some((test) => test.dirty))) throw httpError(409, 'กรุณาจัดการ AT ที่แก้ค้างหรือหน้าต่างย่อยก่อนเปลี่ยนวิชา');
    if (document.subjectLabel === subjectNames[subject]) return document;
    let blocked = false;
    const route = (route) => {
        const request = route.request();
        if (['GET', 'HEAD', 'OPTIONS'].includes(request.method()) || request.method() === 'POST' && ['xhr', 'fetch'].includes(request.resourceType()) && READ_POST_URLS.includes(request.url())) return route.fallback();
        blocked = true; return route.abort('blockedbyclient');
    };
    await page.route('**/*', route);
    try {
        await page.locator('#btnToolbarFilterSort').click({ timeout: 8000 });
        const modal = page.locator('.modal:visible').filter({ has: page.locator('#filterSubject') });
        await modal.locator('#filterSubject').selectOption({ label: subjectNames[subject] }, { timeout: 8000 });
        const response = page.waitForResponse((item) => item.url() === READ_URL && item.request().method() === 'POST', { timeout: 20000 }).catch(() => null);
        await modal.locator('button[ng-click="vm.ok()"],button[data-ng-click="vm.ok()"]').click({ timeout: 8000 });
        const refreshed = await response;
        if (!refreshed?.ok() || !await boundedResult(refreshed.finished().then((failure) => !failure)) || blocked) throw httpError(409, 'KSIS ยังไม่ยืนยันการอ่าน AT ของวิชาที่เลือก ไม่เริ่มกรอก');
        const next = await loaded(page);
        if (!next || next.context !== document.context || blocked) throw httpError(409, 'เดือนหรือศูนย์ KSIS เปลี่ยนระหว่างเลือกวิชา');
        assertDocument(next, period, subject);
        return next;
    } finally { await page.unroute('**/*', route); }
}

export async function previewKsisAt({ userId, month, year, subject }) {
    if (!Object.hasOwn(subjectNames, subject)) throw httpError(400, 'กรุณาเลือก AT ทีละวิชา');
    const records = await buildMonthlyReport({ month, year });
    return withKsisPage({ sourceUrl: KSIS_AT_URL, userId }, async (page) => {
        const period = { month: Number(month), year: Number(year) };
        const document = await selectKsisAtSubject(page, subject, period);
        if (!document) return { requiresLogin: true };
        const rows = planKsisAt(records, document, period, subject);
        for (const [id, item] of previews) if (item.userId === Number(userId) || item.expires < Date.now()) previews.delete(id);
        const previewId = randomUUID();
        previews.set(previewId, { userId: Number(userId), period, subject, rows, documentHash: hash(document), recordsHash: hash(records), expires: Date.now() + 600000 });
        return { requiresLogin: false, previewId, period, subject, page: document.page, context: document.context, rows };
    });
}

export function selectConfirmedKsisAt(rows, confirmations = []) {
    if (!Array.isArray(confirmations) || confirmations.length > rows.length) throw httpError(400, 'รายการยืนยันคู่ AT ไม่ถูกต้อง');
    const ids = new Set();
    for (const id of confirmations) {
        if (ids.has(id) || !rows.some((row) => row.id === id && row.outcome === 'ready' && row.requiresIdentityConfirmation)) throw httpError(400, 'คู่ AT ที่ยืนยันไม่ตรงกับ Preview');
        ids.add(id);
    }
    return rows.filter((row) => row.outcome === 'ready' && (!row.requiresIdentityConfirmation || ids.has(row.id)));
}

export function validateKsisAtPayload(payload, expected) {
    if (!Array.isArray(payload) || payload.length !== 1 || !expected) return false;
    const item = payload[0];
    return `${item.studentGuid}-${item.classId}-${item.testRowId}` === expected.key && item.testTypeCd === 'AT' && item.testGuid === ''
        && normalizeKsisBirthDate(item.testDate) === expected.desired.date && item.testCd === expected.levelCode
        && number(item.testTime) === expected.desired.time && number(item.testScore1) === expected.desired.score
        && code(item.atGroupCd) === expected.groupCode && item.testResultFlg === true && !item.notes;
}

export function validateKsisAtSave(body, expected) {
    if (!Array.isArray(body) || body.length !== 1) return false;
    const item = body[0];
    return `${item.studentGuid}-${item.classId}-${item.testRowId}` === expected.key
        && Number.isInteger(item.saveResult) && item.saveResult >= 0 && typeof item.testGuid === 'string' && item.testGuid.length > 0
        && Number(item.lockVersion) > 0 && !item.error && Number(item.errorCodeType) === 0;
}

export async function installKsisAtGuard(page) {
    let armed = null, writes = 0, blocked = 0, reply = null, handedOff = false, diagnostic = null;
    const route = async (route) => {
        const request = route.request();
        if (['GET', 'HEAD', 'OPTIONS'].includes(request.method()) || request.method() === 'POST' && ['xhr', 'fetch'].includes(request.resourceType()) && READ_POST_URLS.includes(request.url())) return route.fallback();
        if (request.method() === 'POST' && request.url() === SAVE_URL && ['xhr', 'fetch'].includes(request.resourceType())) {
            if (handedOff && await page.evaluate(() => document.documentElement.dataset.kumonAtManualSave === 'yes').catch(() => false)) return route.fallback();
            const expected = armed;
            let payload;
            try { payload = request.postDataJSON(); } catch { payload = null; }
            if (expected && validateKsisAtPayload(payload, expected)) {
                const current = await page.evaluate(readKsisAtDocument);
                if (page.url() !== KSIS_AT_URL || current.context !== expected.context || current.page !== expected.page || current.subjectLabel !== expected.subjectLabel) {
                    blocked++; return route.abort('blockedbyclient');
                }
                armed = null; writes++;
                diagnostic = { key: expected.key, requestSent: true, status: null, rows: [], confirmed: false };
                reply = request.response().then(async (response) => {
                    if (!response) return false;
                    diagnostic.status = response.status();
                    if (await response.finished()) return false;
                    const body = await response.json();
                    diagnostic.rows = Array.isArray(body) ? body.slice(0, 5).map((item) => ({ saveResult: item.saveResult, lockVersion: item.lockVersion,
                        hasTestGuid: typeof item.testGuid === 'string' && Boolean(item.testGuid), error: String(item.error || '').slice(0, 2000), errorCodeType: item.errorCodeType })) : [];
                    diagnostic.confirmed = response.ok() && validateKsisAtSave(body, expected);
                    return diagnostic.confirmed;
                }).catch(() => false);
                return route.fallback();
            }
        }
        blocked++; return route.abort('blockedbyclient');
    };
    await page.route('**/*', route);
    return { blocked: () => blocked, writes: () => writes, diagnostic: () => structuredClone(diagnostic),
        arm: (expected) => { armed = expected; reply = null; },
        async result() { return reply ? await boundedResult(reply) : false; },
        async handoff() {
            armed = null; handedOff = true;
            await page.evaluate(() => {
                const handler = (event) => {
                    if (event.isTrusted && event.target.closest?.('#btnToolbarSave:not(:disabled)')) document.documentElement.dataset.kumonAtManualSave = 'yes';
                };
                window.addEventListener('click', handler, true);
                window.__kumonAtCleanup = () => { window.removeEventListener('click', handler, true); delete document.documentElement.dataset.kumonAtManualSave; };
            }).catch(() => {});
        },
        async release() { await page.unroute('**/*', route); await page.evaluate(() => window.__kumonAtCleanup?.()).catch(() => {}); }
    };
}

export async function fillAndSaveKsisAt(page, rows, guard, initial) {
    const saved = [];
    let active;
    const snapshot = async () => {
        if (page.url() !== KSIS_AT_URL) throw httpError(409, 'หน้า KSIS เปลี่ยน หยุดการกรอก AT');
        const document = await page.evaluate(readKsisAtDocument);
        if (document.context !== initial.context || document.page !== initial.page || document.subjectLabel !== initial.subjectLabel || document.modalOpen) throw httpError(409, 'เดือน วิชา หรือหน้า AT เปลี่ยนระหว่างกรอก');
        if (guard.blocked()) throw httpError(409, 'มีคำขอบันทึกระหว่างกรอก AT ถูกกันไว้ กรุณาตรวจข้อมูลค้าง');
        return document;
    };
    try {
        for (const row of rows) {
            active = row;
            let document = await snapshot();
            const student = document.students.find((item) => item.studentKey === row.studentKey);
            if (!student || student.key !== row.key || student.fullName !== row.targetName || student.birthDate !== row.targetBirthDate) throw httpError(409, 'ข้อมูลนักเรียนเปลี่ยนหลัง Preview');
            if (document.students.some((item) => item.tests.some((test) => test.dirty))) throw httpError(409, 'มี AT ที่ยังไม่บันทึก ไม่กรอกรายการถัดไป');
            let blank = student.tests.find(isBlankKsisAt);
            if (!blank) {
                await page.locator(`tr[data-clrowid=${JSON.stringify(student.key)}]`).locator('td').nth(1).click({ timeout: 8000 });
                await page.locator('#btnToolbarATest').click({ timeout: 8000 });
                await page.waitForFunction(({ studentKey, count }) => [...window.document.querySelectorAll('table.vk-grid-content-student')].some((table) => table.rows[0]?.getAttribute('data-studentguid') === studentKey && table.parentElement.querySelector('table.vk-grid-content-subject')?.rows.length > count), { studentKey: student.studentKey, count: student.tests.length }, { timeout: 8000 });
                document = await snapshot();
                blank = document.students.find((item) => item.studentKey === row.studentKey)?.tests.find(isBlankKsisAt);
            }
            if (!blank?.key) throw httpError(409, 'ไม่พบแถว AT ว่าง ไม่เขียนทับผลสอบเดิม');
            const target = page.locator(`tr[data-clrowid=${JSON.stringify(blank.key)}]`);
            await target.locator('td').nth(1).click({ timeout: 8000 });
            const level = blank.level.options.filter((option) => option.label === row.desired.level);
            const group = blank.group.options.filter((option) => code(option.value) === String(row.desired.group) || [String(row.desired.group), `G${row.desired.group}`].includes(option.label));
            if (level.length !== 1 || group.length !== 1) throw httpError(409, 'ระดับหรือ Group ใน KSIS ไม่ตรงหรือมีหลายตัวเลือก');
            await target.locator('td').nth(3).locator('select:visible').selectOption({ value: level[0].value }, { timeout: 8000 });
            const date = target.locator('td').nth(2).locator('input:visible');
            await date.fill(row.desired.date.split('-').reverse().join('/'), { timeout: 8000 }); await date.press('Tab');
            for (const [column, value] of [[4, row.desired.time], [6, row.desired.score]]) {
                const input = target.locator('td').nth(column).locator('input:visible');
                await input.click({ timeout: 8000 }); await input.fill(String(value), { timeout: 8000 }); await input.press('Tab');
            }
            await target.locator('td').nth(8).locator('select:visible').selectOption({ value: group[0].value }, { timeout: 8000 });
            await target.locator('td').nth(9).locator('input[type=checkbox]').check({ timeout: 8000 });
            document = await snapshot();
            const actual = document.students.flatMap((item) => item.tests).find((test) => test.key === blank.key);
            if (!actual || !sameKsisAt(actual, row.desired) || actual.error || !actual.dirty
                || document.students.flatMap((item) => item.tests).filter((test) => test.dirty).length !== 1) throw httpError(409, 'อ่านค่า AT กลับแล้วไม่ตรงกับ Report หรือมีแถวอื่นแก้ค้างอยู่ ไม่กดบันทึก');
            // AT's timer skips the selected row. Save that one verified row before moving to another.
            guard.arm({ key: blank.key, desired: row.desired, levelCode: code(level[0].value), groupCode: code(group[0].value), context: initial.context, page: initial.page, subjectLabel: initial.subjectLabel });
            const response = page.waitForResponse((item) => item.url() === SAVE_URL && item.request().method() === 'POST', { timeout: 20000 }).catch(() => null);
            await page.locator('#btnToolbarSave').click({ timeout: 8000 });
            if (!await response || !await guard.result()) throw httpError(409, 'KSIS ยังไม่ยืนยันการบันทึก AT หรือผลสอบถูกปฏิเสธ กรุณาตรวจ ไม่ส่งซ้ำอัตโนมัติ');
            await page.waitForFunction((key) => {
                const row = [...document.querySelectorAll('tr[data-clrowid]')].find((item) => item.getAttribute('data-clrowid') === key);
                return row && ![...row.querySelectorAll('[data-ng-show*="isDirty"]')].some((element) => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden');
            }, blank.key, { timeout: 10000 });
            const after = (await snapshot()).students.flatMap((item) => item.tests).find((test) => test.key === blank.key);
            if (!after || !sameKsisAt(after, row.desired) || after.error) throw httpError(409, 'ค่า AT หลังบันทึกไม่ตรงกับ Report กรุณาตรวจผล ไม่กรอกซ้ำ');
            saved.push(row.id);
        }
        return { saved, pendingDraft: false, message: `บันทึก AT ${saved.length} ผลสอบแล้ว • เฉพาะหน้าปัจจุบัน` };
    } catch (error) {
        return { saved, pendingDraft: true, failedId: active?.id, message: error.statusCode ? error.message : `${active?.name || ''}: กรอก AT ไม่ครบ หยุดให้ตรวจข้อมูลค้างก่อนลองใหม่` };
    }
}

export async function applyKsisAt({ userId, previewId, confirmedIdentityMatches, confirmSave }) {
    if (confirmSave !== true) throw httpError(400, 'กรุณายืนยันกรอกและบันทึก AT ก่อนเริ่ม');
    const preview = previews.get(previewId);
    if (!preview || preview.userId !== Number(userId) || preview.expires < Date.now()) throw httpError(409, 'Preview AT หมดอายุ กรุณาเตรียมใหม่');
    const records = await buildMonthlyReport(preview.period);
    if (hash(records) !== preview.recordsHash) throw httpError(409, 'Report เปลี่ยนหลัง Preview กรุณาเตรียม AT ใหม่');
    const rows = selectConfirmedKsisAt(preview.rows, confirmedIdentityMatches);
    if (!rows.length) throw httpError(400, 'ไม่มี AT พร้อมกรอกหรือยังไม่ได้ยืนยันคู่');
    return withKsisPage({ sourceUrl: KSIS_AT_URL, userId, requireCurrentPage: true }, async (page, session) => {
        const document = await loaded(page);
        if (!document || hash(document) !== preview.documentHash) throw httpError(409, 'หน้า AT เปลี่ยนหลัง Preview กรุณาเตรียมใหม่');
        previews.delete(previewId);
        const guard = await installKsisAtGuard(page);
        session.pendingDraft = true; session.draftGuard = guard; session.pendingAt = true;
        session.atAttempt = { period: preview.period, subject: preview.subject, rows, failedId: null };
        const result = await fillAndSaveKsisAt(page, rows, guard, document);
        session.atAttempt.failedId = result.failedId;
        if (result.pendingDraft) await guard.handoff();
        else { await guard.release(); session.pendingDraft = false; session.draftGuard = null; session.pendingAt = false; }
        return { ...result, rows: preview.rows.map((row) => ({ ...row, outcome: result.saved.includes(row.id) ? 'saved' : row.id === result.failedId ? 'review' : row.outcome })), page: document.page };
    });
}

export async function readKsisAtInspection(page, records, { period, subject, kumonId }) {
    if (!Object.hasOwn(subjectNames, subject) || !/^\d{13}$/.test(kumonId || '')) throw httpError(400, 'กรุณาระบุวิชาและรหัสคุมอง 13 หลักที่ต้องการตรวจ');
    const record = records.filter((item) => item.Subject === subject && normalizeKumonStudentId(item['รหัสคุมอง']) === kumonId);
    if (record.length !== 1) throw httpError(409, 'ไม่พบรายวิชาเดียวที่ตรงกับรหัสนี้ใน Report ไม่เลือกแทนให้');
    let current = await loaded(page);
    if (!current) return { requiresLogin: true };
    const websitePeriod = ksisContextPeriod(current.context);
    if (!websitePeriod || websitePeriod.month !== Number(period.month) || websitePeriod.year !== Number(period.year) || current.subjectLabel !== subjectNames[subject]) throw httpError(409, 'เดือนหรือวิชา KSIS ไม่ตรงกับรายการที่จะตรวจ ไม่เปลี่ยนหน้าให้อัตโนมัติ');
    if (current.modalOpen) throw httpError(409, 'มีหน้าต่างย่อยเปิดอยู่ กรุณาปิดเองก่อนตรวจ โดยยังไม่ต้องบันทึก');
    let refreshed = false, blocked = false;
    // A pending save must remain guarded. Inspection never authorizes a save, even a timer's POST.
    const route = (route) => {
        const request = route.request();
        if (['GET', 'HEAD', 'OPTIONS'].includes(request.method()) || request.method() === 'POST' && ['xhr', 'fetch'].includes(request.resourceType()) && READ_POST_URLS.includes(request.url())) return route.fallback();
        blocked = true; return route.abort('blockedbyclient');
    };
    await page.route('**/*', route);
    try {
        if (current.page === 1 && !current.students.some((student) => student.tests.some((test) => test.dirty))) {
            // Reapply the unchanged native filter to read saved rows. Never discard dirty inputs or change pages.
            await page.locator('#btnToolbarFilterSort').click({ timeout: 8000 });
            const modal = page.locator('.modal:visible').filter({ has: page.locator('#filterSubject') });
            const selected = await modal.locator('#filterSubject option:checked').textContent();
            if (selected?.trim() !== subjectNames[subject]) throw httpError(409, 'ตัวกรอง KSIS ไม่ตรงกับวิชา หยุดตรวจโดยไม่แก้ตัวกรอง');
            const beforeRead = await page.evaluate(readKsisAtDocument);
            if (blocked || beforeRead.students.some((student) => student.tests.some((test) => test.dirty))) throw httpError(409, 'พบข้อมูลแก้ค้างขณะเปิดตัวกรอง หยุดตรวจโดยไม่รีเฟรชทิ้งค่า');
            const response = page.waitForResponse((item) => item.url() === READ_URL && item.request().method() === 'POST', { timeout: 20000 }).catch(() => null);
            await modal.locator('button[ng-click="vm.ok()"],button[data-ng-click="vm.ok()"]').click({ timeout: 8000 });
            const read = await response;
            if (!read?.ok() || !await boundedResult(read.finished().then((failure) => !failure)) || blocked) throw httpError(409, 'ยังอ่านข้อมูลที่บันทึกใหม่จาก KSIS ไม่สำเร็จ ไม่ยืนยันผลบันทึก');
            const next = await loaded(page);
            if (!next || next.page !== current.page || next.context !== current.context || next.subjectLabel !== current.subjectLabel) throw httpError(409, 'หน้า เดือน หรือวิชาเปลี่ยนระหว่างตรวจ หยุดโดยไม่กรอก');
            current = next; refreshed = true;
        }
        if (blocked) throw httpError(409, 'มีคำขอบันทึกระหว่างตรวจ ถูกกันไว้แล้ว ยังไม่ยืนยันผล');
        const matches = matchKsisReportIdentity(record[0], records, current.students);
        if (matches.reason || matches.targets.length !== 1) throw httpError(409, matches.reason || 'ไม่พบแถวของเด็กคนนี้ในหน้าปัจจุบัน');
        const student = matches.targets[0];
        if (normalizeKsisBirthDate(student.birthDate) !== normalizeKsisBirthDate(record[0]['วันเกิด'])) throw httpError(409, 'วันเกิดใน KSIS ไม่ตรงกับ Report');
        const expected = ['', '1', '2'].filter((suffix) => record[0][`TestType${suffix}`] === 'AT').map((suffix) => ({ date: normalizeKsisBirthDate(record[0][`DateTest${suffix}`]),
            level: String(record[0][`LevelTest${suffix}`] || '').trim(), time: number(record[0][`Time${suffix}`]), score: number(record[0][`Score${suffix}`]), group: number(record[0][`Group${suffix}`]), passed: true }));
        const comparisons = expected.map((desired) => {
            const exact = student.tests.filter((test) => sameKsisAt(test, desired));
            const sameEvent = student.tests.filter((test) => normalizeKsisBirthDate(test.date.value) === desired.date && test.level.value === desired.level);
            const actual = exact[0] || sameEvent[0] || null;
            return { desired, actual, matches: exact.length === 1 && sameEvent.length === 1, persisted: refreshed && exact.length === 1 && !exact[0].dirty };
        });
        return { requiresLogin: false, name: student.fullName, kumonId, subject, period, context: current.context, page: current.page,
            refreshed, dirty: student.tests.some((test) => test.dirty), comparisons, tests: student.tests, checkedAt: new Date().toISOString(), readOnly: true };
    } finally { await page.unroute('**/*', route); }
}

export async function inspectKsisAt({ userId, month, year, subject, kumonId }) {
    if (!Object.hasOwn(subjectNames, subject) || !/^\d{13}$/.test(kumonId || '')) throw httpError(400, 'กรุณาระบุวิชาและรหัสคุมอง 13 หลักที่ต้องการตรวจ');
    const records = await buildMonthlyReport({ month, year });
    return withKsisPage({ sourceUrl: KSIS_AT_URL, userId, allowPendingDraft: true, requireCurrentPage: true }, async (page, session) => {
        const result = await readKsisAtInspection(page, records, { period: { month: Number(month), year: Number(year) }, subject, kumonId });
        const failed = session.atAttempt?.rows.find((row) => row.id === session.atAttempt.failedId);
        return { ...result, pendingDraft: session.pendingDraft === true,
            lastSave: failed?.kumonId === kumonId ? session.draftGuard?.diagnostic?.() || null : null };
    });
}

export async function acknowledgeKsisAt({ userId }) {
    return withKsisPage({ sourceUrl: KSIS_AT_URL, userId, allowPendingDraft: true, requireCurrentPage: true }, async (page, session) => {
        if (session.pendingDraft && !session.pendingAt) throw httpError(409, 'กรุณาจัดการข้อมูลค้างในงาน WS ก่อน');
        const document = await loaded(page);
        if (!document || document.modalOpen || document.students.some((student) => student.tests.some((test) => test.dirty))) throw httpError(409, 'ยังมีข้อมูล AT แก้ค้างอยู่ กรุณาบันทึกเองหรือยกเลิกบนเว็บก่อน');
        await session.draftGuard?.release(); session.pendingDraft = false; session.draftGuard = null; session.pendingAt = false;
        return { acknowledged: true };
    });
}
