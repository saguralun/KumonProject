import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { prepareUpdateWorktree, inspectUpdateWorktree, parseGitStatusZ } from '../services/updateWorktreeService.js';

const execute = promisify(execFile);
const report = () => JSON.stringify({ ready: false, applied: false, checkedAt: new Date().toISOString(), blockers: ['fixture'], error: 'fixture pending upgrade' });
const lock = () => ({ name: 'kumondb', version: '1.0.0', lockfileVersion: 3, requires: true,
    packages: { '': { name: 'kumondb', version: '1.0.0', dependencies: { fixture: '1.0.0' } }, 'node_modules/fixture': { version: '1.0.0', integrity: 'sha512-fixture', resolved: 'https://fixture.invalid/fixture.tgz' } } });

async function fixture(t, { trackedReport = false, noDependencies = false } = {}) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kumondb-update-files-'));
    const repoDir = path.join(root, "project's files"), backupBase = path.join(root, 'private-archives');
    await fs.mkdir(repoDir);
    const git = async (...args) => (await execute('git', args, { cwd: repoDir, windowsHide: true })).stdout;
    await git('init', '--initial-branch=main'); await git('config','core.autocrlf','false');
    await fs.writeFile(path.join(repoDir, '.gitignore'), '*.log\nnode_modules/\n');
    await fs.writeFile(path.join(repoDir, 'server.js'), '// Original source\n');
    await fs.writeFile(path.join(repoDir, 'package.json'), JSON.stringify({ name: 'kumondb', version: '1.0.0' }));
    const baseline = lock(); if (noDependencies) { delete baseline.packages[''].dependencies; delete baseline.packages['node_modules/fixture']; }
    await fs.writeFile(path.join(repoDir, 'package-lock.json'), JSON.stringify(baseline));
    if (trackedReport) { await fs.mkdir(path.join(repoDir, 'logs')); await fs.writeFile(path.join(repoDir, 'logs/database-upgrade-latest.json'), report()); }
    await git('add','.'); await git('-c','user.name=Fixture','-c','user.email=fixture@invalid','commit','-qm','Fixture baseline');
    t.after(async () => {
        assert.ok(path.resolve(root).startsWith(`${path.resolve(os.tmpdir())}${path.sep}kumondb-update-files-`));
        await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    });
    return { root, repoDir, backupBase, git, options: { repoDir, backupBase },
        write: (name, contents) => fs.writeFile(path.join(repoDir, name), contents),
        read: name => fs.readFile(path.join(repoDir, name), 'utf8') };
}

test('NUL status parsing preserves spaces, Unicode and rename pairs rather than splitting filenames', () => {
    const entries = parseGitStatusZ(Buffer.from(' M package-lock.json\0?? logs/database-upgrade-latest.json\0R  new name.js\0old name.js\0?? เด็ก ทดสอบ.csv\0'));
    assert.equal(entries.length, 4); assert.equal(entries[2].previousPath, 'old name.js'); assert.equal(entries[3].path, 'เด็ก ทดสอบ.csv');
});

test('An unchanged worktree creates no archive and writes no ignore rules', async t => {
    const f = await fixture(t), before = await f.git('status','--porcelain');
    assert.deepEqual(await prepareUpdateWorktree(f.options), { files: [], backupDirectory: null });
    assert.equal(await f.git('status','--porcelain'), before); await assert.rejects(fs.access(f.backupBase));
});

test('Generated DB reports are backed up, retained in place and locally ignored so an old updater can continue', async t => {
    const f = await fixture(t); await fs.mkdir(path.join(f.repoDir, 'logs'));
    const contents = report(); await f.write('logs/database-upgrade-latest.json', contents);
    const inspection = await inspectUpdateWorktree(f.options); assert.equal(inspection.files.length, 1); assert.deepEqual(inspection.blocked, []);
    const result = await prepareUpdateWorktree(f.options);
    assert.equal(await f.read('logs/database-upgrade-latest.json'), contents);
    assert.equal(await f.git('status','--porcelain'), '');
    const manifest = JSON.parse(await fs.readFile(path.join(result.backupDirectory, 'manifest.json'), 'utf8'));
    assert.equal(await fs.readFile(path.join(result.backupDirectory, manifest.files[0].archiveFile), 'utf8'), contents);
    assert.equal(manifest.files[0].action, 'preserve-and-ignore-generated-file');
    assert.ok(result.backupDirectory.startsWith(f.backupBase));
    assert.equal((await prepareUpdateWorktree(f.options)).backupDirectory, null);
});

test('Only lockfile formatting or npm metadata with an identical complete package graph can be restored after backup', async t => {
    const f = await fixture(t), baseline = await f.read('package-lock.json');
    const formatted = JSON.stringify(lock(), null, 4); await f.write('package-lock.json', formatted);
    const result = await prepareUpdateWorktree(f.options);
    assert.equal(await f.read('package-lock.json'), baseline); assert.equal(await f.git('status','--porcelain'), '');
    assert.equal(await fs.readFile(path.join(result.backupDirectory, '0.bin'), 'utf8'), formatted);
    const v2 = lock(); v2.lockfileVersion = 2; v2.dependencies = { fixture: { version: '1.0.0' } };
    await f.write('package-lock.json', JSON.stringify(v2)); await prepareUpdateWorktree(f.options);
    assert.equal(await f.read('package-lock.json'), baseline);
});

test('Tracked runtime output restores only its verified path and preserves the old bytes in the archive', async t => {
    const f = await fixture(t, { trackedReport: true }), baseline = await f.read('logs/database-upgrade-latest.json');
    const changed = report().replace('fixture pending upgrade', 'fixture retry'); await f.write('logs/database-upgrade-latest.json', changed);
    const result = await prepareUpdateWorktree(f.options);
    assert.equal(await f.read('logs/database-upgrade-latest.json'), baseline);
    assert.equal(await fs.readFile(path.join(result.backupDirectory, '0.bin'), 'utf8'), changed);
    assert.equal(await f.read('server.js'), '// Original source\n');
});

test('Code edits, staged files, malformed output and changed dependencies block the update without modifying any pending file', async t => {
    for (const issue of ['source', 'staged', 'dependency', 'integrity', 'malformed', 'untracked']) {
        await t.test(issue, async sub => {
            const f = await fixture(sub); await fs.mkdir(path.join(f.repoDir, 'logs')); await f.write('logs/database-upgrade-latest.json', report());
            let name = 'server.js', content = '// User source change\n';
            if (issue === 'dependency' || issue === 'integrity') {
                name = 'package-lock.json'; const modified = lock(); modified.packages['node_modules/fixture'][issue === 'integrity' ? 'integrity' : 'version'] = 'different'; content = JSON.stringify(modified);
            }
            if (issue === 'malformed') { name = 'logs/database-upgrade-latest.json'; content = '{"children":["must preserve"]}'; }
            if (issue === 'untracked') { name = 'notes with spaces.txt'; content = 'User notes'; }
            if (issue === 'staged') { name = 'package-lock.json'; content = JSON.stringify(lock(), null, 2); }
            await f.write(name, content); if (issue === 'staged') await f.git('add', name);
            const status = await f.git('status','--porcelain');
            await assert.rejects(prepareUpdateWorktree(f.options), error => error.statusCode === 409 && error.message.includes(name));
            assert.equal(await f.read(name), content); assert.equal(await f.git('status','--porcelain'), status);
            await assert.rejects(fs.access(f.backupBase));
        });
    }
});

test('A backup failure leaves both generated worktree bytes and Git ignore rules unchanged', async t => {
    const f = await fixture(t), changed = JSON.stringify(lock(), null, 2); await f.write('package-lock.json', changed);
    const original = fs.open.bind(fs); t.mock.method(fs, 'open', async (filename, ...args) => {
        if (String(filename).endsWith('0.bin')) throw Error('fixture backup unavailable'); return original(filename, ...args);
    });
    await assert.rejects(prepareUpdateWorktree(f.options), /backup unavailable/);
    assert.equal(await f.read('package-lock.json'), changed); assert.match(await f.git('status','--porcelain'), /package-lock/);
});

test('A file changed during backup is not overwritten even when its Git status code stays the same', async t => {
    const f = await fixture(t); await f.write('package-lock.json', JSON.stringify(lock(), null, 2));
    const original = fs.readFile.bind(fs), changed = lock(); changed.packages['node_modules/fixture'].version = 'new-user-change';
    t.mock.method(fs, 'readFile', async (filename, ...args) => {
        const result = await original(filename, ...args);
        if (String(filename).endsWith('manifest.json')) await f.write('package-lock.json', JSON.stringify(changed));
        return result;
    });
    await assert.rejects(prepareUpdateWorktree(f.options), /ไฟล์เปลี่ยนระหว่างสำรอง/);
    assert.equal(JSON.parse(await f.read('package-lock.json')).packages['node_modules/fixture'].version, 'new-user-change');
});

test('Runtime directory junctions are rejected instead of following files outside the project', async t => {
    const f = await fixture(t), outside = path.join(f.root, 'outside'); await fs.mkdir(outside);
    const contents = report(); await fs.writeFile(path.join(outside, 'database-upgrade-latest.json'), contents);
    await fs.symlink(outside, path.join(f.repoDir, 'logs'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(prepareUpdateWorktree(f.options));
    assert.equal(await fs.readFile(path.join(outside, 'database-upgrade-latest.json'), 'utf8'), contents);
});

test('Deployment npm install --no-save does not dirty the canonical lockfile in an offline no-dependency fixture', async t => {
    const f = await fixture(t, { noDependencies: true }), baseline = await f.read('package-lock.json');
    await execute('npm', ['install','--no-save','--offline','--ignore-scripts','--no-audit','--no-fund'], { cwd: f.repoDir, env: { ...process.env, npm_config_cache: path.join(f.root, 'npm-cache') }, windowsHide: true, shell: process.platform === 'win32', timeout: 30000 });
    assert.equal(await f.read('package-lock.json'), baseline); assert.equal(await f.git('status','--porcelain'), '');
});
