import { execFile } from "child_process";
import { promisify } from "util";
import { httpError } from "./httpError.js";

const execFileAsync = promisify(execFile);
const REPO_DIR = process.cwd();
const GITHUB_REPO = "saguralun/KumonProject";
const GITHUB_BRANCH = "main";

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
    const { stdout: branchOut } = await runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
    const branch = branchOut.trim();

    if (branch !== GITHUB_BRANCH) {
        throw httpError(409, `ตอนนี้เครื่องนี้อยู่ branch '${branch}' ไม่ใช่ ${GITHUB_BRANCH} — อัพเดทอัตโนมัติไม่ได้`);
    }

    const { stdout: statusOut } = await runGit(["status", "--porcelain"]);

    if (statusOut.trim()) {
        throw httpError(409, "มีไฟล์ที่แก้ไขในเครื่องนี้ค้างอยู่ ยังไม่ได้ commit — อัพเดทอัตโนมัติไม่ได้ (กันของที่แก้ไว้หาย)");
    }

    try {
        const { stdout: pullOut } = await runGit(["pull", "origin", GITHUB_BRANCH, "--ff-only"]);
        const { stdout: newHead } = await runGit(["rev-parse", "HEAD"]);

        return {
            success: true,
            output: pullOut.trim(),
            newCommit: newHead.trim().slice(0, 7)
        };
    } catch (error) {
        throw httpError(500, `git pull ไม่สำเร็จ: ${error.message}`);
    }
}
