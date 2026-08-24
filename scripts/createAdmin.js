// Create (or reset the password/role of) an admin or staff account.
//
// Usage:
//   node scripts/createAdmin.js <username> <password> [displayName] [role]
//
// role is "admin" (default; full access including Table Explorer and
// migration tools) or "staff" (everything else an admin can do, but not
// those two). Re-running with the same username updates its password/
// display name/role instead of erroring (see the ON CONFLICT clause in
// upsertAccount).

import "dotenv/config";
import { upsertAccount } from "../services/authService.js";
import pool from "../config/db.js";

async function main() {
    const [, , username, password, displayName, role] = process.argv;

    if (!username || !password) {
        console.error("Usage: node scripts/createAdmin.js <username> <password> [displayName] [role=admin|staff]");
        process.exitCode = 1;
        return;
    }

    if (password.length < 6) {
        console.error("Password should be at least 6 characters.");
        process.exitCode = 1;
        return;
    }

    const user = await upsertAccount({ username, password, displayName, role });
    console.log(`✅ Account ready: ${user.username} (${user.display_name}) — role: ${user.role}`);
}

main()
    .catch((error) => {
        console.error("Failed to create account:", error.message || error);
        process.exitCode = 1;
    })
    .finally(() => {
        pool.end();
    });
