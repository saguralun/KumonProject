import pool from "../config/db.js";
import { httpError } from "./httpError.js";

const TABLE_SCHEMA = "kumon";

// One shared DO system for every stock type — mirrors how the `stock`
// table itself works: stock_type_id + master_id together say which master
// table a row means (master_id carries no FK of its own, it's polymorphic).
// AT and DT are deliberately out of scope for now; add them here later.
const ITEM_TYPE_CONFIG = {
    ws: {
        stockTypeCode: "WS",
        masterTable: "worksheet_master",
        masterPkColumn: "worksheet_master_id",
        itemNoColumn: "worksheet_no"
    },
    cd: {
        stockTypeCode: "CD",
        masterTable: "cd_master",
        masterPkColumn: "cd_master_id",
        itemNoColumn: "cd_no"
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

function assertIsoDate(value, label) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
        throw httpError(400, `${label} ไม่ถูกต้อง`);
    }

    return value;
}

// Same "day 21+ rolls to next month" rule used for billing periods elsewhere
// in the app (worksheetService.js / studentService.js / worksheet.js) —
// receiving stock late in the month counts toward next month's period.
function kumonPeriodFromDate(dateText) {
    const [year, month, day] = dateText.split("-").map(Number);
    const nextMonth = day > 20 ? month + 1 : month;

    if (nextMonth > 12) {
        return { month: 1, year: year + 1 };
    }

    return { month: nextMonth, year };
}

export async function getStockReceiveMasters() {
    const [subjectsResult, levelsResult, worksheetsResult, cdsResult] = await Promise.all([
        pool.query(`SELECT subject_id, subject_code, subject_name FROM ${TABLE_SCHEMA}.subject_master ORDER BY subject_id`),
        pool.query(`
            SELECT level_master_id, subject_id, level_code
            FROM ${TABLE_SCHEMA}.level_master
            ORDER BY subject_id, level_master_id
        `),
        pool.query(`
            SELECT worksheet_master_id, level_master_id, worksheet_no
            FROM ${TABLE_SCHEMA}.worksheet_master
            ORDER BY level_master_id, worksheet_no
        `),
        pool.query(`
            SELECT cd_master_id, level_master_id, cd_no
            FROM ${TABLE_SCHEMA}.cd_master
            ORDER BY level_master_id, cd_no
        `)
    ]);

    return {
        subjects: subjectsResult.rows.map((row) => ({
            subjectId: row.subject_id,
            subjectCode: row.subject_code,
            subjectName: row.subject_name
        })),
        levels: levelsResult.rows.map((row) => ({
            levelMasterId: row.level_master_id,
            subjectId: row.subject_id,
            levelCode: row.level_code
        })),
        worksheets: worksheetsResult.rows.map((row) => ({
            worksheetMasterId: row.worksheet_master_id,
            levelMasterId: row.level_master_id,
            worksheetNo: row.worksheet_no
        })),
        cds: cdsResult.rows.map((row) => ({
            cdMasterId: row.cd_master_id,
            levelMasterId: row.level_master_id,
            cdNo: row.cd_no
        }))
    };
}

function mapDeliveryOrderRow(row) {
    return {
        doId: row.stock_do_id,
        doNo: row.do_no,
        type: row.type_code ? row.type_code.toLowerCase() : null,
        outDate: normalizeDate(row.out_date),
        receiveDate: normalizeDate(row.receive_date),
        receiveMonth: row.receive_month,
        receiveYear: row.receive_year,
        isStockProcessed: row.is_stock_processed,
        itemCount: Number(row.item_count || 0),
        totalQuantity: Number(row.total_quantity || 0)
    };
}

// type: "ws" | "cd" | "all". Filtering by type only counts a DO's items of
// that type (a DO is homogeneous in practice — created as either all-WS or
// all-CD — so this also gives a clean single type_code per row).
export async function searchDeliveryOrders({ type = "all", status = "all", query = "", limit = 200 } = {}) {
    const normalizedStatus = ["pending", "processed"].includes(status) ? status : "all";
    const normalizedQuery = String(query || "").trim();
    const normalizedLimit = Math.min(Math.max(Number(limit) || 200, 1), 500);
    const statusParam = normalizedStatus === "all" ? null : normalizedStatus === "processed";
    const queryParam = normalizedQuery ? `%${normalizedQuery}%` : null;

    const normalizedType = String(type || "all").trim().toLowerCase();
    const typeStockTypeId = normalizedType === "all" ? null : (await resolveType(normalizedType)).stockTypeId;

    const result = await pool.query(`
        SELECT
            d.stock_do_id,
            d.do_no,
            d.out_date,
            d.receive_date,
            d.receive_month,
            d.receive_year,
            d.is_stock_processed,
            MIN(stm.stock_type_code) AS type_code,
            COUNT(r.stock_receive_id)::int AS item_count,
            COALESCE(SUM(r.quantity), 0)::int AS total_quantity
        FROM ${TABLE_SCHEMA}.stock_do d
        LEFT JOIN ${TABLE_SCHEMA}.stock_receive r
            ON r.stock_do_id = d.stock_do_id
            AND ($4::smallint IS NULL OR r.stock_type_id = $4)
        LEFT JOIN ${TABLE_SCHEMA}.stock_type_master stm
            ON stm.stock_type_id = r.stock_type_id
        WHERE ($1::boolean IS NULL OR d.is_stock_processed = $1)
          AND ($2::text IS NULL OR d.do_no ILIKE $2)
          AND ($4::smallint IS NULL OR EXISTS (
              SELECT 1 FROM ${TABLE_SCHEMA}.stock_receive r2
              WHERE r2.stock_do_id = d.stock_do_id AND r2.stock_type_id = $4
          ))
        GROUP BY d.stock_do_id
        ORDER BY d.receive_date DESC NULLS LAST, d.stock_do_id DESC
        LIMIT $3
    `, [statusParam, queryParam, normalizedLimit, typeStockTypeId]);

    return result.rows.map(mapDeliveryOrderRow);
}

export async function getDeliveryOrderDetail(doId) {
    const normalizedDoId = Number(doId);

    if (!Number.isInteger(normalizedDoId) || normalizedDoId < 1) {
        throw httpError(400, "DO ID ไม่ถูกต้อง");
    }

    const headerResult = await pool.query(`
        SELECT
            d.stock_do_id,
            d.do_no,
            d.out_date,
            d.receive_date,
            d.receive_month,
            d.receive_year,
            d.is_stock_processed,
            MIN(stm.stock_type_code) AS type_code
        FROM ${TABLE_SCHEMA}.stock_do d
        LEFT JOIN ${TABLE_SCHEMA}.stock_receive r ON r.stock_do_id = d.stock_do_id
        LEFT JOIN ${TABLE_SCHEMA}.stock_type_master stm ON stm.stock_type_id = r.stock_type_id
        WHERE d.stock_do_id = $1
        GROUP BY d.stock_do_id
    `, [normalizedDoId]);
    const header = headerResult.rows[0];

    if (!header) {
        throw httpError(404, "ไม่พบ DO นี้");
    }

    const itemsResult = await pool.query(`
        SELECT
            r.stock_receive_id AS receive_id,
            r.master_id,
            r.quantity,
            stm.stock_type_code AS type_code,
            sub.subject_code,
            lm.level_code,
            wm.worksheet_no AS item_no
        FROM ${TABLE_SCHEMA}.stock_receive r
        JOIN ${TABLE_SCHEMA}.stock_type_master stm ON stm.stock_type_id = r.stock_type_id
        JOIN ${TABLE_SCHEMA}.worksheet_master wm ON wm.worksheet_master_id = r.master_id
        JOIN ${TABLE_SCHEMA}.level_master lm ON lm.level_master_id = wm.level_master_id
        JOIN ${TABLE_SCHEMA}.subject_master sub ON sub.subject_id = lm.subject_id
        WHERE r.stock_do_id = $1 AND stm.stock_type_code = 'WS'

        UNION ALL

        SELECT
            r.stock_receive_id AS receive_id,
            r.master_id,
            r.quantity,
            stm.stock_type_code AS type_code,
            sub.subject_code,
            lm.level_code,
            cm.cd_no AS item_no
        FROM ${TABLE_SCHEMA}.stock_receive r
        JOIN ${TABLE_SCHEMA}.stock_type_master stm ON stm.stock_type_id = r.stock_type_id
        JOIN ${TABLE_SCHEMA}.cd_master cm ON cm.cd_master_id = r.master_id
        JOIN ${TABLE_SCHEMA}.level_master lm ON lm.level_master_id = cm.level_master_id
        JOIN ${TABLE_SCHEMA}.subject_master sub ON sub.subject_id = lm.subject_id
        WHERE r.stock_do_id = $1 AND stm.stock_type_code = 'CD'

        ORDER BY subject_code, level_code, item_no
    `, [normalizedDoId]);

    return {
        ...mapDeliveryOrderRow({
            ...header,
            item_count: itemsResult.rows.length,
            total_quantity: itemsResult.rows.reduce((sum, row) => sum + Number(row.quantity), 0)
        }),
        items: itemsResult.rows.map((row) => ({
            receiveId: row.receive_id,
            masterId: row.master_id,
            type: row.type_code.toLowerCase(),
            subjectCode: row.subject_code,
            levelCode: row.level_code,
            itemNo: row.item_no,
            quantity: row.quantity
        }))
    };
}

export async function createDeliveryOrder(type, payload) {
    const config = await resolveType(type);
    const doNo = String(payload?.doNo || "").trim();
    const outDate = assertIsoDate(payload?.outDate, "Out Date");
    const receiveDate = payload?.receiveDate ? assertIsoDate(payload.receiveDate, "Receive Date") : outDate;
    const items = Array.isArray(payload?.items) ? payload.items : [];

    if (!doNo) {
        throw httpError(400, "กรุณากรอกเลข DO");
    }

    if (!items.length) {
        throw httpError(400, "กรุณาเพิ่มอย่างน้อย 1 รายการ");
    }

    const normalizedItems = items.map((item, index) => {
        const masterId = Number(item?.masterId);
        const quantity = Number(item?.quantity);

        if (!Number.isInteger(masterId) || masterId < 1) {
            throw httpError(400, `แถวที่ ${index + 1}: เลือกรายการให้ครบ`);
        }

        if (!Number.isInteger(quantity) || quantity < 1) {
            throw httpError(400, `แถวที่ ${index + 1}: จำนวนต้องเป็นเลขจำนวนเต็มมากกว่า 0`);
        }

        return { masterId, quantity };
    });

    const mergedByMaster = new Map();

    for (const item of normalizedItems) {
        mergedByMaster.set(item.masterId, (mergedByMaster.get(item.masterId) || 0) + item.quantity);
    }

    const period = kumonPeriodFromDate(receiveDate);
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const existing = await client.query(
            `SELECT stock_do_id, is_stock_processed FROM ${TABLE_SCHEMA}.stock_do WHERE do_no = $1`,
            [doNo]
        );
        const existingDo = existing.rows[0];
        let doId;
        let appended = false;

        if (existingDo) {
            if (existingDo.is_stock_processed) {
                throw httpError(409, `เลข DO '${doNo}' ถูก process เข้า stock ไปแล้ว ไม่สามารถเพิ่มรายการได้`);
            }

            // A DO is homogeneous (all-WS or all-CD, see the comment on
            // searchDeliveryOrders) — appending a different type onto it
            // would break that, so block the mismatch explicitly rather
            // than silently mixing types under one DO number.
            const existingType = await client.query(
                `SELECT MIN(stm.stock_type_code) AS stock_type_code
                 FROM ${TABLE_SCHEMA}.stock_receive r
                 JOIN ${TABLE_SCHEMA}.stock_type_master stm ON stm.stock_type_id = r.stock_type_id
                 WHERE r.stock_do_id = $1`,
                [existingDo.stock_do_id]
            );
            const existingTypeCode = existingType.rows[0]?.stock_type_code;

            if (existingTypeCode && existingTypeCode !== config.stockTypeCode) {
                throw httpError(409, `เลข DO '${doNo}' เป็นรายการ ${existingTypeCode} อยู่แล้ว ไม่สามารถเพิ่ม ${config.stockTypeCode} ได้`);
            }

            doId = existingDo.stock_do_id;
            appended = true;
        } else {
            const doResult = await client.query(`
                INSERT INTO ${TABLE_SCHEMA}.stock_do (
                    do_no, out_date, receive_date, receive_month, receive_year, is_stock_processed
                )
                VALUES ($1, $2, $3, $4, $5, FALSE)
                RETURNING stock_do_id
            `, [doNo, outDate, receiveDate, period.month, period.year]);
            doId = doResult.rows[0].stock_do_id;
        }

        for (const [masterId, quantity] of mergedByMaster.entries()) {
            const masterCheck = await client.query(
                `SELECT 1 FROM ${TABLE_SCHEMA}.${config.masterTable} WHERE ${config.masterPkColumn} = $1`,
                [masterId]
            );

            if (!masterCheck.rows[0]) {
                throw httpError(400, `ไม่พบรายการ id ${masterId}`);
            }

            // Adds onto an existing line for the same item within this DO
            // instead of creating a duplicate row, same additive spirit as
            // processDeliveryOrder below.
            const updateResult = await client.query(`
                UPDATE ${TABLE_SCHEMA}.stock_receive
                SET quantity = quantity + $1
                WHERE stock_do_id = $2 AND stock_type_id = $3 AND master_id = $4
            `, [quantity, doId, config.stockTypeId, masterId]);

            if (updateResult.rowCount === 0) {
                await client.query(`
                    INSERT INTO ${TABLE_SCHEMA}.stock_receive (stock_do_id, stock_type_id, master_id, quantity)
                    VALUES ($1, $2, $3, $4)
                `, [doId, config.stockTypeId, masterId, quantity]);
            }
        }

        await client.query("COMMIT");

        return { type: config.type, doId, doNo, appended };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

// Applies a still-pending DO's received quantities onto stock.quantity
// (additive — a delivery adds to whatever is already counted, it never
// overwrites) and marks the DO processed so it can't be double-applied.
// Type-agnostic: each stock_receive row already carries its own
// stock_type_id + master_id, so it copies straight into `stock` as-is.
export async function processDeliveryOrder(doId) {
    const normalizedDoId = Number(doId);

    if (!Number.isInteger(normalizedDoId) || normalizedDoId < 1) {
        throw httpError(400, "DO ID ไม่ถูกต้อง");
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const doResult = await client.query(`
            SELECT stock_do_id, do_no, is_stock_processed
            FROM ${TABLE_SCHEMA}.stock_do
            WHERE stock_do_id = $1
            FOR UPDATE
        `, [normalizedDoId]);
        const doRow = doResult.rows[0];

        if (!doRow) {
            throw httpError(404, "ไม่พบ DO นี้");
        }

        if (doRow.is_stock_processed) {
            throw httpError(409, "DO นี้ตัด stock ไปแล้ว");
        }

        const itemsResult = await client.query(`
            SELECT stock_type_id, master_id, quantity
            FROM ${TABLE_SCHEMA}.stock_receive
            WHERE stock_do_id = $1
        `, [normalizedDoId]);

        if (!itemsResult.rows.length) {
            throw httpError(400, "DO นี้ไม่มีรายการให้ประมวลผล");
        }

        for (const item of itemsResult.rows) {
            await client.query(`
                INSERT INTO ${TABLE_SCHEMA}.stock (stock_type_id, master_id, quantity)
                VALUES ($1, $2, $3)
                ON CONFLICT (stock_type_id, master_id) DO UPDATE
                    SET quantity = ${TABLE_SCHEMA}.stock.quantity + EXCLUDED.quantity,
                        updated_at = CURRENT_TIMESTAMP
            `, [item.stock_type_id, item.master_id, item.quantity]);
        }

        await client.query(`
            UPDATE ${TABLE_SCHEMA}.stock_do
            SET is_stock_processed = TRUE
            WHERE stock_do_id = $1
        `, [normalizedDoId]);

        await client.query("COMMIT");

        return {
            doId: normalizedDoId,
            doNo: doRow.do_no,
            itemsProcessed: itemsResult.rows.length
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function deleteDeliveryOrder(doId) {
    const normalizedDoId = Number(doId);

    if (!Number.isInteger(normalizedDoId) || normalizedDoId < 1) {
        throw httpError(400, "DO ID ไม่ถูกต้อง");
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const doResult = await client.query(`
            SELECT stock_do_id, is_stock_processed
            FROM ${TABLE_SCHEMA}.stock_do
            WHERE stock_do_id = $1
            FOR UPDATE
        `, [normalizedDoId]);
        const doRow = doResult.rows[0];

        if (!doRow) {
            throw httpError(404, "ไม่พบ DO นี้");
        }

        if (doRow.is_stock_processed) {
            throw httpError(409, "ลบไม่ได้ เพราะ DO นี้ตัด stock ไปแล้ว");
        }

        await client.query(
            `DELETE FROM ${TABLE_SCHEMA}.stock_receive WHERE stock_do_id = $1`,
            [normalizedDoId]
        );
        await client.query(
            `DELETE FROM ${TABLE_SCHEMA}.stock_do WHERE stock_do_id = $1`,
            [normalizedDoId]
        );

        await client.query("COMMIT");

        return { doId: normalizedDoId };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

// Shared by deleteDeliveryOrderItem/updateDeliveryOrderItemQuantity — locks
// and returns the parent DO row, throwing if it's missing, mismatched, or
// already processed (its quantities are already applied to stock.quantity
// at that point, so editing the line here would silently drift out of sync).
async function lockPendingDoForItem(client, doId, receiveId) {
    const normalizedDoId = Number(doId);
    const normalizedReceiveId = Number(receiveId);

    if (!Number.isInteger(normalizedDoId) || normalizedDoId < 1) {
        throw httpError(400, "DO ID ไม่ถูกต้อง");
    }

    if (!Number.isInteger(normalizedReceiveId) || normalizedReceiveId < 1) {
        throw httpError(400, "Item ID ไม่ถูกต้อง");
    }

    const doResult = await client.query(`
        SELECT stock_do_id, is_stock_processed
        FROM ${TABLE_SCHEMA}.stock_do
        WHERE stock_do_id = $1
        FOR UPDATE
    `, [normalizedDoId]);
    const doRow = doResult.rows[0];

    if (!doRow) {
        throw httpError(404, "ไม่พบ DO นี้");
    }

    if (doRow.is_stock_processed) {
        throw httpError(409, "แก้ไม่ได้ เพราะ DO นี้ตัด stock ไปแล้ว");
    }

    const itemResult = await client.query(
        `SELECT stock_receive_id FROM ${TABLE_SCHEMA}.stock_receive WHERE stock_receive_id = $1 AND stock_do_id = $2`,
        [normalizedReceiveId, normalizedDoId]
    );

    if (!itemResult.rows[0]) {
        throw httpError(404, "ไม่พบรายการนี้ใน DO นี้");
    }

    return { doId: normalizedDoId, receiveId: normalizedReceiveId };
}

export async function deleteDeliveryOrderItem(doId, receiveId) {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const { doId: normalizedDoId, receiveId: normalizedReceiveId } =
            await lockPendingDoForItem(client, doId, receiveId);

        const remaining = await client.query(
            `SELECT COUNT(*)::int AS remaining FROM ${TABLE_SCHEMA}.stock_receive WHERE stock_do_id = $1`,
            [normalizedDoId]
        );

        if (Number(remaining.rows[0].remaining) <= 1) {
            throw httpError(409, "ลบไม่ได้ เพราะเป็นรายการสุดท้ายของ DO นี้ — ลบทั้ง DO แทนถ้าไม่ต้องการแล้ว");
        }

        await client.query(
            `DELETE FROM ${TABLE_SCHEMA}.stock_receive WHERE stock_receive_id = $1`,
            [normalizedReceiveId]
        );

        await client.query("COMMIT");

        return { doId: normalizedDoId, receiveId: normalizedReceiveId };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function updateDeliveryOrderItemQuantity(doId, receiveId, quantity) {
    const normalizedQuantity = Number(quantity);

    if (!Number.isInteger(normalizedQuantity) || normalizedQuantity < 1) {
        throw httpError(400, "จำนวนต้องเป็นเลขจำนวนเต็มมากกว่า 0");
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const { doId: normalizedDoId, receiveId: normalizedReceiveId } =
            await lockPendingDoForItem(client, doId, receiveId);

        await client.query(
            `UPDATE ${TABLE_SCHEMA}.stock_receive SET quantity = $1 WHERE stock_receive_id = $2`,
            [normalizedQuantity, normalizedReceiveId]
        );

        await client.query("COMMIT");

        return { doId: normalizedDoId, receiveId: normalizedReceiveId, quantity: normalizedQuantity };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}
