import assert from 'node:assert/strict';
import { test } from 'node:test';
import { enrollmentMonthStart, specialStatusForStartDate, canCorrectEnrollmentDateStatus } from '../public/js/enrollmentDateStatus.js';

test('Date and special-status corrections stay open for saved N/EO or an unused enrollment', () => {
    for (const code of ['N', 'EO']) assert.equal(canCorrectEnrollmentDateStatus(code), true);
    for (const code of ['C', 'A', 'OT', 'R', 'IT', 'CP', undefined]) {
        assert.equal(canCorrectEnrollmentDateStatus(code), false);
        assert.equal(canCorrectEnrollmentDateStatus(code, true), true);
    }
});

test('New enrollment dates default to day one of the calendar month, including after the 20th and year boundaries', () => {
    assert.equal(enrollmentMonthStart(new Date(2026, 10, 19)), '2026-11-01');
    assert.equal(enrollmentMonthStart(new Date(2026, 10, 30)), '2026-11-01');
    assert.equal(enrollmentMonthStart(new Date(2026, 11, 31)), '2026-12-01');
    assert.equal(enrollmentMonthStart(new Date(2027, 0, 1)), '2027-01-01');
});

test('Start Date uses H on days 11–20 and clears H outside that window', () => {
    for (const day of ['11', '15', '20']) assert.equal(specialStatusForStartDate('', `2026-11-${day}`), 'H');
    for (const day of ['01', '10', '21', '30']) assert.equal(specialStatusForStartDate('H', `2026-11-${day}`), '');
    assert.equal(specialStatusForStartDate('H', ''), 'H');
});
test('Date changes keep explicit exemptions and map free-study half months both ways', () => {
    assert.equal(specialStatusForStartDate('FS', '2026-11-15'), 'FSH');
    assert.equal(specialStatusForStartDate('FSH', '2026-11-21'), 'FS');
    for (const code of ['F', 'P', 'FRG']) for (const day of ['01', '15', '21']) {
        assert.equal(specialStatusForStartDate(code, `2026-11-${day}`), code);
    }
});
