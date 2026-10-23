import pool from '../config/db.js';
import { prepareApplicationDatabase } from '../services/databaseUpgradeService.js';

try {
    if (process.argv[2] !== '--update') throw new Error('Use the confirmed program update or database preparation action');
    const result = await prepareApplicationDatabase();
    process.stdout.write(JSON.stringify(result) + '\n');
} catch (error) {
    process.stderr.write(`เตรียมฐานข้อมูลไม่สำเร็จ: ${error.message}\n`);
    process.exitCode = 1;
} finally { await pool.end(); }
