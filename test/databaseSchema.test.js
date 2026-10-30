import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import { loadSchemaContract, planSchemaUpgrade } from '../services/databaseSchema.js';
import { prepareApplicationDatabase } from '../services/databaseUpgradeService.js';

test('The generated schema contract checks the whole app and makes a no-op plan for an identical schema', async () => {
    const contract = await loadSchemaContract();
    assert.ok(contract.tables.length >= 30); assert.equal(contract.functions.length, 2);
    assert.equal(planSchemaUpgrade(contract, structuredClone(contract)).ready, true);
    const source = await fs.readFile('services/databaseSchema.js', 'utf8');
    assert.doesNotMatch(source, /001_create_master_tables|002_insert_master_data|003_create_transaction_tables/);
});

test('Missing nullable fields, tables, indexes, helpers and safe future defaults produce additive ordered operations only', async () => {
    const expected = await loadSchemaContract(), actual = structuredClone(expected);
    const student = actual.tables.find(table => table.name === 'student');
    student.columns = student.columns.filter(column => column.name !== 'remark');
    actual.tables = actual.tables.filter(table => !['stock_do', 'stock_receive', 'worksheet_forecast_average'].includes(table.name));
    actual.tables.find(table => table.name === 'session').indexes = [];
    actual.tables.find(table => table.name === 'stock').columns.find(column => column.name === 'quantity').default = null;
    actual.functions = [];
    const plan = planSchemaUpgrade(expected, actual);
    assert.deepEqual(plan.blockers, []);
    for (const kind of ['table', 'column', 'default', 'constraint', 'index', 'function']) assert.ok(plan.operations.some(item => item.kind === kind), kind);
    assert.ok(plan.operations.every(item => /^(CREATE|ALTER)/.test(item.sql) && !/\b(DROP|DELETE|INSERT|UPDATE|TRUNCATE)\b/i.test(item.sql)));
    const firstForeignKey = plan.operations.findIndex(item => item.sql.includes('FOREIGN KEY'));
    assert.ok(plan.operations.every((item, index) => !item.sql.includes('PRIMARY KEY') || index < firstForeignKey));
    actual.tables.push({ name: 'branch_custom_table', columns: [], constraints: [], indexes: [] });
    assert.deepEqual(planSchemaUpgrade(expected, actual), plan);
});

test('Incompatible types, missing required historical data, core tables and conflicting constraints stop automatic repair', async () => {
    const expected = await loadSchemaContract();
    for (const issue of ['column', 'type', 'table', 'constraint', 'null']) {
        const actual = structuredClone(expected), student = actual.tables.find(table => table.name === 'student');
        if (issue === 'column') student.columns = student.columns.filter(column => column.name !== 'first_name');
        if (issue === 'type') student.columns.find(column => column.name === 'first_name').type = 'integer';
        if (issue === 'table') actual.tables = actual.tables.filter(table => table.name !== 'student');
        if (issue === 'constraint') student.constraints.find(item => item.type === 'p').definition = 'PRIMARY KEY (first_name)';
        if (issue === 'null') student.columns.find(column => column.name === 'first_name').nullable = true;
        const plan = planSchemaUpgrade(expected, actual, new Set(['student']), new Set(['student.first_name']));
        assert.equal(plan.ready, false); assert.ok(plan.blockers.length, issue);
    }
});

test('Forecast scope checks recognize only the same two case-sensitive values through IN, ANY and PostgreSQL cast variations', async () => {
    const expected = await loadSchemaContract();
    const check = actual => actual.tables.find(table => table.name === 'worksheet_forecast_average').constraints.find(item => item.name === 'ck_worksheet_forecast_average_scope');
    for (const definition of [
        "CHECK (source_scope IN ('2Y', 'ALL'))",
        "CHECK (source_scope::text = ANY (ARRAY['2Y'::text, 'ALL'::text]))",
        "CHECK (source_scope::text = ANY (ARRAY['2Y'::character varying::text, 'ALL'::character varying::text]))",
        "CHECK (((source_scope)::text = ANY ((ARRAY['ALL'::character varying, '2Y'::character varying])::text[])))",
        "check (\"source_scope\" in ('ALL'::text, '2Y'::text))",
        "CHECK (source_scope::text = ANY ('{2Y,ALL}'::text[]))"
    ]) {
        const actual = structuredClone(expected); check(actual).definition = definition;
        const plan = planSchemaUpgrade(expected, actual);
        // Array-literal strings are deliberately outside this narrow recognizer.
        if (definition.includes('{2Y')) assert.equal(plan.blockers.length, 1);
        else { assert.equal(plan.ready, true, definition); assert.deepEqual(plan.operations, []); }
    }
    for (const definition of [
        "CHECK (source_scope IN ('3Y', 'ALL'))",
        "CHECK (source_scope IN ('2Y', 'all'))",
        "CHECK (source_scope IN ('2Y', 'ALL', 'OTHER'))",
        "CHECK (source_scope IN ('2Y', '2Y'))",
        "CHECK (lower(source_scope) IN ('2Y', 'ALL'))",
        "CHECK (source_scope::character(2) IN ('2Y', 'ALL'))",
        "CHECK (source_scope IN ('2Y', 'ALL') OR true)",
        "CHECK (other_column IN ('2Y', 'ALL'))",
        "CHECK (source_scope IN ('2 Y', 'ALL'))",
        "CHECK (source_scope IN ('2Y', 'ALL')) NOT VALID"
    ]) {
        const actual = structuredClone(expected); check(actual).definition = definition;
        const plan = planSchemaUpgrade(expected, actual);
        assert.equal(plan.blockers.length, 1, definition);
        assert.ok(plan.blockers[0].includes(`พบ: ${definition}`));
        assert.deepEqual(plan.operations, []);
    }
    const unvalidated = structuredClone(expected); check(unvalidated).validated = false;
    assert.equal(planSchemaUpgrade(expected, unvalidated).blockers.length, 1);
    const renamed = structuredClone(expected), branchCheck = check(renamed); branchCheck.name = 'branch_same_scope';
    branchCheck.definition = "CHECK (source_scope IN ('2Y', 'ALL'))";
    assert.equal(planSchemaUpgrade(expected, renamed).ready, true);
});

function fixture({ failBackup = false, failDdl = false, blockers = [], ready = false, failVerification = false } = {}) {
    const events = []; let changed = ready, inspections = 0;
    const client = {
        async query(sql) {
            events.push(sql);
            if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
            if (sql.startsWith('ALTER')) { if (failDdl) throw new Error('fixture DDL failed'); changed = true; }
            return { rows: [] };
        },
        release() { events.push('release'); }
    };
    const options = { database: { connect: async () => client },
        inspect: async () => { inspections++; const complete = changed && !(failVerification && inspections > 2); return { ready: complete, blockers, operations: complete ? [] : [{ kind: 'column', name: 'student.remark', sql: 'ALTER TABLE "kumon"."student" ADD COLUMN "remark" text' }] }; },
        backup: async () => { events.push('backup'); if (failBackup) throw new Error('fixture backup failed'); return { filename: 'fixture.backup', sizeBytes: 10 }; },
        report: async result => { events.push(result.ready ? 'report-ready' : 'report-error'); }
    };
    return { events, options };
}

test('Whole-app preparation backs up before DDL, verifies inside one transaction and skips an already ready database', async () => {
    const f = fixture(); const result = await prepareApplicationDatabase(f.options);
    assert.equal(result.ready, true); assert.equal(result.backup, 'fixture.backup');
    assert.ok(f.events.indexOf('backup') < f.events.indexOf('BEGIN'));
    assert.ok(f.events.indexOf('COMMIT') < f.events.indexOf('report-ready'));
    assert.equal(f.events.at(-1), 'release');
    const already = fixture({ ready: true }); assert.equal((await prepareApplicationDatabase(already.options)).applied, false);
    assert.ok(!already.events.includes('backup')); assert.ok(!already.events.includes('BEGIN'));
});

test('Failed backup, blockers, DDL or post-check never proceed as a successful upgrade and always release the lock', async () => {
    for (const settings of [{ failBackup: true }, { blockers: ['fixture unsafe migration'] }, { failDdl: true }, { failVerification: true }]) {
        const f = fixture(settings);
        await assert.rejects(prepareApplicationDatabase(f.options));
        assert.equal(f.events.includes('COMMIT'), false);
        assert.equal(f.events.includes('ROLLBACK'), Boolean(settings.failDdl || settings.failVerification));
        if (settings.blockers || settings.failBackup) assert.equal(f.events.includes('BEGIN'), false);
        assert.equal(f.events.at(-2), 'SELECT pg_advisory_unlock(76401, 2)'); assert.equal(f.events.at(-1), 'release');
    }
});

test('Database update runs new code before restart and older installed updaters have a pre-stop bridge', async () => {
    const update = await fs.readFile('services/updateService.js', 'utf8'), helper = await fs.readFile('launcher/restart-server.ps1', 'utf8');
    assert.ok(update.indexOf("['scripts/prepare-database.js', '--update']") < update.lastIndexOf('await scheduleAppRestart()'));
    assert.ok(helper.indexOf('scripts\\prepare-database.js') < helper.indexOf('Stop-Process -Id $ServerPid'));
    assert.match(helper, /Database preparation failed/); assert.match(helper, /WindowStyle Hidden/);
});

test('A no-op recheck retains the last applied repair and its backup in the audit report', async t => {
    const lastApplied = { backup: 'previous.backup', changes: [{ kind: 'column', name: 'student.remark' }] };
    let saved;
    t.mock.method(fs, 'mkdir', async () => {});
    t.mock.method(fs, 'readFile', async () => JSON.stringify({ ready: true, lastApplied }));
    t.mock.method(fs, 'writeFile', async (_file, contents) => { saved = JSON.parse(contents); });
    t.mock.method(fs, 'rename', async () => {});
    t.mock.method(fs, 'rm', async () => {});
    const f = fixture({ ready: true }); delete f.options.report;
    assert.equal((await prepareApplicationDatabase(f.options)).applied, false);
    assert.deepEqual(saved.lastApplied, lastApplied); assert.equal(saved.ready, true);
});
