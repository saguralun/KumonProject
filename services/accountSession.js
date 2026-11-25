import { createHash } from 'node:crypto';
import pool from '../config/db.js';

// Keep the password hash and this server-side credential marker out of user JSON.
export function accountCredentialVersion(passwordHash) {
    return createHash('sha256').update(passwordHash).digest('hex');
}

export async function refreshAccountSessionData(sessionId, session) {
    const userId = Number(session.user.userId);
    if (!Number.isSafeInteger(userId) || userId < 1) return null;
    const result = await pool.query(`SELECT user_id, username, display_name, role, password_hash,
        EXISTS (SELECT 1 FROM "session" WHERE sid = $2
            AND sess->'user'->>'userId' = $3) AS stored_session_exists
        FROM app_user WHERE user_id = $1 AND is_active = TRUE`, [userId, sessionId, String(userId)]);
    const row = result.rows[0];
    if (!row) return null;
    const version = accountCredentialVersion(row.password_hash);
    if (session.accountCredentialVersion === undefined) {
        // Upgrade pre-existing sessions only while their persisted row still exists.
        // The account and session are read in one database snapshot, so a reset
        // cannot bind an old cookie to the new password's credential marker.
        if (!row.stored_session_exists) return null;
    } else if (session.accountCredentialVersion !== version) {
        // A concurrent response may save a deleted session again. Its old marker
        // still fails here, even if the cookie and persisted session survive.
        return null;
    }
    session.accountCredentialVersion = version;
    return { role: row.role, userId: row.user_id, username: row.username, displayName: row.display_name };
}
