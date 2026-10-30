import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import express from 'express';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildUpdateRecovery } from '../scripts/build-update-recovery.js';

const execute = promisify(execFile);
async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kumondb-recovery-bundle-'));
    const repo = path.join(root, "project's files"), local = path.join(root, 'local-data'), downloads = path.join(root, 'Downloads');
    for (const dir of [repo, local, downloads]) await fs.mkdir(dir);
    const git = async (...args) => (await execute('git', args, { cwd: repo, windowsHide: true })).stdout;
    await git('init','--initial-branch=main'); await git('config','core.autocrlf','false');
    await fs.writeFile(path.join(repo, '.gitignore'), '.env\nnode_modules/\n*.log\n');
    await fs.writeFile(path.join(repo, 'server.js'), '// fixture original source\n');
    await fs.writeFile(path.join(repo, 'package.json'), '{"name":"kumondb","version":"1.0.0"}');
    await git('add','.'); await git('-c','user.name=Fixture','-c','user.email=fixture@invalid','commit','-qm','Fixture baseline');
    await fs.mkdir(path.join(repo, 'logs'));
    await fs.writeFile(path.join(repo, 'logs/database-upgrade-latest.json'), JSON.stringify({ ready: false, applied: false, checkedAt: new Date().toISOString(), error: 'Fixture pending upgrade' }));
    const helper = path.join(downloads, 'recover-update.cmd'), bundle = await buildUpdateRecovery();
    await fs.writeFile(helper, bundle);
    const module = bundle.split('// KUMONDB_RECOVERY_MODULE\r\n')[1]; assert.ok(module);
    const env = { ...process.env, LOCALAPPDATA: local };
    const run = (...args) => execute(process.execPath, ['--input-type=module','-e',`await import(${JSON.stringify(`data:text/javascript;base64,${Buffer.from(module).toString('base64')}`)})`,'--',helper,'--project',repo,...args], { cwd: downloads, env, windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 });
    t.after(async () => {
        assert.ok(path.resolve(root).startsWith(`${path.resolve(os.tmpdir())}${path.sep}kumondb-recovery-bundle-`));
        await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    });
    return { root, repo, local, downloads, helper, run, git, env };
}

test('The download helper contains exactly the same reviewed recovery code as the application', async () => {
    assert.equal(await fs.readFile('launcher/recover-update.cmd', 'utf8'), await buildUpdateRecovery());
});

test('A standalone downloaded helper fixes only generated files then calls the old update action once, with no SQL or extra dependency', async t => {
    const f = await fixture(t), app = express(), writes = [];
    let instanceId = 'fixture-old';
    app.use(express.json());
    app.get('/api/system/runtime', (_req, res) => res.json({ instanceId, processId: process.pid }));
    app.post('/api/system/update-apply', async (req, res) => {
        writes.push(req.body);
        const status = await f.git('status','--porcelain');
        if (status) return res.status(409).json({ success: false, error: 'Fixture old dirty worktree guard' });
        instanceId = 'fixture-new'; res.json({ success: true, previousInstanceId: 'fixture-old' });
    });
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    try {
        await fs.writeFile(path.join(f.repo, '.env'), `PORT=${server.address().port}\nDB_PASSWORD=fixture-must-not-appear-in-backup`);
        const result = await f.run('--yes');
        assert.match(result.stdout, /new server is ready/); assert.deepEqual(writes, [{ confirm: true }]);
        assert.equal(await f.git('status','--porcelain'), '');
        const archive = JSON.parse(result.stdout.split(/\r?\n/)[0]).backupDirectory;
        const files = await fs.readdir(archive); assert.ok(files.includes('manifest.json'));
        assert.doesNotMatch(await fs.readFile(path.join(archive,'manifest.json'),'utf8'), /DB_PASSWORD|must-not-appear/);
        assert.equal(await fs.readFile(path.join(f.repo,'server.js'),'utf8'), '// fixture original source\n');
        assert.equal(JSON.parse(await fs.readFile(path.join(f.repo,'logs/database-upgrade-latest.json'),'utf8')).error, 'Fixture pending upgrade');
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('A downloaded helper reports unknown source changes and never calls update or writes Git rules', async t => {
    const f = await fixture(t); await fs.writeFile(path.join(f.repo, 'server.js'), '// user change');
    await assert.rejects(f.run('--yes','--files-only'), error => error.stderr.includes('server.js'));
    assert.equal(await fs.readFile(path.join(f.repo, 'server.js'), 'utf8'), '// user change');
    assert.match(await f.git('status','--porcelain'), /server.js/);
    const projectData = path.join(f.local, 'KumonDB'); await assert.rejects(fs.access(projectData));
});

test('Windows double-click bootstrap executes the actual Git download bytes outside the project folder', { skip: process.platform !== 'win32', timeout: 20000 }, async t => {
    const f = await fixture(t);
    const command = `""${f.helper}" --project "${f.repo}" --yes --files-only <nul"`;
    const bundle = await fs.readFile(f.helper, 'utf8');
    await fs.mkdir(path.join(f.repo, 'launcher'));
    await fs.copyFile('.gitattributes', path.join(f.repo, '.gitattributes'));
    await fs.writeFile(path.join(f.repo, 'launcher/recover-update.cmd'), bundle);
    await f.git('add','.gitattributes','launcher/recover-update.cmd');
    await f.git('-c','user.name=Fixture','-c','user.email=fixture@invalid','commit','-qm','Fixture downloadable helper');
    const downloaded = await f.git('show','HEAD:launcher/recover-update.cmd');
    assert.equal(downloaded, bundle, 'Git raw downloads must preserve the executable CRLF bytes');
    await fs.writeFile(f.helper, downloaded);
    const result = await execute('cmd.exe', ['/d','/s','/c',command], { cwd: f.downloads, env: f.env, windowsHide: true, windowsVerbatimArguments: true, timeout: 15000 });
    assert.match(result.stdout, /backupDirectory/); assert.equal(await f.git('status','--porcelain'), '');
});
