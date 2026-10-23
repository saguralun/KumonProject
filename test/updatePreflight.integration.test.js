import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

for (const mode of ['failure', 'success', 'changed']) test(`The older-updater bridge handles ${mode} without stopping an unverified server`, {
    skip: process.platform !== 'win32' || process.env.TEST_BROWSER_UI !== '1', timeout: 40000
}, async () => {
    const passes = mode === 'success', changed = mode === 'changed';
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kumondb-preflight-fixture-'));
    let server, newPid;
    try {
        await fs.mkdir(path.join(root, 'scripts'));
        await fs.writeFile(path.join(root, 'server.js'), `const http=require('node:http'),fs=require('node:fs');const s=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({instanceId:fs.existsSync('changed.flag')?'fixture-changed':'preflight-fixture-'+process.pid,processId:process.pid,fixtureRoot:process.cwd()}));});s.listen(Number(process.env.PORT)||0,'127.0.0.1',()=>console.log(s.address().port));`);
        await fs.writeFile(path.join(root, 'scripts', 'prepare-database.js'), changed ? `require('node:fs').writeFileSync('changed.flag','1');` : passes ? `console.log('Fixture database ready');` : `console.error('Fixture database preparation failed');process.exitCode=1;`);
        const helper = path.join(root, 'restart-server.ps1'); await fs.copyFile('launcher/restart-server.ps1', helper);
        server = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: '0' }, windowsHide: true, stdio: ['ignore','pipe','pipe'] });
        const [output] = await once(server.stdout, 'data'), port = Number(String(output).trim()); assert.ok(port > 0);
        const status = path.join(root, 'restart.log');
        const restart = promisify(execFile)('powershell.exe', ['-NoProfile','-ExecutionPolicy','Bypass','-File',helper,
            '-ServerPid',String(server.pid),'-ProjectDir',root,'-NodePath',process.execPath,'-Port',String(port),'-StatusPath',status],
        { windowsHide: true, timeout: 30000 });
        if (passes) await restart.catch(async error => { error.message += '\n' + await fs.readFile(status, 'utf8'); throw error; }); else await assert.rejects(restart);
        const runtime = await (await fetch(`http://127.0.0.1:${port}/api/system/runtime`)).json();
        assert.equal(path.resolve(runtime.fixtureRoot), path.resolve(root)); assert.equal(runtime.instanceId, changed ? 'fixture-changed' : `preflight-fixture-${runtime.processId}`);
        const report = await fs.readFile(status, 'utf8');
        if (passes) {
            newPid = runtime.processId; assert.notEqual(newPid, server.pid); assert.match(report, /DATABASE_READY/); assert.match(report, /SUCCESS/);
        } else {
            assert.equal(runtime.processId, server.pid); assert.match(report, changed ? /ERROR.*Original server changed/ : /ERROR.*Database preparation failed/); assert.doesNotMatch(report, /SUCCESS/);
        }
    } finally {
        if (server && server.exitCode === null) { const ended = once(server, 'exit'); server.kill(); await ended; }
        if (!newPid) newPid = Number((await fs.readFile(path.join(root, 'restart.log'), 'utf8').catch(() => '')).match(/STARTED newPid=(\d+)/)?.[1]) || null;
        if (newPid) { assert.ok(newPid !== process.pid && newPid !== server.pid); try { process.kill(newPid); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
        const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(root));
        assert.ok(relative.startsWith('kumondb-preflight-fixture-') && !path.isAbsolute(relative));
        await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
});
