import express from "express";
import pool from "../config/db.js";

const router = express.Router();

const TABLE_SCHEMA = "kumon";
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;
const PAGE_SIZE_OPTIONS = [50, 100, 250, 500];
const MASTER_TABLE_ORDER = [
    "subject_master",
    "level_master",
    "worksheet_master",
    "cd_master",
    "dt_master",
    "dt_result_master",
    "at_master",
    "status_master",
    "school_grade_master",
    "center_master",
    "prefix_master",
    "gender_master",
    "payment_method_master",
    "stock_type_master",
    "stock",
    "weekday_master",
    "opening_schedule"
];
const MASTER_TABLES = new Set(MASTER_TABLE_ORDER);

function quoteIdentifier(identifier) {
    return `"${String(identifier).replace(/"/g, "\"\"")}"`;
}

function parsePositiveInteger(value, fallback) {
    const numberValue = Number(value);

    if (!Number.isInteger(numberValue) || numberValue < 1) {
        return fallback;
    }

    return numberValue;
}

function normalizePageSize(value) {
    return Math.min(
        parsePositiveInteger(value, DEFAULT_PAGE_SIZE),
        MAX_PAGE_SIZE
    );
}

function categorizeTables(tableNames) {
    const tableSet = new Set(tableNames);
    const masterTables = MASTER_TABLE_ORDER
        .filter((tableName) => tableSet.has(tableName))
        .map((tableName) => ({
            table_name: tableName,
            category: "master"
        }));
    const transactionTables = tableNames
        .filter((tableName) => !MASTER_TABLES.has(tableName))
        .sort((a, b) => a.localeCompare(b))
        .map((tableName) => ({
            table_name: tableName,
            category: "transaction"
        }));

    return {
        masterTables,
        transactionTables,
        allTables: [...masterTables, ...transactionTables]
    };
}

async function getTableNames() {
    const result = await pool.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = $1
          AND table_type = 'BASE TABLE'
        ORDER BY table_name
    `, [TABLE_SCHEMA]);

    return result.rows.map((row) => row.table_name);
}

async function getTableMetadata(tableName) {
    const [tableResult, columnsResult, primaryKeyResult] = await Promise.all([
        pool.query(`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = $1
              AND table_name = $2
              AND table_type = 'BASE TABLE'
        `, [TABLE_SCHEMA, tableName]),
        pool.query(`
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = $1
              AND table_name = $2
            ORDER BY ordinal_position
        `, [TABLE_SCHEMA, tableName]),
        pool.query(`
            SELECT kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema = kcu.table_schema
             AND tc.table_name = kcu.table_name
            WHERE tc.table_schema = $1
              AND tc.table_name = $2
              AND tc.constraint_type = 'PRIMARY KEY'
            ORDER BY kcu.ordinal_position
        `, [TABLE_SCHEMA, tableName])
    ]);

    if (tableResult.rows.length === 0 || columnsResult.rows.length === 0) {
        return null;
    }

    return {
        columns: columnsResult.rows.map((row) => row.column_name),
        primaryKeyColumns: primaryKeyResult.rows.map((row) => row.column_name)
    };
}

function buildOrderBy(metadata) {
    const orderColumns = metadata.primaryKeyColumns.length > 0
        ? metadata.primaryKeyColumns
        : metadata.columns;
    const quotedColumns = orderColumns.map((columnName) =>
        quoteIdentifier(columnName)
    );

    if (metadata.primaryKeyColumns.length === 0) {
        quotedColumns.push("ctid");
    }

    return quotedColumns.join(", ");
}

router.get("/tables", async (req, res) => {
    try {
        const tableNames = await getTableNames();
        const {
            masterTables,
            transactionTables,
            allTables
        } = categorizeTables(tableNames);

        res.json({
            success: true,
            schema: TABLE_SCHEMA,
            pageSizeOptions: PAGE_SIZE_OPTIONS,
            defaultPageSize: DEFAULT_PAGE_SIZE,
            categories: [
                {
                    id: "master",
                    title: "Master Tables",
                    tables: masterTables
                },
                {
                    id: "transaction",
                    title: "Transaction Tables",
                    tables: transactionTables
                }
            ],
            tables: allTables
        });
    } catch (err) {
        console.error(err);

        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

router.get("/tables/:tableName", async (req, res) => {
    const { tableName } = req.params;
    const requestedPage = parsePositiveInteger(req.query.page, 1);
    const pageSize = normalizePageSize(req.query.pageSize);

    try {
        const metadata = await getTableMetadata(tableName);

        if (!metadata) {
            return res.status(404).json({
                success: false,
                error: `Table "${tableName}" not found`
            });
        }

        const schemaSql = quoteIdentifier(TABLE_SCHEMA);
        const tableSql = quoteIdentifier(tableName);
        const fromSql = `${schemaSql}.${tableSql}`;
        const countResult = await pool.query(`
            SELECT COUNT(*)::int AS total_rows
            FROM ${fromSql}
        `);
        const totalRows = countResult.rows[0].total_rows;
        const totalPages = Math.ceil(totalRows / pageSize);
        const page = totalPages === 0
            ? 1
            : Math.min(requestedPage, totalPages);
        const offset = (page - 1) * pageSize;
        const orderBy = buildOrderBy(metadata);
        const result = await pool.query(`
            SELECT *
            FROM ${fromSql}
            ORDER BY ${orderBy}
            LIMIT $1 OFFSET $2
        `, [pageSize, offset]);
        const startRow = totalRows === 0
            ? 0
            : offset + 1;
        const endRow = totalRows === 0
            ? 0
            : offset + result.rows.length;

        res.json({
            success: true,
            schema: TABLE_SCHEMA,
            table: tableName,
            category: MASTER_TABLES.has(tableName) ? "master" : "transaction",
            count: result.rows.length,
            totalRows,
            totalPages,
            page,
            pageSize,
            pageSizeOptions: PAGE_SIZE_OPTIONS,
            startRow,
            endRow,
            columns: metadata.columns,
            primaryKeyColumns: metadata.primaryKeyColumns,
            rows: result.rows
        });
    } catch (err) {
        console.error(err);

        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

export default router;
