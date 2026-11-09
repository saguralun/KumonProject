import assert from 'node:assert/strict';
import { test } from 'node:test';
import { absenceDuration, directoryStatus, directoryTone } from '../public/js/studentDirectoryStatus.js';

const now = new Date(2026, 10, 9);
test('Absence labels show years/months by period, including year boundaries and incomplete history', () => {
    assert.equal(absenceDuration({ absenceSinceMonth: 8, absenceSinceYear: 2025 }, now), '1 ปี 3 เดือน');
    assert.equal(absenceDuration({ absenceSinceMonth: 11, absenceSinceYear: 2024 }, now), '2 ปี');
    assert.equal(absenceDuration({ absenceSinceMonth: 11, absenceSinceYear: 2026 }, now), 'ไม่ถึง 1 เดือน');
    assert.equal(absenceDuration({ absenceSinceMonth: 12, absenceSinceYear: 2026 }, now), 'เริ่มงวด 12/2026');
    for (const values of [{}, { absenceSinceMonth: null, absenceSinceYear: null }, { absenceSinceMonth: 13, absenceSinceYear: 2025 }]) {
        assert.equal(absenceDuration(values, now), 'ไม่ทราบงวดที่ออก');
    }
});
test('Mixed enrollment statuses stay separate; only A/OT gets an absence duration', () => {
    for (const code of ['C', 'N', 'R', 'EO', 'IT']) {
        assert.deepEqual(directoryStatus({ subjectCode: 'ME', statusCode: code }, now), { tone: 'active', label: `ME · ${code}`, title: code });
    }
    assert.equal(directoryStatus({ subjectCode: 'TRP', statusCode: 'CP' }, now).tone, 'complete');
    for (const code of ['A', 'OT']) {
        const status = directoryStatus({ subjectCode: 'EFL', statusCode: code, absenceSinceMonth: 10, absenceSinceYear: 2026 }, now);
        assert.equal(status.label, `EFL · ${code} · 1 เดือน`);
        assert.match(status.title, /10\/2026/);
    }
    assert.equal(directoryStatus({ subjectCode: 'ME' }, now).label, 'ME · —');
    assert.equal(directoryTone([{ statusCode: 'A' }, { statusCode: 'C' }]), 'mixed');
    assert.equal(directoryTone([{ statusCode: 'A' }, { statusCode: 'OT' }]), 'inactive');
    assert.equal(directoryTone([{ statusCode: 'CP' }]), 'complete');
    assert.equal(directoryTone(), 'unknown');
});
