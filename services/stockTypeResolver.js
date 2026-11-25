import { httpError } from "./httpError.js";

// One resolver/cache per service; receiving and cutting keep independent configs.
export function createStockTypeResolver({ pool, schema: TABLE_SCHEMA, itemTypes: ITEM_TYPE_CONFIG }) {
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

    return resolveType;
}
