import { execFile, spawn } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs/promises";
import { openSync, closeSync } from "fs";
import { randomUUID } from "crypto";
import { httpError } from "./httpError.js";
import { preparePaymentDatabase } from './databaseUpgradeService.js';

const execFileAsync = promisify(execFile);
const REPO_DIR = process.cwd();
const GITHUB_REPO = "saguralun/KumonProject";
const GITHUB_BRANCH = "main";
const INSTANCE_ID = randomUUID();
let updateInProgress = false;

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
    try {
        const [{ stdout: localHead }, { stdout: localMessage }] = await Promise.all([
            runGit(["rev-parse", "HEAD"]),
            runGit(["log", "-1", "--pretty=%s"])
        ]);
        const localCommit = localHead.trim();

        const response = await fetch(
            `https://api.github.com/repos/${GITHUB_REPO}/commits/${GITHUB_BRANCH}`,
            { headers: { "User-Agent": "KumonDB-update-check", Accept: "application/vnd.github+json" } }
        );

        if (!response.ok) {
            throw new Error(`GitHub ตอบกลับ ${response.status}`);
        }

        const data = await response.json();
        const remoteCommit = String(data.sha || "");
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
    try {
        return await performUpdate();
    } catch (error) {
        updateInProgress = false;
        throw error;
    }
}

async function performUpdate() {
    const { stdout: branchOut } = await runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
    const branch = branchOut.trim();

    if (branch !== GITHUB_BRANCH) {
        throw httpError(409, `ตอนนี้เครื่องนี้อยู่ branch '${branch}' ไม่ใช่ ${GITHUB_BRANCH} — อัพเดทอัตโนมัติไม่ได้`);
    }

    const { stdout: statusOut } = await runGit(["status", "--porcelain"]);

    if (statusOut.trim()) {
        throw httpError(409, "มีไฟล์ที่แก้ไขในเครื่องนี้ค้างอยู่ ยังไม่ได้ commit — อัพเดทอัตโนมัติไม่ได้ (กันของที่แก้ไว้หาย)");
    }

    let pullOut;

    try {
        ({ stdout: pullOut } = await runGit(["pull", "origin", GITHUB_BRANCH, "--ff-only"]));
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
    // untrusted input; ["install"] is a fixed literal, never derived from
    // anything a caller of applyUpdate() controls.
    try {
        await execFileAsync("npm", ["install"], { cwd: REPO_DIR, timeout: 120000, shell: true });
    } catch (error) {
        throw httpError(
            500,
            `git pull สำเร็จ (${pullOut.trim()}) แต่ npm install ไม่สำเร็จ: ${error.message} — โค้ดใหม่ถูกดึงมาแล้วแต่ dependency อาจไม่ครบ ลองรัน "npm install" ที่เครื่องนี้เอง`
        );
    }

    await preparePaymentDatabase();
    const { stdout: newHead } = await runGit(["rev-parse", "HEAD"]);
    await scheduleAppRestart();

    return {
        success: true,
        output: pullOut.trim(),
        newCommit: newHead.trim().slice(0, 7),
        restartRequired: true,
        restartScheduled: true,
        previousInstanceId: INSTANCE_ID,
        message: "อัพเดทสำเร็จแล้ว โปรแกรมจะ restart อัตโนมัติในอีกสักครู่"
    };
}
