import pool from "../config/db.js";

const TABLE_SCHEMA = "kumon";

// Packet numbers are 1, 11, 21, ... 191 — worksheet_master only carries one
// row per packet (its first worksheet number), same convention used by the
// forecast page.
export async function loadWsSummary() {
    const result = await pool.query(`
        SELECT
            sm.subject_id,
            sm.subject_code,
            lm.level_master_id,
            lm.level_code,
            lm.level_type,
            wm.worksheet_no AS packet_no,
            COALESCE(s.quantity, 0) AS quantity
        FROM ${TABLE_SCHEMA}.worksheet_master wm
        JOIN ${TABLE_SCHEMA}.level_master lm
          ON lm.level_master_id = wm.level_master_id
        JOIN ${TABLE_SCHEMA}.subject_master sm
          ON sm.subject_id = lm.subject_id
        JOIN ${TABLE_SCHEMA}.stock_type_master stm
          ON stm.stock_type_code = 'WS'
        LEFT JOIN ${TABLE_SCHEMA}.stock s
          ON s.stock_type_id = stm.stock_type_id
         AND s.master_id = wm.worksheet_master_id
        -- TRP 7A/6A are studied for real (worksheet_used has hundreds of
        -- rows) but never produce a real cpws = TRUE packet completion —
        -- 0/644 and 2/326 respectively, vs every level from 5A onward being
        -- overwhelmingly TRUE. No physical WS packet is ever actually
        -- stocked for these two levels, so they don't belong on a stock page.
        WHERE NOT (sm.subject_code = 'TRP' AND lm.level_code IN ('7A', '6A'))
        ORDER BY sm.subject_id, lm.level_type, lm.level_master_id, wm.worksheet_no
    `);

    return result.rows;
}

export async function loadCdSummary() {
    const result = await pool.query(`
        SELECT
            sm.subject_id,
            sm.subject_code,
            lm.level_master_id,
            lm.level_code,
            lm.level_type,
            cm.cd_no,
            COALESCE(s.quantity, 0) AS quantity
        FROM ${TABLE_SCHEMA}.cd_master cm
        JOIN ${TABLE_SCHEMA}.level_master lm
          ON lm.level_master_id = cm.level_master_id
        JOIN ${TABLE_SCHEMA}.subject_master sm
          ON sm.subject_id = lm.subject_id
        JOIN ${TABLE_SCHEMA}.stock_type_master stm
          ON stm.stock_type_code = 'CD'
        LEFT JOIN ${TABLE_SCHEMA}.stock s
          ON s.stock_type_id = stm.stock_type_id
         AND s.master_id = cm.cd_master_id
        ORDER BY sm.subject_id, lm.level_type, lm.level_master_id, cm.cd_no
    `);

    return result.rows;
}

function buildPivot(rows, columnKey, columnLabelPrefix = "") {
    const columnSet = new Set();
    const levelsByKey = new Map();
    const levelOrder = [];

    rows.forEach((row) => {
        const columnValue = Number(row[columnKey]);
        columnSet.add(columnValue);

        const levelKey = Number(row.level_master_id);

        if (!levelsByKey.has(levelKey)) {
            levelsByKey.set(levelKey, {
                levelMasterId: levelKey,
                levelCode: row.level_code,
                levelType: Number(row.level_type),
                values: {},
                total: 0
            });
            levelOrder.push(levelKey);
        }

        const level = levelsByKey.get(levelKey);
        const quantity = Number(row.quantity || 0);

        level.values[columnValue] = quantity;
        level.total += quantity;
    });

    const columns = [...columnSet].sort((a, b) => a - b);
    const levels = levelOrder.map((key) => levelsByKey.get(key));
    const columnTotals = {};

    columns.forEach((column) => {
        columnTotals[column] = levels.reduce(
            (sum, level) => sum + (level.values[column] || 0),
            0
        );
    });

    const grandTotal = levels.reduce((sum, level) => sum + level.total, 0);

    return {
        columns: columns.map((value) => `${columnLabelPrefix}${value}`),
        columnValues: columns,
        levels,
        columnTotals,
        grandTotal
    };
}

export async function getStockSummary() {
    const [wsRows, cdRows] = await Promise.all([
        loadWsSummary(),
        loadCdSummary()
    ]);

    const subjectsByCode = new Map();
    const subjectOrder = [];

    function ensureSubject(subjectId, subjectCode) {
        if (!subjectsByCode.has(subjectCode)) {
            subjectsByCode.set(subjectCode, {
                subjectId: Number(subjectId),
                subjectCode,
                wsRows: [],
                cdRows: []
            });
            subjectOrder.push(subjectCode);
        }

        return subjectsByCode.get(subjectCode);
    }

    wsRows.forEach((row) => {
        ensureSubject(row.subject_id, row.subject_code).wsRows.push(row);
    });
    cdRows.forEach((row) => {
        ensureSubject(row.subject_id, row.subject_code).cdRows.push(row);
    });

    subjectOrder.sort((a, b) => {
        const subjectA = subjectsByCode.get(a);
        const subjectB = subjectsByCode.get(b);

        return subjectA.subjectId - subjectB.subjectId;
    });

    const subjects = subjectOrder.map((subjectCode) => {
        const entry = subjectsByCode.get(subjectCode);

        return {
            subjectId: entry.subjectId,
            subjectCode,
            ws: buildPivot(entry.wsRows, "packet_no"),
            cd: buildPivot(entry.cdRows, "cd_no", "CD")
        };
    });

    return {
        subjects,
        generatedAt: new Date().toISOString()
    };
}
