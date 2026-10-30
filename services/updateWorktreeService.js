import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify, isDeepStrictEqual } from 'node:util';
import { isIP } from 'node:net';

const execute = promisify(execFile);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const inside = (root, target) => { const relative = path.relative(root, target); return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative); };
const runtimeLog = /^logs\/(?:restart(?:-helper)?-\d+|(?:server|database)-\d{8}-\d{6}-\d{3}(?:-error)?)\.log$/;
const reportTemporary = /^logs\/database-upgrade-[a-f0-9-]{36}\.tmp$/;
const runtimePath = name => name === 'config/printer-lan-cache.json' || name === 'logs/database-upgrade-latest.json' || reportTemporary.test(name) || runtimeLog.test(name);

function recoveryError(message) { return Object.assign(new Error(message), { statusCode: 409 }); }
async function git(root, args) {
    const result = await execute('git', args, { cwd: root, encoding: 'buffer', windowsHide: true, timeout: 15000, maxBuffer: 32 * 1024 * 1024 });
    return result.stdout;
}

export function parseGitStatusZ(buffer) {
    const fields = buffer.toString('utf8').split('\0'), entries = [];
    for (let index = 0; index < fields.length; index++) {
        if (!fields[index]) continue;
        const record = fields[index];
        if (record.length < 4 || record[2] !== ' ') throw recoveryError('อ่านรายการไฟล์ค้างไม่สำเร็จ ยังไม่แก้ไขไฟล์');
        const entry = { status: record.slice(0, 2), path: record.slice(3) };
        if (/[RC]/.test(entry.status)) entry.previousPath = fields[++index];
        entries.push(entry);
    }
    return entries;
}

async function regularFile(root, name, limit = 16 * 1024 * 1024) {
    if (!name || name.includes('\\') || name.split('/').some(part => !part || part === '.' || part === '..') || name.split('/')[0].toLowerCase() === '.git') throw recoveryError(`ตำแหน่งไฟล์ไม่ปลอดภัย: ${name}`);
    const target = path.resolve(root, ...name.split('/'));
    if (!inside(root, target)) throw recoveryError(`ไฟล์อยู่นอกโครงการ: ${name}`);
    let current = root;
    for (const part of name.split('/')) {
        current = path.join(current, part);
        if ((await fs.lstat(current)).isSymbolicLink()) throw recoveryError(`ไม่จัดการไฟล์ลิงก์อัตโนมัติ: ${name}`);
    }
    const stat = await fs.lstat(target);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > limit) throw recoveryError(`ชนิดหรือขนาดไฟล์ต้องตรวจเองก่อน: ${name}`);
    return { target, bytes: await fs.readFile(target), stat };
}

function lockfileMetadataOnly(current, baseline) {
    try {
        const actual = JSON.parse(current), expected = JSON.parse(baseline);
        if (isDeepStrictEqual(actual, expected)) return true;
        if (!actual.packages || !expected.packages || ![2, 3].includes(actual.lockfileVersion) || ![2, 3].includes(expected.lockfileVersion)) return false;
        // v2's legacy dependency listing is redundant on supported npm versions; the complete packages graph must be identical.
        for (const object of [actual, expected]) { delete object.lockfileVersion; delete object.dependencies; }
        return isDeepStrictEqual(actual, expected);
    } catch { return false; }
}

function runtimeOutput(name, bytes) {
    if (runtimeLog.test(name)) return 'บันทึกการทำงานที่โปรแกรมสร้าง';
    try {
        const value = JSON.parse(bytes.toString('utf8'));
        if (name === 'config/printer-lan-cache.json' && value && Object.keys(value).every(key => ['host', 'savedAt'].includes(key))
            && isIP(value.host) && typeof value.savedAt === 'string' && Number.isFinite(Date.parse(value.savedAt))) return 'แคชค้นหาเครื่องพิมพ์';
        if ((name === 'logs/database-upgrade-latest.json' || reportTemporary.test(name))
            && value && typeof value.ready === 'boolean' && typeof value.applied === 'boolean'
            && typeof value.checkedAt === 'string' && Number.isFinite(Date.parse(value.checkedAt))
            && Object.keys(value).every(key => ['ready', 'applied', 'changes', 'backup', 'blockers', 'error', 'checkedAt', 'lastApplied', 'reportWarning'].includes(key))
            && (!value.changes || Array.isArray(value.changes)) && (!value.blockers || Array.isArray(value.blockers))) return 'รายงานตรวจโครงสร้างฐานข้อมูล';
    } catch { }
    return null;
}

async function inspect(root) {
    const canonical = await fs.realpath(root);
    const top = path.resolve((await git(canonical, ['rev-parse', '--show-toplevel'])).toString('utf8').trim());
    if (!samePath(canonical, await fs.realpath(top))) throw recoveryError('ตำแหน่งโครงการไม่ตรงกับ Git ยังไม่แก้ไขไฟล์');
    const head = (await git(canonical, ['rev-parse', 'HEAD'])).toString('utf8').trim();
    const status = await git(canonical, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
    const entries = parseGitStatusZ(status), allowed = [], blocked = [];
    for (const entry of entries) {
        let reason = 'ไม่ใช่ไฟล์สร้างอัตโนมัติที่ยืนยันได้';
        if (!['??', ' M'].includes(entry.status)) reason = 'มีการ stage ลบ ย้าย หรือเกิด conflict ต้องเก็บไว้ให้ตรวจ';
        else if (!runtimePath(entry.path) && entry.path !== 'package-lock.json') { blocked.push({ ...entry, reason }); continue; }
        else {
            try {
                const file = await regularFile(canonical, entry.path);
                let baseline;
                if (entry.status === ' M') {
                    const tree = (await git(canonical, ['ls-tree', head, '--', entry.path])).toString('utf8');
                    if (!/^100(?:644|755) blob /.test(tree)) throw recoveryError('ไฟล์ต้นฉบับไม่ใช่ไฟล์ปกติ');
                    baseline = await git(canonical, ['show', `${head}:${entry.path}`]);
                }
                const generated = runtimeOutput(entry.path, file.bytes);
                const lock = entry.path === 'package-lock.json' && baseline && lockfileMetadataOnly(file.bytes, baseline);
                if (generated || lock) {
                    allowed.push({ ...entry, ...file, baseline, reason: generated || 'รูปแบบหรือข้อมูลประกอบของ npm โดยชุด dependency ไม่เปลี่ยน', sha256: digest(file.bytes) });
                    continue;
                }
                if (entry.path === 'package-lock.json') reason = 'dependency เปลี่ยนหรือยังยืนยันไม่ได้ว่าเป็นเพียงรูปแบบ ห้ามทับอัตโนมัติ';
            } catch (error) { reason = error.message; }
        }
        blocked.push({ ...entry, reason });
    }
    return { root: canonical, head, status, allowed, blocked };
}

export async function inspectUpdateWorktree({ repoDir = process.cwd() } = {}) {
    const result = await inspect(repoDir);
    return { head: result.head, files: result.allowed.map(({ path, status, reason }) => ({ path, status, reason })), blocked: result.blocked };
}

async function writeVerified(filename, bytes) {
    const file = await fs.open(filename, 'wx', 0o600);
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    if (digest(await fs.readFile(filename)) !== digest(bytes)) throw recoveryError('ตรวจไฟล์สำรองไม่ผ่าน ยังไม่แก้ไขไฟล์ค้าง');
}

async function excludeFile(root) {
    const common = path.resolve(root, (await git(root, ['rev-parse', '--git-common-dir'])).toString('utf8').trim());
    const filename = path.resolve(root, (await git(root, ['rev-parse', '--git-path', 'info/exclude'])).toString('utf8').trim());
    if (!samePath(filename, path.join(common, 'info', 'exclude'))) throw recoveryError('ตำแหน่ง Git exclude ไม่ตรง ยังไม่แก้ไขไฟล์');
    for (const location of [common, path.dirname(filename), filename]) {
        try {
            const stat = await fs.lstat(location);
            if (stat.isSymbolicLink() || location === filename && (!stat.isFile() || stat.nlink !== 1)) throw recoveryError('Git exclude ไม่ใช่ไฟล์ปกติ ไม่แก้ไขอัตโนมัติ');
        }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const bytes = await fs.readFile(filename).catch(error => { if (error.code === 'ENOENT') return Buffer.alloc(0); throw error; });
    return { filename, bytes };
}

export async function prepareUpdateWorktree({ repoDir = process.cwd(), backupBase } = {}) {
    const snapshot = await inspect(repoDir);
    if (snapshot.blocked.length) throw recoveryError(`ยังไม่แก้ทับไฟล์ต่อไปนี้ เพราะยืนยันไม่ได้ว่าโปรแกรมสร้างเอง:\n${snapshot.blocked.slice(0, 30).map(entry => `- ${entry.path}: ${entry.reason}`).join('\n')}${snapshot.blocked.length > 30 ? '\nและไฟล์อื่นอีก' : ''}\nไฟล์เดิมยังอยู่ครบ`);
    if (!snapshot.allowed.length) return { files: [], backupDirectory: null };
    const base = path.resolve(backupBase || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), 'KumonDB', 'update-file-backups'));
    if (samePath(base, snapshot.root) || inside(snapshot.root, base)) throw recoveryError('ต้องเก็บสำรองไฟล์ไว้นอกโครงการ เพื่อไม่ให้ติดค้างใน Git อีก');
    await fs.mkdir(base, { recursive: true, mode: 0o700 });
    const realBase = await fs.realpath(base);
    if (samePath(snapshot.root, realBase) || inside(snapshot.root, realBase)) throw recoveryError('ตำแหน่งสำรองชี้กลับเข้าโครงการ ยังไม่แก้ไขไฟล์');
    const archive = path.join(base, `${Date.now()}-${randomUUID()}`);
    await fs.mkdir(archive, { mode: 0o700 });
    const exclude = await excludeFile(snapshot.root);
    const manifest = { version: 1, createdAt: new Date().toISOString(), project: snapshot.root, head: snapshot.head,
        files: snapshot.allowed.map((entry, index) => ({ path: entry.path, status: entry.status, reason: entry.reason, sha256: entry.sha256,
            size: entry.bytes.length, mode: entry.stat.mode, archiveFile: `${index}.bin`, action: entry.baseline ? 'restore-generated-file' : 'preserve-and-ignore-generated-file' })) };
    // Every original and the previous ignore rules must be durable and verified before any worktree change.
    for (let index = 0; index < snapshot.allowed.length; index++) await writeVerified(path.join(archive, `${index}.bin`), snapshot.allowed[index].bytes);
    await writeVerified(path.join(archive, 'git-exclude.before'), exclude.bytes);
    await writeVerified(path.join(archive, 'manifest.json'), Buffer.from(JSON.stringify(manifest, null, 2)));
    try {
        const currentHead = (await git(snapshot.root, ['rev-parse', 'HEAD'])).toString('utf8').trim();
        const currentStatus = await git(snapshot.root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
        if (currentHead !== snapshot.head || !currentStatus.equals(snapshot.status)) throw recoveryError('รายการไฟล์หรือรุ่นเปลี่ยนระหว่างสำรอง หยุดโดยไม่ทับไฟล์');
        for (const entry of snapshot.allowed.filter(item => item.baseline)) {
            if (digest((await regularFile(snapshot.root, entry.path)).bytes) !== entry.sha256) throw recoveryError(`ไฟล์เปลี่ยนระหว่างสำรอง จึงไม่ทับ: ${entry.path}`);
            await git(snapshot.root, ['restore', `--source=${snapshot.head}`, '--worktree', '--', entry.path]);
        }
        const preserved = snapshot.allowed.filter(item => !item.baseline);
        if (preserved.length) {
            const current = await fs.readFile(exclude.filename).catch(error => { if (error.code === 'ENOENT') return Buffer.alloc(0); throw error; });
            if (!current.equals(exclude.bytes)) throw recoveryError('Git exclude เปลี่ยนระหว่างสำรอง จึงไม่เขียนทับ');
            await fs.mkdir(path.dirname(exclude.filename), { recursive: true });
            // These paths are allowlisted ASCII runtime names, not arbitrary ignore patterns or source directories.
            const lines = preserved.map(entry => `/${entry.path}`).join('\n');
            await fs.appendFile(exclude.filename, `\n# KumonDB verified generated files; originals backed up at ${archive.replaceAll('\\', '/')}\n${lines}\n`);
        }
        const after = await git(snapshot.root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
        if (after.length) throw recoveryError(`ยังมีไฟล์เปลี่ยนระหว่างอัปเดต:\n${parseGitStatusZ(after).map(entry => entry.path).join('\n')}`);
        return { files: manifest.files.map(({ path, reason, action }) => ({ path, reason, action })), backupDirectory: archive };
    } catch (error) {
        throw recoveryError(`${error.message}\nสำรองไฟล์เดิมไว้ที่ ${archive}`);
    }
}
