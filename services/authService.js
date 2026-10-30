import bcrypt from "bcryptjs";
import pool from "../config/db.js";
import { httpError } from "./httpError.js";

const GUEST_PIN = process.env.GUEST_PIN || "";

// Any role_master row is a valid account role EXCEPT "guest" — guest isn't
// a DB account at all (shared PIN + free-text display name, see
// verifyGuestLogin), so it can never be assigned to a real app_user row.
async function assertAssignableRole(roleCode, client) {
    if (roleCode === "guest") {
        throw httpError(400, `role "guest" กำหนดให้บัญชีจริงไม่ได้ (guest ล็อกอินด้วย PIN ไม่ใช่บัญชี)`);
    }

    const result = await client.query(`SELECT 1 FROM role_master WHERE role_code = $1`, [roleCode]);

    if (!result.rows[0]) {
        throw httpError(400, `ไม่พบ role "${roleCode}" — เพิ่ม role นี้ในหน้า Users ก่อน`);
    }
}

async function withAccountWrite(action) {
    const client = await pool.connect();
    let transaction = false, releaseError;
    try {
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        transaction = true;
        // All account mutation paths share this lock, including CLI upserts.
        // Count/check/write must see the preceding writer's committed admins.
        await client.query('LOCK TABLE app_user IN SHARE ROW EXCLUSIVE MODE');
        const result = await action(client);
        await client.query('COMMIT');
        transaction = false;
        return result;
    } catch (error) {
        if (transaction) {
            try { await client.query('ROLLBACK'); }
            catch (rollbackError) { releaseError = rollbackError; }
        }
        throw error;
    } finally {
        client.release(releaseError);
    }
}

function sanitizeAccount(row) {
    return {
        role: row.role,
        userId: row.user_id,
        username: row.username,
        displayName: row.display_name
    };
}

export async function getActiveSessionAccount(userId) {
    if (!Number.isSafeInteger(Number(userId)) || Number(userId) < 1) return null;
    const result = await pool.query(`SELECT user_id, username, display_name, role
        FROM app_user WHERE user_id = $1 AND is_active = TRUE`, [Number(userId)]);
    return result.rows[0] ? sanitizeAccount(result.rows[0]) : null;
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

// role: any role_master code except "guest" — see assertAssignableRole.
export async function upsertAccount({ username, password, displayName, role = "admin" }) {
    const normalizedUsername = String(username || "").trim();
    const normalizedDisplayName = String(displayName || normalizedUsername).trim();
    const normalizedRole = String(role || "admin").trim();

    if (!normalizedUsername || !password) {
        throw httpError(400, "username และ password ห้ามว่าง");
    }

    // Hash before taking the account lock; bcrypt need not block other writes.
    const passwordHash = await bcrypt.hash(String(password), 10);
    return withAccountWrite(async client => {
        await assertAssignableRole(normalizedRole, client);
        if (normalizedRole !== "admin") {
            const existing = await client.query(
                `SELECT user_id, role, is_active FROM app_user WHERE username = $1`,
                [normalizedUsername]
            );

            if (existing.rows[0]?.role === "admin" && existing.rows[0]?.is_active) {
                const remaining = await countOtherActiveAdmins(client, existing.rows[0].user_id);

                if (remaining === 0) {
                    throw httpError(400, "เปลี่ยน role ไม่ได้ เพราะเป็น Admin คนสุดท้ายที่ยัง active อยู่");
                }
            }
        }

        const result = await client.query(
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
    });
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
    return withAccountWrite(async client => {
        if (!isActive) {
            const target = await client.query(`SELECT role, is_active FROM app_user WHERE user_id = $1`, [userId]);

            if (target.rows[0]?.role === "admin" && target.rows[0]?.is_active && await countOtherActiveAdmins(client, userId) === 0) {
                throw httpError(400, "ปิดใช้งานไม่ได้ เพราะเป็น Admin คนสุดท้ายที่ยัง active อยู่");
            }
        }

        const result = await client.query(
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
    });
}

export async function updateAccountRole(userId, role) {
    const normalizedRole = String(role || "").trim();

    return withAccountWrite(async client => {
        await assertAssignableRole(normalizedRole, client);

        if (normalizedRole !== "admin") {
            const current = await client.query(`SELECT role, is_active FROM app_user WHERE user_id = $1`, [userId]);

            if (current.rows[0]?.role === "admin" && current.rows[0]?.is_active) {
                const remaining = await countOtherActiveAdmins(client, userId);

                if (remaining === 0) {
                    throw httpError(400, "เปลี่ยน role ไม่ได้ เพราะเป็น Admin คนสุดท้ายที่ยัง active อยู่");
                }
            }
        }

        const result = await client.query(
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
    });
}
