import fs from 'node:fs/promises';

export const quoteIdentifier = value => `"${String(value).replaceAll('"', '""')}"`;
export const tableName = name => `"kumon".${quoteIdentifier(name)}`;

// PostgreSQL's catalog supplies definitions; never parse or execute the legacy reset scripts in production.
export async function readSchemaSnapshot(client) {
    const tables = (await client.query(`SELECT c.relname AS name FROM pg_class c
        JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='kumon' AND c.relkind='r' ORDER BY c.relname`)).rows;
    const columns = (await client.query(`SELECT c.relname AS "table", a.attname AS name,
        format_type(a.atttypid,a.atttypmod) AS type, NOT a.attnotnull AS nullable,
        a.attidentity AS identity, a.attgenerated AS generated, pg_get_expr(d.adbin,d.adrelid) AS "default"
        FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
        WHERE n.nspname='kumon' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped
        ORDER BY c.relname,a.attnum`)).rows;
    const constraints = (await client.query(`SELECT c.relname AS "table", con.conname AS name,
        con.contype AS type, pg_get_constraintdef(con.oid,true) AS definition, con.convalidated AS validated,
        array(SELECT a.attname FROM unnest(con.conkey) WITH ORDINALITY k(num,pos)
              JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.num ORDER BY k.pos) AS columns
        FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='kumon' AND c.relkind='r' ORDER BY c.relname,con.conname`)).rows;
    const indexes = (await client.query(`SELECT t.relname AS "table", i.relname AS name,
        pg_get_indexdef(i.oid) AS definition, ix.indisvalid AS valid
        FROM pg_index ix JOIN pg_class i ON i.oid=ix.indexrelid JOIN pg_class t ON t.oid=ix.indrelid
        JOIN pg_namespace n ON n.oid=t.relnamespace LEFT JOIN pg_constraint con ON con.conindid=i.oid
        WHERE n.nspname='kumon' AND t.relkind='r' AND con.oid IS NULL ORDER BY t.relname,i.relname`)).rows;
    const functions = (await client.query(`SELECT p.proname AS name, pg_get_function_identity_arguments(p.oid) AS arguments,
        pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='kumon' AND p.prokind='f' ORDER BY p.proname,arguments`)).rows;
    return { tables: tables.map(table => ({ ...table,
        columns: columns.filter(column => column.table === table.name).map(({ table: _, ...column }) => column),
        constraints: constraints.filter(item => item.table === table.name).map(({ table: _, ...item }) => item),
        indexes: indexes.filter(item => item.table === table.name).map(({ table: _, ...item }) => item)
    })), functions };
}

export async function loadSchemaContract() {
    return JSON.parse(await fs.readFile(new URL('../database/schema-contract.json', import.meta.url), 'utf8'));
}

function columnSql(column) {
    if (column.generated) throw new Error(`Unsupported generated column: ${column.name}`);
    return `${quoteIdentifier(column.name)} ${column.type}`
        + (column.identity ? ` GENERATED ${column.identity === 'a' ? 'ALWAYS' : 'BY DEFAULT'} AS IDENTITY` : column.default !== null ? ` DEFAULT ${column.default}` : '')
        + (column.nullable ? '' : ' NOT NULL');
}

const normalized = sql => sql.replaceAll('kumon.', '').replaceAll('"', '').replace(/\s+/g, ' ').trim();
const coreTables = new Set(['center_master', 'subject_master', 'level_master', 'worksheet_master', 'status_master',
    'prefix_master', 'gender_master', 'school_grade_master', 'student', 'enrollment', 'billing']);

export function planSchemaUpgrade(expected, actual, populatedTables = new Set(), nullColumns = new Set()) {
    const operations = [], blockers = [], actualTables = new Map(actual.tables.map(table => [table.name, table]));
    const definitions = [], constraints = [], foreignKeys = [], indexes = [], functions = [];
    const add = (target, kind, name, sql) => { const action = { kind, name, sql }; target.push(action); };
    for (const table of expected.tables) {
        const found = actualTables.get(table.name);
        if (!found) {
            if (coreTables.has(table.name)) blockers.push(`ไม่พบตารางข้อมูลหลัก kumon.${table.name} ต้องตรวจฐานข้อมูลหรือคืนข้อมูลเดิม ไม่สร้างฐานข้อมูลว่างทับ`);
            else add(definitions, 'table', table.name, `CREATE TABLE ${tableName(table.name)} (${table.columns.map(columnSql).join(', ')})`);
        }
        const foundColumns = new Map(found?.columns.map(column => [column.name, column]) || []);
        for (const column of table.columns) {
            if (!found) continue;
            const current = foundColumns.get(column.name), name = `${table.name}.${column.name}`;
            if (!current) {
                if (!column.nullable && populatedTables.has(table.name)) blockers.push(`ขาด ${name} ซึ่งห้ามว่าง แต่ตารางมีข้อมูลแล้ว ต้องระบุวิธีย้ายข้อมูลก่อน ไม่เดาค่าเดิม`);
                else add(definitions, 'column', name, `ALTER TABLE ${tableName(table.name)} ADD COLUMN ${columnSql(column)}`);
            } else {
                if (current.type !== column.type || current.identity !== column.identity || current.generated !== column.generated) {
                    blockers.push(`ชนิดข้อมูล ${name} ไม่ตรงรุ่น (${current.type} → ${column.type}) ไม่แปลงหรือลบข้อมูลอัตโนมัติ`);
                }
                if (current.nullable && !column.nullable) {
                    if (nullColumns.has(name)) blockers.push(`${name} มีค่าว่าง ต้องตรวจข้อมูลก่อนกำหนดห้ามว่าง`);
                    else add(definitions, 'nullability', name, `ALTER TABLE ${tableName(table.name)} ALTER COLUMN ${quoteIdentifier(column.name)} SET NOT NULL`);
                } else if (!current.nullable && column.nullable) blockers.push(`${name} ถูกตั้งห้ามว่างต่างจากรุ่นนี้ ต้องตรวจข้อกำหนดก่อน`);
                if (!column.identity && current.default !== column.default) {
                    if (current.default === null && column.default !== null) add(definitions, 'default', name,
                        `ALTER TABLE ${tableName(table.name)} ALTER COLUMN ${quoteIdentifier(column.name)} SET DEFAULT ${column.default}`);
                    else blockers.push(`ค่าเริ่มต้น ${name} ไม่ตรงรุ่น ต้องตรวจสอบก่อน ไม่เขียนทับค่าที่ตั้งไว้`);
                }
            }
        }
        for (const constraint of table.constraints) {
            const current = found?.constraints.find(item => item.name === constraint.name
                || item.type === constraint.type && normalized(item.definition) === normalized(constraint.definition));
            if (current) {
                if (current.type !== constraint.type || normalized(current.definition) !== normalized(constraint.definition) || !current.validated) {
                    blockers.push(`ข้อกำหนด ${table.name}.${constraint.name} ไม่ตรงรุ่น ต้องตรวจข้อมูลก่อน`);
                }
            } else add(constraint.type === 'f' ? foreignKeys : constraints, 'constraint', `${table.name}.${constraint.name}`,
                `ALTER TABLE ${tableName(table.name)} ADD CONSTRAINT ${quoteIdentifier(constraint.name)} ${constraint.createDefinition || constraint.definition}`);
        }
        for (const index of table.indexes) {
            const current = found?.indexes.find(item => item.name === index.name);
            if (current && (!current.valid || normalized(current.definition) !== normalized(index.definition))) blockers.push(`ดัชนี ${index.name} ไม่ตรงรุ่นหรือใช้ไม่ได้ ต้องตรวจสอบก่อน`);
            else if (!current) add(indexes, 'index', index.name, index.definition);
        }
    }
    for (const fn of expected.functions) {
        const current = actual.functions.find(item => item.name === fn.name && item.arguments === fn.arguments);
        if (!current || normalized(current.definition) !== normalized(fn.definition)) add(functions, 'function', fn.name, fn.definition);
    }
    operations.push(...definitions, ...constraints, ...foreignKeys, ...indexes, ...functions);
    return { operations, blockers, ready: operations.length === 0 && blockers.length === 0 };
}

export async function inspectApplicationSchema(client, contract) {
    // Fully qualified catalog expressions are independent of the connection's search_path.
    const expected = contract || await loadSchemaContract(), actual = await readSchemaSnapshot(client);
    const populated = new Set(), nullColumns = new Set();
    for (const table of expected.tables) {
        const current = actual.tables.find(item => item.name === table.name);
        if (current && table.columns.some(column => !column.nullable && !current.columns.some(item => item.name === column.name))) {
            if ((await client.query(`SELECT EXISTS(SELECT 1 FROM ${tableName(table.name)} LIMIT 1) AS present`)).rows[0].present) populated.add(table.name);
        }
        for (const column of table.columns) {
            if (!column.nullable && current?.columns.find(item => item.name === column.name)?.nullable) {
                if ((await client.query(`SELECT EXISTS(SELECT 1 FROM ${tableName(table.name)} WHERE ${quoteIdentifier(column.name)} IS NULL LIMIT 1) AS present`)).rows[0].present) nullColumns.add(`${table.name}.${column.name}`);
            }
        }
    }
    return planSchemaUpgrade(expected, actual, populated, nullColumns);
}
