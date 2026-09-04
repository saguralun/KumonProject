import pool from "../config/db.js";
import { httpError } from "./httpError.js";

const TABLE_SCHEMA = "kumon";

// Mirrors stockReceiveService.js's ITEM_TYPE_CONFIG, but for the "used"
// side — worksheet_used/cd_used rows that haven't been cut from stock yet
// (is_stock_processed = FALSE). "Batch" here is just a date grouping
// computed on the fly (worksheet_date/cd_date), not a persisted entity
// like stock_do — usage records don't naturally arrive in a single
// delivery-note-style unit the way received stock does.
const ITEM_TYPE_CONFIG = {
    ws: {
        stockTypeCode: "WS",
        usedTable: "worksheet_used",
        masterTable: "worksheet_master",
        masterFk: "worksheet_master_id",
        dateColumn: "worksheet_date",
        itemNoColumn: "worksheet_no",
        // worksheet_used.cpws (no equivalent on cd_used) marks which rows
        // actually correspond to a physical packet page being consumed:
        // FALSE means either a same-packet continuation day already
        // counted once on its cpws=TRUE row (see buildGroupPreview's
        // `cpws: index === 0` in worksheetInput.js), or a Kumon Connect
        // enrollment (forced cpws=FALSE — KC never touches physical
        // stock at all). Cutting those too would double-count a packet
        // already cut, or cut stock for students who never used any.
        requireCpws: true
    },
    cd: {
        stockTypeCode: "CD",
        usedTable: "cd_used",
        masterTable: "cd_master",
        masterFk: "cd_master_id",
        dateColumn: "cd_date",
        itemNoColumn: "cd_no",
        requireCpws: false
    }
};

let stockTypeIdCache = null;

async function loadStockTypeIds() {
    if (stockTypeIdCache) {
        return stockTypeIdCache;
    }

    const result = await pool.query(`SELECT stock_type_code, stock_type_id FROM ${TABLE_SCHEMA}.stock_type_master`);
    const byCode = new Map(result.rows.map((row) => [row.stock_type_code, row.stock_type_id]));

    stockTypeIdCache = {};

    for (const [type, config] of Object.entries(ITEM_TYPE_CONFIG)) {
        const stockTypeId = byCode.get(config.stockTypeCode);

        if (!stockTypeId) {
            throw httpError(500, `ไม่พบ stock_type_master สำหรับ ${config.stockTypeCode}`);
        }

        stockTypeIdCache[type] = stockTypeId;
    }

    return stockTypeIdCache;
}

async function resolveType(type) {
    const normalized = String(type || "").trim().toLowerCase();
    const config = ITEM_TYPE_CONFIG[normalized];

    if (!config) {
        throw httpError(400, "ประเภทสต็อกไม่ถูกต้อง (ต้องเป็น ws หรือ cd)");
    }

    const stockTypeIds = await loadStockTypeIds();

    return { type: normalized, stockTypeId: stockTypeIds[normalized], ...config };
}

function normalizeDate(value) {
    if (value instanceof Date) {
        const year = value.getFullYear();
        const month = String(value.getMonth() + 1).padStart(2, "0");
        const day = String(value.getDate()).padStart(2, "0");

        return `${year}-${month}-${day}`;
    }

    return value ? String(value).slice(0, 10) : null;
}

// One row per date that still has pending (unprocessed) usage — the main
// list view. Dates disappear from here as soon as everything on them has
// been cut, so this is always "what's left to do", not a full history.
export async function searchPendingDates(type) {
    const config = await resolveType(type);

    const result = await pool.query(`
        SELECT
            ${config.dateColumn} AS used_date,
            COUNT(DISTINCT ${config.masterFk})::int AS item_count,
            COUNT(*)::int AS total_quantity
        FROM ${TABLE_SCHEMA}.${config.usedTable}
        WHERE is_stock_processed = FALSE
          ${config.requireCpws ? "AND cpws = TRUE" : ""}
        GROUP BY ${config.dateColumn}
        ORDER BY ${config.dateColumn} DESC
    `);

    return {
        type: config.type,
        rows: result.rows.map((row) => ({
            date: normalizeDate(row.used_date),
            itemCount: row.item_count,
            totalQuantity: row.total_quantity
        }))
    };
}

// Item breakdown for one pending date — what would actually get cut, and
// what stock.quantity would look like afterward (surfaced so a negative
// result is visible before committing, per the owner: allowed, just
// flagged rather than blocked).
export async function getPendingDateDetail(type, date) {
    const config = await resolveType(type);
    const normalizedDate = normalizeDate(date);

    if (!normalizedDate) {
        throw httpError(400, "วันที่ไม่ถูกต้อง");
    }

    const itemColumns = config.type === "ws"
        ? `wm.${config.itemNoColumn} AS item_no`
        : `cm.${config.itemNoColumn} AS item_no`;
    const masterJoin = config.type === "ws"
        ? `JOIN ${TABLE_SCHEMA}.worksheet_master wm ON wm.worksheet_master_id = u.${config.masterFk}
           JOIN ${TABLE_SCHEMA}.level_master lm ON lm.level_master_id = wm.level_master_id`
        : `JOIN ${TABLE_SCHEMA}.cd_master cm ON cm.cd_master_id = u.${config.masterFk}
           JOIN ${TABLE_SCHEMA}.level_master lm ON lm.level_master_id = cm.level_master_id`;

    const result = await pool.query(`
        SELECT
            u.${config.masterFk} AS master_id,
            sub.subject_code,
            lm.level_code,
            ${itemColumns},
            COUNT(*)::int AS quantity,
            COALESCE(s.quantity, 0)::int AS current_stock
        FROM ${TABLE_SCHEMA}.${config.usedTable} u
        ${masterJoin}
        JOIN ${TABLE_SCHEMA}.subject_master sub ON sub.subject_id = lm.subject_id
        LEFT JOIN ${TABLE_SCHEMA}.stock s ON s.stock_type_id = $1 AND s.master_id = u.${config.masterFk}
        WHERE u.is_stock_processed = FALSE
          AND u.${config.dateColumn} = $2::date
          ${config.requireCpws ? "AND u.cpws = TRUE" : ""}
        GROUP BY u.${config.masterFk}, sub.subject_code, lm.level_master_id, lm.level_code, ${config.type === "ws" ? "wm." : "cm."}${config.itemNoColumn}, s.quantity
        ORDER BY sub.subject_code, lm.level_master_id, item_no
    `, [config.stockTypeId, normalizedDate]);

    return {
        type: config.type,
        date: normalizedDate,
        items: result.rows.map((row) => ({
            masterId: row.master_id,
            subjectCode: row.subject_code,
            levelCode: row.level_code,
            itemNo: row.item_no,
            quantity: row.quantity,
            currentStock: row.current_stock,
            resultingStock: row.current_stock - row.quantity
        }))
    };
}

// Cuts one or more pending dates in a single transaction: deducts every
// distinct item's total pending quantity from stock.quantity (negative
// results allowed — see getPendingDateDetail) and marks every underlying
// usage row on those dates as processed.
export async function processPendingDates(type, dates) {
    const config = await resolveType(type);
    const normalizedDates = (Array.isArray(dates) ? dates : [dates])
        .map(normalizeDate)
        .filter(Boolean);

    if (!normalizedDates.length) {
        throw httpError(400, "กรุณาเลือกอย่างน้อย 1 วัน");
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const itemsResult = await client.query(`
            SELECT ${config.masterFk} AS master_id, COUNT(*)::int AS quantity
            FROM ${TABLE_SCHEMA}.${config.usedTable}
            WHERE is_stock_processed = FALSE
              AND ${config.dateColumn} = ANY($1::date[])
              ${config.requireCpws ? "AND cpws = TRUE" : ""}
            GROUP BY ${config.masterFk}
        `, [normalizedDates]);

        if (!itemsResult.rows.length) {
            throw httpError(404, "ไม่พบรายการที่ยังไม่ได้ตัด stock ในวันที่เลือก");
        }

        for (const item of itemsResult.rows) {
            await client.query(`
                INSERT INTO ${TABLE_SCHEMA}.stock (stock_type_id, master_id, quantity)
                VALUES ($1, $2, $3)
                ON CONFLICT (stock_type_id, master_id) DO UPDATE
                    SET quantity = ${TABLE_SCHEMA}.stock.quantity - $3,
                        updated_at = CURRENT_TIMESTAMP
            `, [config.stockTypeId, item.master_id, item.quantity]);
        }

        // cpws = FALSE rows (continuation days / Kumon Connect) are
        // deliberately left with is_stock_processed still FALSE — they
        // were never counted into itemsResult above, so marking them
        // processed here would be a lie: nothing was ever cut for them.
        // Leaving it FALSE also keeps them editable elsewhere in the app
        // (worksheetService.js blocks edits once is_stock_processed is
        // TRUE), which is correct since no stock was ever locked in.
        const updateResult = await client.query(`
            UPDATE ${TABLE_SCHEMA}.${config.usedTable}
            SET is_stock_processed = TRUE
            WHERE is_stock_processed = FALSE
              AND ${config.dateColumn} = ANY($1::date[])
              ${config.requireCpws ? "AND cpws = TRUE" : ""}
        `, [normalizedDates]);

        await client.query("COMMIT");

        return {
            type: config.type,
            datesProcessed: normalizedDates.length,
            itemsProcessed: itemsResult.rows.length,
            recordsProcessed: updateResult.rowCount
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}
