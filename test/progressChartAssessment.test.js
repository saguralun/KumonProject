import assert from 'node:assert/strict';
import { test } from 'node:test';
import pool from '../config/db.js';
import { getProgressChartData } from '../services/progressChartService.js';

test('Progress preserves active enrollments without plotting unsupported levels, keeping behind-pace math unchanged', async t => {
  const rows = [
    { enrollment_id: 1, student_id: 1, first_name: 'Behind', last_name: 'pace', school_grade_class: 'ม.6', current_level_code: '6A', actual_worksheet_no: 1 },
    { enrollment_id: 2, student_id: 2, first_name: 'No', last_name: 'grade', school_grade_class: null, current_level_code: '6A', actual_worksheet_no: 191 },
    { enrollment_id: 3, student_id: 3, first_name: 'No', last_name: 'reference', school_grade_class: 'Unknown', current_level_code: '6A', actual_worksheet_no: 191 },
    { enrollment_id: 4, student_id: 4, first_name: '<Unknown>', last_name: 'level', school_grade_class: 'ป.1', current_level_code: 'Unknown', actual_worksheet_no: 1 }
  ];
  let reads = 0;
  t.mock.method(pool, 'query', async (sql, params) => {
    assert.match(sql, /^\s*WITH active_enrollments/);
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|ALTER|DROP)\b/i);
    assert.equal(params[0], 'ME'); reads++;
    return { rows };
  });
  t.mock.method(pool, 'connect', () => { throw Error('No real database connections allowed'); });
  const data = await getProgressChartData({ subjectCode: 'me' });
  assert.equal(reads, 1);
  assert.equal(data.students.length, 3);
  assert.equal(data.unplottedStudents.length, 1);
  assert.equal(data.students.length + data.unplottedStudents.length, rows.length);
  assert.equal(data.missingLevelCount, 1);
  assert.equal(data.unplottedStudents[0].name, '<Unknown> level');
  assert.equal(data.unplottedStudents[0].enrollmentId, 4);
  assert.equal(data.students[0].gradeSyncStatus, null, 'Valid grade and level behind pace still retain the existing null tier');
  assert.equal(data.students[1].gradeSyncStatus, null);
  assert.equal(data.students[2].gradeSyncStatus, null);
  assert.equal(data.students[1].percent, 100);
  assert.equal(data.students[1].levelPosition, data.levels.indexOf('6A') + .99, '100% stays within the current level');
  assert.equal(data.referenceLines.length, 6);
  const empty = await getProgressChartData({ subjectCode: 'UNKNOWN' });
  assert.deepEqual(empty.students, []); assert.equal(reads, 1);
});
