import pool from "../config/db.js";
import { httpError } from "./httpError.js";

// role_code -> Set<permission_key>. The grant table is tiny (a handful of
// roles x a handful of pages) and only changes when an admin edits it from
// the Users page, so a load-once-then-cache beats a DB round trip on every
// permission-gated request. invalidateCache() is called after every write.
let permissionCache = null;

async function loadPermissionCache() {
    const result = await pool.query(`SELECT role_code, permission_key FROM role_permission`);
    const cache = new Map();

    result.rows.forEach((row) => {
        if (!cache.has(row.role_code)) {
            cache.set(row.role_code, new Set());
        }

        cache.get(row.role_code).add(row.permission_key);
    });

    permissionCache = cache;
    return cache;
}

function invalidateCache() {
    permissionCache = null;
}

// Used by the requirePermission middleware. admin is handled separately
// there (hardcoded bypass — never looked up here), so this only ever
// answers "does this non-admin role's grant set include this key".
export async function roleHasPermission(roleCode, permissionKey) {
    const cache = permissionCache || await loadPermissionCache();

    return Boolean(cache.get(roleCode)?.has(permissionKey));
}

// The full set of permission keys granted to a role — used by /api/auth/me
// so the frontend nav can show/hide links without hardcoding role names.
export async function grantedPermissionsFor(roleCode) {
    const cache = permissionCache || await loadPermissionCache();

    return [...(cache.get(roleCode) || [])];
}

export async function listRoles() {
    const result = await pool.query(
        `SELECT
            role_master.role_code,
            role_master.role_name,
            role_master.is_system,
            role_master.sort_order,
            (
                SELECT COUNT(*)::int FROM app_user
                WHERE app_user.role = role_master.role_code AND app_user.is_active
            ) AS active_user_count
         FROM role_master
         ORDER BY role_master.sort_order, role_master.role_code`
    );

    return result.rows;
}

export async function listPermissionCatalog() {
    const result = await pool.query(
        `SELECT permission_key, permission_label, nav_group, sort_order
         FROM permission_master
         ORDER BY nav_group, sort_order`
    );

    return result.rows;
}

export async function listAllRolePermissions() {
    const result = await pool.query(`SELECT role_code, permission_key FROM role_permission`);

    return result.rows;
}

function normalizeRoleCode(roleCode) {
    return String(roleCode || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "-")
        .slice(0, 20);
}

export async function createRole({ roleCode, roleName }) {
    const normalizedCode = normalizeRoleCode(roleCode);
    const normalizedName = String(roleName || "").trim();

    if (!normalizedCode) {
        throw httpError(400, "role code ห้ามว่าง (ใช้ a-z, 0-9, - หรือ _ เท่านั้น)");
    }

    if (!normalizedName) {
        throw httpError(400, "กรุณากรอกชื่อ role");
    }

    if (["admin", "guest"].includes(normalizedCode)) {
        throw httpError(400, "role code นี้สงวนไว้สำหรับระบบแล้ว");
    }

    const result = await pool.query(
        `INSERT INTO role_master (role_code, role_name, is_system, sort_order)
         VALUES ($1, $2, FALSE, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM role_master))
         ON CONFLICT (role_code) DO NOTHING
         RETURNING role_code, role_name, is_system, sort_order`,
        [normalizedCode, normalizedName]
    );

    if (!result.rows[0]) {
        throw httpError(409, `role code "${normalizedCode}" มีอยู่แล้ว`);
    }

    return { ...result.rows[0], active_user_count: 0 };
}

export async function renameRole(roleCode, roleName) {
    const normalizedName = String(roleName || "").trim();

    if (!normalizedName) {
        throw httpError(400, "กรุณากรอกชื่อ role");
    }

    const existing = await pool.query(`SELECT is_system FROM role_master WHERE role_code = $1`, [roleCode]);

    if (!existing.rows[0]) {
        throw httpError(404, "ไม่พบ role นี้");
    }

    if (existing.rows[0].is_system) {
        throw httpError(400, "แก้ไขชื่อ role ระบบ (Admin/Guest) ไม่ได้");
    }

    const result = await pool.query(
        `UPDATE role_master SET role_name = $2 WHERE role_code = $1
         RETURNING role_code, role_name, is_system, sort_order`,
        [roleCode, normalizedName]
    );

    return result.rows[0];
}

export async function deleteRole(roleCode) {
    const existing = await pool.query(`SELECT is_system FROM role_master WHERE role_code = $1`, [roleCode]);

    if (!existing.rows[0]) {
        throw httpError(404, "ไม่พบ role นี้");
    }

    if (existing.rows[0].is_system) {
        throw httpError(400, "ลบ role ระบบ (Admin/Guest) ไม่ได้");
    }

    const inUse = await pool.query(
        `SELECT COUNT(*)::int AS count FROM app_user WHERE role = $1`,
        [roleCode]
    );

    if (inUse.rows[0].count > 0) {
        throw httpError(
            409,
            `ลบไม่ได้ — ยังมีบัญชีผู้ใช้ ${inUse.rows[0].count} คนใช้ role นี้อยู่ เปลี่ยน role บัญชีเหล่านั้นก่อน`
        );
    }

    await pool.query(`DELETE FROM role_master WHERE role_code = $1`, [roleCode]);
    invalidateCache();
}

export async function setRolePermissions(roleCode, permissionKeys) {
    if (roleCode === "admin") {
        throw httpError(400, "Admin เข้าถึงได้ทุกอย่างเสมอ ไม่ต้องตั้งค่า permission");
    }

    if (roleCode === "guest") {
        throw httpError(400, "Guest จำกัดสิทธิ์ไว้ตายตัว (งานประจำเท่านั้น) ให้สิทธิ์เพิ่มไม่ได้");
    }

    const role = await pool.query(`SELECT role_code FROM role_master WHERE role_code = $1`, [roleCode]);

    if (!role.rows[0]) {
        throw httpError(404, "ไม่พบ role นี้");
    }

    const keys = Array.isArray(permissionKeys) ? [...new Set(permissionKeys.map(String))] : [];
    const client = await pool.connect();

    try {
        await client.query("BEGIN");
        await client.query(`DELETE FROM role_permission WHERE role_code = $1`, [roleCode]);

        if (keys.length) {
            const values = keys.map((_, index) => `($1, $${index + 2})`).join(", ");

            await client.query(
                `INSERT INTO role_permission (role_code, permission_key) VALUES ${values}`,
                [roleCode, ...keys]
            );
        }

        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK");

        if (error.code === "23503") {
            throw httpError(400, "มี permission key ที่ไม่รู้จักอยู่ในรายการที่ส่งมา");
        }

        throw error;
    } finally {
        client.release();
    }

    invalidateCache();

    const updated = await pool.query(
        `SELECT permission_key FROM role_permission WHERE role_code = $1`,
        [roleCode]
    );

    return updated.rows.map((row) => row.permission_key);
}
