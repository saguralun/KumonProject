// Backs the admin-only Backup page (public/backup.html): list/create/
// download backups, and restore (import) one back into the live database.
// Deliberately reuses scripts/backup-database.ps1 for the "create a backup"
// step rather than re-implementing pg_dump invocation in JS — one source of
// truth for where backups land (BACKUP_DIR in .env, falling back to a
// project-local backups\ folder) and the 12-file retention, so a change to
// the script (e.g. the retention count) doesn't quietly drift out of sync
// with what this page does. See scripts/backup-database.ps1 for the details
// this mirrors when just reading its output back (resolveBackupDir).
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { httpError } from "./httpError.js";

const execFileAsync = promisify(execFile);
const PROJECT_DIR = process.cwd();
const BACKUP_SCRIPT = path.join(PROJECT_DIR, "scripts", "backup-database.ps1");

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function currentDbName() {
    const name = process.env.DB_NAME;

    if (!name) {
        throw httpError(500, "DB_NAME ไม่ได้ตั้งค่าไว้ใน .env");
    }

    return name;
}

// Same fallback as backup-database.ps1: BACKUP_DIR from .env if set,
// otherwise a project-local backups\ folder (not off-site, but still a
// real safety net on a machine that hasn't set up cloud sync yet).
function resolveBackupDir() {
    return process.env.BACKUP_DIR || path.join(PROJECT_DIR, "backups");
}

// Locates pg_dump.exe/pg_restore.exe the same way backup-database.ps1 does:
// an explicit *_PATH override in .env first, else search every installed
// PostgreSQL version's bin folder (newest first) on Windows. Non-Windows
// just assumes the binary is on PATH — this app's own tooling (schtasks,
// Program Files paths) is Windows-only anyway, but this keeps the module
// from hard-crashing on import on another platform.
function resolvePgBinary(name, envVarName) {
    const explicit = process.env[envVarName];

    if (explicit && fs.existsSync(explicit)) {
        return explicit;
    }

    if (process.platform !== "win32") {
        return name;
    }

    const pgRoot = "C:\\Program Files\\PostgreSQL";
    let versions = [];

    try {
        versions = fs.readdirSync(pgRoot, { withFileTypes: true })
            .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
            .map((entry) => entry.name)
            .sort((a, b) => Number(b) - Number(a));
    } catch {
        versions = [];
    }

    for (const version of versions) {
        const candidate = path.join(pgRoot, version, "bin", `${name}.exe`);

        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    throw httpError(
        500,
        `หา ${name}.exe ไม่เจอใต้ ${pgRoot}\\*\\bin\\ — ตั้ง ${envVarName} ใน .env ให้ชี้ path ตรงๆ ถ้าติดตั้ง PostgreSQL ไว้ที่อื่น`
    );
}

// Only ever matches files this same naming scheme could have produced
// (backup-database.ps1's `$DbName_$Timestamp.backup`) — anything else in
// the folder (the log file, unrelated files) is simply not listed, and
// resolveDownloadPath below only ever serves a path built from a filename
// that came out of this same list, never the raw request param directly.
export async function listBackups() {
    const dbName = currentDbName();
    const backupDir = resolveBackupDir();

    await fsp.mkdir(backupDir, { recursive: true });

    const pattern = new RegExp(`^${escapeRegExp(dbName)}_\\d{4}-\\d{2}-\\d{2}_\\d{6}\\.backup$`);
    const entries = await fsp.readdir(backupDir);
    const matches = entries.filter((entry) => pattern.test(entry));

    const backups = await Promise.all(
        matches.map(async (filename) => {
            const stat = await fsp.stat(path.join(backupDir, filename));

            return {
                filename,
                sizeBytes: stat.size,
                createdAt: stat.mtime.toISOString()
            };
        })
    );

    backups.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return { backups, backupDir, dbName };
}

export async function resolveDownloadPath(filename) {
    const { backups, backupDir } = await listBackups();
    const match = backups.find((backup) => backup.filename === filename);

    if (!match) {
        throw httpError(404, "ไม่พบไฟล์ backup นี้");
    }

    return path.join(backupDir, filename);
}

// Runs the exact same script the monthly Task Scheduler job runs. Returns
// the newest backup afterward (listBackups() is already sorted newest
// first) — that's the one this run just created.
export async function runBackupNow() {
    if (process.platform !== "win32") {
        throw httpError(500, "รองรับเฉพาะเครื่อง Windows เท่านั้น (ใช้ scripts/backup-database.ps1)");
    }

    if (!fs.existsSync(BACKUP_SCRIPT)) {
        throw httpError(500, `ไม่พบสคริปต์ backup ที่ ${BACKUP_SCRIPT}`);
    }

    try {
        await execFileAsync(
            "powershell.exe",
            ["-ExecutionPolicy", "Bypass", "-NoProfile", "-File", BACKUP_SCRIPT],
            { cwd: PROJECT_DIR, timeout: 5 * 60 * 1000 }
        );
    } catch (error) {
        throw httpError(500, `รัน backup ไม่สำเร็จ: ${String(error.stderr || error.message || error).trim()}`);
    }

    const { backups } = await listBackups();

    if (!backups.length) {
        throw httpError(500, "สคริปต์ backup รันจบแล้ว แต่หาไฟล์ผลลัพธ์ไม่เจอ");
    }

    return backups[0];
}

// Restores a `.backup` (pg_dump -Fc) buffer into the live database,
// replacing its current contents. Deliberately destructive — --clean
// --if-exists drops existing objects before recreating them from the
// uploaded file — so this is gated hard:
//   1. confirmDbName must match this machine's actual DB_NAME exactly
//      (the route requires admin already; this is a second, harder-to-
//      fat-finger check specifically against the one-shot "wipe the
//      database" action, mirrored by the same requirement in the UI).
//   2. A fresh safety backup of the CURRENT data is taken first, via the
//      same runBackupNow() as the Export side — if the uploaded file turns
//      out to be wrong (old, from another environment, corrupt), the admin
//      still has a way back. The import is refused outright if this step
//      itself fails, rather than proceeding without a safety net.
export async function importBackup(buffer, { confirmDbName } = {}) {
    const dbName = currentDbName();

    if (!buffer || !buffer.length) {
        throw httpError(400, "ไม่พบไฟล์ที่อัพโหลด");
    }

    if (confirmDbName !== dbName) {
        throw httpError(400, `ต้องพิมพ์ชื่อฐานข้อมูล "${dbName}" ให้ตรงเพื่อยืนยัน`);
    }

    let preImportBackup;

    try {
        preImportBackup = await runBackupNow();
    } catch (error) {
        throw httpError(
            500,
            `ยกเลิกการ import: สำรองข้อมูลปัจจุบันไว้ก่อน restore ไม่สำเร็จ (${error.message}) — ไม่ทำการ restore ต่อ เพื่อความปลอดภัย`
        );
    }

    const tempFile = path.join(os.tmpdir(), `kumondb-import-${Date.now()}.backup`);
    await fsp.writeFile(tempFile, buffer);

    try {
        const pgRestore = resolvePgBinary("pg_restore", "PG_RESTORE_PATH");
        const env = { ...process.env, PGPASSWORD: process.env.DB_PASSWORD || "" };

        await execFileAsync(
            pgRestore,
            [
                "-h", process.env.DB_HOST,
                "-p", String(process.env.DB_PORT || 5432),
                "-U", process.env.DB_USER,
                "-d", dbName,
                "--clean",
                "--if-exists",
                tempFile
            ],
            { env, timeout: 10 * 60 * 1000 }
        );
    } catch (error) {
        throw httpError(
            500,
            `Restore ไม่สำเร็จ: ${String(error.stderr || error.message || error).trim()} — ข้อมูลก่อน import ถูกสำรองไว้ที่ไฟล์ "${preImportBackup.filename}" แล้ว ถ้าต้องกู้กลับ`
        );
    } finally {
        await fsp.unlink(tempFile).catch(() => {});
    }

    return { preImportBackup };
}
