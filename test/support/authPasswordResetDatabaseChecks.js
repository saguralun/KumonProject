import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { upsertAccount, resetAccountPassword, verifyAccountLogin, verifyAccountSessionLogin } from '../../services/authService.js';
import { refreshAccountSessionData } from '../../services/accountSession.js';

// Call only inside isolatedDatabase.integration.test.js AFTER its verified
// disposable pool is installed as the productionPool query/connect boundary.
// This helper uses that fixture's existing schema and creates synthetic rows only.
export async function assertPasswordResetDatabaseSafety(database) {
    // Username plus the '-target' suffix must fit the existing varchar(50).
    const prefix = `reset-${randomUUID()}`;
    const ids = [], sids = [];
    const saveSession = async (sid, data) => {
        sids.push(sid);
        await database.query(`INSERT INTO session (sid, sess, expire)
            VALUES ($1, $2::json, CURRENT_TIMESTAMP + INTERVAL '1 hour')
            ON CONFLICT (sid) DO UPDATE SET sess = EXCLUDED.sess`, [sid, JSON.stringify(data)]);
    };
    const credentials = username => ({ username, password: 'synthetic-before', role: 'admin' });
    try {
        const target = await upsertAccount(credentials(`${prefix}-target`)); ids.push(target.user_id);
        const other = await upsertAccount(credentials(`${prefix}-other`)); ids.push(other.user_id);
        const signedIn = await verifyAccountSessionLogin(credentials(target.username));
        const old = { user: signedIn.user, accountCredentialVersion: signedIn.credentialVersion };
        const legacy = { user: signedIn.user };
        const otherLogin = await verifyAccountSessionLogin(credentials(other.username));
        const unaffected = { user: otherLogin.user, accountCredentialVersion: otherLogin.credentialVersion };
        await saveSession(`${prefix}-machine-a`, old);
        await saveSession(`${prefix}-machine-b`, legacy);
        await saveSession(`${prefix}-other-session`, unaffected);
        assert.equal((await refreshAccountSessionData(`${prefix}-machine-b`, structuredClone(legacy))).userId, target.user_id);
        await resetAccountPassword(target.user_id, 'synthetic-after');
        assert.equal((await database.query(`SELECT COUNT(*)::int AS n FROM session
            WHERE sess->'user'->>'userId' = $1`, [String(target.user_id)])).rows[0].n, 0);
        assert.equal(await refreshAccountSessionData(`${prefix}-machine-b`, structuredClone(legacy)), null);
        assert.equal((await refreshAccountSessionData(`${prefix}-other-session`, structuredClone(unaffected))).userId, other.user_id);
        await assert.rejects(verifyAccountLogin(credentials(target.username)), { statusCode: 401 });
        const fresh = await verifyAccountSessionLogin({ username: target.username, password: 'synthetic-after' });
        const current = { user: fresh.user, accountCredentialVersion: fresh.credentialVersion };
        await saveSession(`${prefix}-new-login`, current);
        assert.equal((await refreshAccountSessionData(`${prefix}-new-login`, current)).userId, target.user_id);
        // Model a response that had already authenticated and UPSERTs its old
        // session after reset. The persisted credential marker must still fail.
        await saveSession(`${prefix}-machine-a`, old);
        assert.equal(await refreshAccountSessionData(`${prefix}-machine-a`, structuredClone(old)), null);
    } finally {
        await database.query('DELETE FROM session WHERE sid = ANY($1::text[])', [sids]);
        await database.query('DELETE FROM app_user WHERE user_id = ANY($1::integer[])', [ids]);
    }
}
