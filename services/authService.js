import bcrypt from "bcryptjs";
import pool from "../config/db.js";
import { httpError } from "./httpError.js";

const GUEST_PIN = process.env.GUEST_PIN || "";
const VALID_ROLES = ["admin", "staff"];

function sanitizeAccount(row) {
    return {
        role: row.role,
        userId: row.user_id,
        username: row.username,
        displayName: row.display_name
    };
}

// Handles both "admin" and "staff" DB-backed accounts — the role that
// decides what a signed-in account may do comes from the row itself, not
// from which login form was used.
export async function verifyAccountLogin({ username, password }) {
    const normalizedUsername = String(username || "").trim();

    if (!normalizedUsername || !password) {
        throw httpError(400, "กรุณากรอก username และ password");
    }

    const result = await pool.query(
        `SELECT user_id, username, password_hash, display_name, role, is_active
         FROM app_user
         WHERE username = $1`,
        [normalizedUsername]
    );
    const row = result.rows[0];

    if (!row || !row.is_active) {
        throw httpError(401, "username หรือ password ไม่ถูกต้อง");
    }

    const passwordOk = await bcrypt.compare(String(password), row.password_hash);

    if (!passwordOk) {
        throw httpError(401, "username หรือ password ไม่ถูกต้อง");
    }

    await pool.query(
        `UPDATE app_user SET last_login_at = CURRENT_TIMESTAMP WHERE user_id = $1`,
        [row.user_id]
    );

    return sanitizeAccount(row);
}

export function verifyGuestLogin({ displayName, pin }) {
    const normalizedName = String(displayName || "").trim();

    if (!normalizedName) {
        throw httpError(400, "กรุณากรอกชื่อผู้ใช้งาน");
    }

    if (!GUEST_PIN) {
        // Misconfiguration: refuse guest access rather than silently allow it.
        throw httpError(503, "ระบบยังไม่เปิดใช้งานโหมด Guest");
    }

    if (String(pin || "") !== GUEST_PIN) {
        throw httpError(401, "PIN ไม่ถูกต้อง");
    }

    return {
        role: "guest",
        displayName: normalizedName
    };
}

// role: "admin" (full access, including Table Explorer + migration tools)
// or "staff" (everything else an admin can do, but not those two).
export async function upsertAccount({ username, password, displayName, role = "admin" }) {
    const normalizedUsername = String(username || "").trim();
    const normalizedDisplayName = String(displayName || normalizedUsername).trim();
    const normalizedRole = String(role || "admin").trim();

    if (!normalizedUsername || !password) {
        throw httpError(400, "username และ password ห้ามว่าง");
    }

    if (!VALID_ROLES.includes(normalizedRole)) {
        throw httpError(400, `role ต้องเป็นหนึ่งใน: ${VALID_ROLES.join(", ")}`);
    }

    if (normalizedRole !== "admin") {
        const existing = await pool.query(
            `SELECT user_id, role, is_active FROM app_user WHERE username = $1`,
            [normalizedUsername]
        );

        if (existing.rows[0]?.role === "admin" && existing.rows[0]?.is_active) {
            const remaining = await countOtherActiveAdmins(pool, existing.rows[0].user_id);

            if (remaining === 0) {
                throw httpError(400, "เปลี่ยน role ไม่ได้ เพราะเป็น Admin คนสุดท้ายที่ยัง active อยู่");
            }
        }
    }

    const passwordHash = await bcrypt.hash(String(password), 10);

    const result = await pool.query(
        `INSERT INTO app_user (username, password_hash, display_name, role)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (username) DO UPDATE
           SET password_hash = EXCLUDED.password_hash,
               display_name = EXCLUDED.display_name,
               role = EXCLUDED.role,
               is_active = TRUE,
               updated_at = CURRENT_TIMESTAMP
         RETURNING user_id, username, display_name, role`,
        [normalizedUsername, passwordHash, normalizedDisplayName, normalizedRole]
    );

    return result.rows[0];
}

export async function listAccounts() {
    const result = await pool.query(
        `SELECT user_id, username, display_name, role, is_active, last_login_at, created_at
         FROM app_user
         ORDER BY username`
    );

    return result.rows;
}

async function countOtherActiveAdmins(client, excludedUserId) {
    const result = await client.query(
        `SELECT COUNT(*)::int AS count
         FROM app_user
         WHERE role = 'admin' AND is_active = TRUE AND user_id != $1`,
        [excludedUserId]
    );

    return result.rows[0].count;
}

export async function setAccountActive(userId, isActive) {
    if (!isActive) {
        const remaining = await countOtherActiveAdmins(pool, userId);
        const target = await pool.query(`SELECT role FROM app_user WHERE user_id = $1`, [userId]);

        if (target.rows[0]?.role === "admin" && remaining === 0) {
            throw httpError(400, "ปิดใช้งานไม่ได้ เพราะเป็น Admin คนสุดท้ายที่ยัง active อยู่");
        }
    }

    const result = await pool.query(
        `UPDATE app_user
         SET is_active = $2, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $1
         RETURNING user_id, username, display_name, role, is_active`,
        [userId, Boolean(isActive)]
    );

    if (!result.rows[0]) {
        throw httpError(404, "ไม่พบบัญชีนี้");
    }

    return result.rows[0];
}

export async function updateAccountRole(userId, role) {
    const normalizedRole = String(role || "").trim();

    if (!VALID_ROLES.includes(normalizedRole)) {
        throw httpError(400, `role ต้องเป็นหนึ่งใน: ${VALID_ROLES.join(", ")}`);
    }

    if (normalizedRole !== "admin") {
        const current = await pool.query(`SELECT role, is_active FROM app_user WHERE user_id = $1`, [userId]);

        if (current.rows[0]?.role === "admin" && current.rows[0]?.is_active) {
            const remaining = await countOtherActiveAdmins(pool, userId);

            if (remaining === 0) {
                throw httpError(400, "เปลี่ยน role ไม่ได้ เพราะเป็น Admin คนสุดท้ายที่ยัง active อยู่");
            }
        }
    }

    const result = await pool.query(
        `UPDATE app_user
         SET role = $2, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $1
         RETURNING user_id, username, display_name, role, is_active`,
        [userId, normalizedRole]
    );

    if (!result.rows[0]) {
        throw httpError(404, "ไม่พบบัญชีนี้");
    }

    return result.rows[0];
}
