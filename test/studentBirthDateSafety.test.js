import assert from 'node:assert/strict';
import { test } from 'node:test';
import pool from '../config/db.js';
import { updateStudent } from '../services/studentService.js';

pool.query = () => assert.fail('Real DB forbidden');
pool.connect = () => assert.fail('Real DB forbidden');
const future = `${new Date().getFullYear() + 5}-01-01`;
function mockStudent(t, birthDate = '2019-01-01') {
    const row = { student_id: 1, first_name: 'Only', last_name: 'Fixture', birth_date: birthDate };
    let writes = 0;
    t.mock.method(pool, 'query', async (sql, p) => {
        if (sql.includes('UPDATE kumon.student')) { writes++; row.birth_date = p[5]; return { rows: [{ student_id: 1 }] }; }
        if (sql.includes('FROM kumon.student')) return { rows: [row] };
        if (sql.includes('FROM kumon.enrollment')) return { rows: [] };
        assert.fail('Unexpected test SQL: ' + sql);
    });
    return { writes: () => writes };
}
test('Changed future birth date is rejected before writing Student', async t => {
    const f = mockStudent(t);
    await assert.rejects(updateStudent(1, { prefixId: 1, firstName: 'Only', lastName: 'Fixture', birthDate: future }), error => error.statusCode === 400 && /วันเกิด.*อนาคต/.test(error.message));
    assert.equal(f.writes(), 0);
});
test('Valid birth date corrections retain the existing update contract', async t => {
    const f = mockStudent(t);
    const result = await updateStudent(1, { prefixId: 1, firstName: 'Only', lastName: 'Fixture', birthDate: '2019-02-03' });
    assert.equal(result.student.birthDate, '2019-02-03'); assert.equal(f.writes(), 1);
});
test('Editing other fields does not force correction of an unchanged legacy future date', async t => {
    const f = mockStudent(t, future);
    await updateStudent(1, { prefixId: 1, firstName: 'Other', lastName: 'Fixture', birthDate: future });
    assert.equal(f.writes(), 1);
});
