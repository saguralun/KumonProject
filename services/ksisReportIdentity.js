import { normalizeKumonStudentId } from './kumonStudentId.js';
import { normalizeKsisBirthDate } from './ksisStudentData.js';

const name = (value) => String(value || '').normalize('NFC').trim().replace(/\s+/g, ' ');
const noId = (value) => ['', '0', '-'].includes(String(value ?? '').trim());
const localName = (row) => name(row['ชื่อจริง']) && name(row['นามสกุล']) ? name(`${row['ชื่อจริง']} ${row['นามสกุล']}`) : '';
const identity = (fullName, date) => fullName && date ? JSON.stringify([fullName, date]) : '';
const localIdentity = (row) => identity(localName(row), normalizeKsisBirthDate(row['วันเกิด']));
const siteIdentity = (row) => identity(name(row.fullName), normalizeKsisBirthDate(row.birthDate));

export function matchKsisReportIdentity(record, records, website) {
    const kumonId = normalizeKumonStudentId(record['รหัสคุมอง']);
    const byId = /^\d{13}$/.test(kumonId);
    if (byId) {
        const targets = website.filter((row) => normalizeKumonStudentId(row.kumonId) === kumonId && row.subject === record.Subject);
        const duplicates = records.filter((row) => normalizeKumonStudentId(row['รหัสคุมอง']) === kumonId && row.Subject === record.Subject);
        return { targets, method: 'kumon_id', studentKey: `id:${kumonId}`,
            reason: duplicates.length !== 1 ? 'รหัสและวิชาซ้ำในรายงาน' : targets.length > 1 ? 'รหัสและวิชาซ้ำใน KSIS' : '' };
    }
    if (!noId(kumonId) || !['R', 'IT', 'N', 'EO'].includes(record.Status1)) {
        return { targets: [], method: 'unresolved', studentKey: null, reason: 'ยังไม่มีรหัสคุมองครบ 13 หลัก' };
    }
    const key = localIdentity(record);
    if (!key) return { targets: [], method: 'name_birth_date', studentKey: null, reason: 'ชื่อ นามสกุล หรือวันเกิดไม่ครบ ไม่จับคู่เด็กที่ไม่มีรหัส' };
    const peers = records.filter((row) => localIdentity(row) === key);
    const candidates = website.filter((row) => siteIdentity(row) === key);
    const targets = candidates.filter((row) => row.subject === record.Subject);
    const differentStudents = new Set(peers.map((row) => row.StudentId).filter((id) => id != null));
    const differentHeaders = new Set(candidates.map((row) => row.studentKey).filter(Boolean));
    const reason = peers.filter((row) => row.Subject === record.Subject).length !== 1 || differentStudents.size > 1
        ? 'ชื่อ วันเกิด และรายวิชาซ้ำในรายงาน ไม่เลือกคู่ให้อัตโนมัติ'
        : targets.length > 1 || differentHeaders.size > 1 ? 'พบชื่อและวันเกิดซ้ำใน KSIS ไม่เลือกคู่ให้อัตโนมัติ'
            : candidates.some((row) => !noId(row.kumonId)) ? 'KSIS มีรหัสคุมองแล้ว กรุณาจับคู่รหัสก่อน'
                : !targets.length ? 'ไม่พบชื่อ นามสกุล วันเกิด และรายวิชาที่ตรงในหน้า KSIS ปัจจุบัน' : '';
    return { targets, method: 'name_birth_date', studentKey: record.StudentId != null ? `local:${record.StudentId}` : `identity:${key}`, reason };
}

export const ksisDraftStudentKey = (row) => row.studentKey || row.kumonId;
