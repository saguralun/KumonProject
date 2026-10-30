import { execFile, spawn } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs/promises";
import { openSync, closeSync } from "fs";
import { randomUUID } from "crypto";
import { httpError } from "./httpError.js";
import { prepareUpdateWorktree } from './updateWorktreeService.js';

const execFileAsync = promisify(execFile);
const REPO_DIR = process.cwd();
const GITHUB_REPO = "saguralun/KumonProject";
const GITHUB_BRANCH = "main";
const INSTANCE_ID = randomUUID();
let updateInProgress = false;
let updateCheckPending;
let updateCheckCache;
let updateCheckExpires = 0;
let updateNeedsRetry = false;

export function getRuntimeStatus() {
    return { instanceId: INSTANCE_ID, processId: process.pid };
}

export async function scheduleAppRestart() {
    const restartPath = path.join(REPO_DIR, "launcher", "restart-hidden.vbs");
    const statusPath = path.join(REPO_DIR, "logs", `restart-${process.pid}.log`);
    await fs.mkdir(path.dirname(statusPath), { recursive: true });
    await fs.rm(statusPath, { force: true });
    const outputFd = openSync(path.join(REPO_DIR, "logs", `restart-helper-${process.pid}.log`), "a");
    let child;
    try {
        child = spawn(
            "wscript.exe",
            ["//B", "//Nologo", restartPath, String(process.pid), REPO_DIR,
                process.execPath, String(Number(process.env.PORT) || 3000), statusPath],
            {
                cwd: REPO_DIR,
                detached: true,
                stdio: ["ignore", outputFd, outputFd],
                windowsHide: true
            }
        );
        await new Promise((resolve, reject) => {
            child.once("spawn", resolve);
            child.once("error", reject);
        });
    } finally {
        closeSync(outputFd);
    }
    child.unref();
    // Confirm that PowerShell actually entered the helper before reporting a restart.
    for (let attempt = 0; attempt < 100; attempt++) {
        const status = await fs.readFile(statusPath, "utf8").catch(() => "");
        if (status.includes("ERROR")) throw httpError(500, "เริ่มตัว restart ไม่สำเร็จ ตรวจ logs/restart-*.log");
        if (status.includes("READY")) return;
        if (child.exitCode !== null && child.exitCode !== 0) throw httpError(500, `ตัว restart หยุดทำงาน (exit ${child.exitCode}) ตรวจ logs/restart-helper-*.log`);
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw httpError(500, "อัพเดทโค้ดแล้ว แต่ตัว restart ไม่ตอบรับ กรุณาเปิดผ่าน start-kumondb.bat ใหม่ และตรวจ logs/restart-*.log");
}

async function runGit(args) {
    return execFileAsync("git", args, { cwd: REPO_DIR, timeout: 15000 });
}

// Reads the remote's latest commit straight from the GitHub API instead of
// `git fetch` — the repo is public, so this needs no credentials, and it
// doesn't touch local git state (a background version check shouldn't be
// mutating anything).
export async function checkForUpdate() {
    if (!(updateCheckCache && Date.now() < updateCheckExpires) && !updateCheckPending) {
        // All open pages share one short-lived result, avoiding GitHub rate limits.
        updateCheckPending = readRemoteVersion().then((result) => {
            updateCheckCache = result;
            updateCheckExpires = Date.now() + 60000;
            return result;
        }).finally(() => { updateCheckPending = null; });
    }
    const result = updateCheckPending ? await updateCheckPending : updateCheckCache;
    const report = await fs.readFile(path.join(REPO_DIR, 'logs', 'database-upgrade-latest.json'), 'utf8')
        .then(JSON.parse).catch(() => null);
    const preparationRequired = updateNeedsRetry || report?.ready === false;
    return { ...result, upToDate: result.checked && preparationRequired ? false : result.upToDate, preparationRequired };
}

async function readRemoteVersion() {
    try {
        const [{ stdout: localHead }, { stdout: localMessage }] = await Promise.all([
            runGit(["rev-parse", "HEAD"]),
            runGit(["log", "-1", "--pretty=%s"])
        ]);
        const localCommit = localHead.trim();

        const response = await fetch(
            `https://api.github.com/repos/${GITHUB_REPO}/commits/${GITHUB_BRANCH}`,
            { headers: { "User-Agent": "KumonDB-update-check", Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(10000) }
        );

        if (!response.ok) {
            throw new Error(`GitHub ตอบกลับ ${response.status}`);
        }

        const data = await response.json();
        const remoteCommit = String(data.sha || "");
        if (!/^[a-f0-9]{40}$/i.test(remoteCommit)) throw new Error('อ่านเวอร์ชันล่าสุดไม่สำเร็จ');
        const remoteMessage = String(data.commit?.message || "").split("\n")[0];

        return {
            checked: true,
            upToDate: Boolean(remoteCommit) && localCommit === remoteCommit,
            localCommit: localCommit.slice(0, 7),
            localMessage: localMessage.trim(),
            remoteCommit: remoteCommit.slice(0, 7),
            remoteMessage
        };
    } catch (error) {
        // Never blocks the login page over this — no internet, GitHub down,
        // not a git checkout at all, whatever. Just can't say either way.
        return {
            checked: false,
            upToDate: null,
            detail: error.message
        };
    }
}

export async function applyUpdate() {
    if (updateInProgress) throw httpError(409, "กำลังอัพเดทหรือ restart อยู่ กรุณารอให้โปรแกรมเปิดกลับมา");
    updateInProgress = true;
    const context = {};
    try {
        return await performUpdate(context);
    } catch (error) {
        updateInProgress = false;
        if (context.fileRecovery?.backupDirectory) error.message += `\nสำรองไฟล์สร้างอัตโนมัติไว้ที่ ${context.fileRecovery.backupDirectory}`;
        throw error;
    }
}

async function performUpdate(context) {
    const { stdout: branchOut } = await runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
    const branch = branchOut.trim();

    if (branch !== GITHUB_BRANCH) {
        throw httpError(409, `ตอนนี้เครื่องนี้อยู่ branch '${branch}' ไม่ใช่ ${GITHUB_BRANCH} — อัพเดทอัตโนมัติไม่ได้`);
    }

    context.fileRecovery = await prepareUpdateWorktree({ repoDir: REPO_DIR });

    let pullOut;

    try {
        ({ stdout: pullOut } = await runGit(["pull", "origin", GITHUB_BRANCH, "--ff-only"]));
        updateNeedsRetry = true;
    } catch (error) {
        throw httpError(500, `git pull ไม่สำเร็จ: ${error.message}`);
    }

    // git pull only ever brings in new CODE — it does nothing about
    // package.json gaining a new dependency. `npm install` here closes that
    // gap so a pulled commit always leaves node_modules in a state the new
    // code can actually run in on every machine that uses this button.
    // shell: true: on Windows npm is npm.cmd, a batch script, not a real
    // .exe — confirmed directly that execFile can't spawn it at all
    // without a shell (plain "npm" -> ENOENT, "npm.cmd" -> EINVAL; only
    // shell: true actually runs it here). Node's deprecation warning
    // about this option is about unescaped ARGUMENTS being unsafe with
    // untrusted input; install and --no-save are fixed literals, never derived from
    // anything a caller of applyUpdate() controls.
    // --no-save keeps this deployment step from editing the versioned lockfile.
    try {
        await execFileAsync("npm", ["install", "--no-save"], { cwd: REPO_DIR, timeout: 120000, shell: true, windowsHide: true });
    } catch (error) {
        throw httpError(
            500,
            `git pull สำเร็จ (${pullOut.trim()}) แต่ npm install ไม่สำเร็จ: ${error.message} — โค้ดใหม่ถูกดึงมาแล้วแต่ dependency อาจไม่ครบ ลองรัน "npm install" ที่เครื่องนี้เอง`
        );
    }

    // Use the newly pulled code, not modules cached by the old running server.
    let database;
    try {
        const prepared = await execFileAsync(process.execPath, ['scripts/prepare-database.js', '--update'],
            { cwd: REPO_DIR, timeout: 10 * 60 * 1000, windowsHide: true });
        database = JSON.parse(prepared.stdout.trim().split(/\r?\n/).at(-1));
        if (!database.ready) throw new Error('ฐานข้อมูลยังไม่พร้อม');
    } catch (error) {
        throw httpError(500, `ดึงโค้ดแล้ว แต่เตรียมฐานข้อมูลไม่ผ่าน ยังไม่รีสตาร์ต: ${String(error.stderr || error.message).trim()}`);
    }
    const { stdout: newHead } = await runGit(["rev-parse", "HEAD"]);
    await scheduleAppRestart();

    return {
        success: true,
        output: pullOut.trim(),
        newCommit: newHead.trim().slice(0, 7),
        database,
        fileRecovery: context.fileRecovery,
        restartRequired: true,
        restartScheduled: true,
        previousInstanceId: INSTANCE_ID,
        message: "อัพเดทสำเร็จแล้ว โปรแกรมจะ restart อัตโนมัติในอีกสักครู่"
    };
}
