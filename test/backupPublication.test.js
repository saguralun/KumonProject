import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const filename = 'fixture_only_2030-01-02_030405.backup';

async function fixture(t, mode, collision = false) {
    // Some restricted Windows temp directories disallow rename even when file
    // creation/deletion is allowed. Permit a disposable fixture under a writable
    // workspace root in that environment, without changing real backup settings.
    const scratch = path.resolve(process.env.KUMON_BACKUP_FIXTURE_ROOT || os.tmpdir());
    const root = await fs.mkdtemp(path.join(scratch, 'kumondb-backup-publish-'));
    const scripts = path.join(root, 'scripts'), output = path.join(root, 'output');
    await fs.mkdir(scripts); await fs.mkdir(output);
    t.after(async () => {
        const relative = path.relative(scratch, path.resolve(root));
        assert.ok(relative.startsWith('kumondb-backup-publish-') && !path.isAbsolute(relative));
        await fs.rm(root, { recursive: true, force: true });
    });
    const script = path.join(scripts, 'backup-database.ps1');
    await fs.copyFile('scripts/backup-database.ps1', script);
    const fake = path.join(root, 'fake-pg-dump.ps1');
    await fs.writeFile(fake, `
$ErrorActionPreference = 'Stop'
function Argument([string]$Name) { $index = [array]::IndexOf($script:args, $Name); if($index -lt 0){throw 'Missing fake dump argument'}; return $script:args[$index + 1] }
if ((Argument '-h') -ne 'fixture.invalid' -or (Argument '-d') -ne 'fixture_only') { throw 'Fixture credentials required' }
$target = Argument '-f'
$directory = [IO.Path]::GetDirectoryName($target)
$published = Join-Path $directory '${filename}'
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'observed.json'), (@{ target=$target; existed=(Test-Path -LiteralPath $published); password=$env:PGPASSWORD } | ConvertTo-Json -Compress))
${mode === 'missing' ? '' : `[IO.File]::WriteAllText($target, '${mode === 'empty' ? '' : 'PGDMP fixture archive bytes'}')`}
${mode === 'throw' ? "throw 'fixture dump interrupted'" : `$global:LASTEXITCODE = ${mode === 'failure' ? '9' : '0'}`}
`);
    await fs.writeFile(path.join(root, '.env'), [
        'DB_HOST=fixture.invalid', 'DB_PORT=1', 'DB_NAME=fixture_only', 'DB_USER=fixture',
        'DB_PASSWORD=fixture-password', `BACKUP_DIR=${output}`, `PG_DUMP_PATH=${fake}`
    ].join('\r\n'));
    // Freeze only the copied script's clock, preserving the existing filename
    // contract and forcing a deterministic destination-collision test.
    const runner = path.join(root, 'run-fixture.ps1');
    await fs.writeFile(runner, `
param([string]$ScriptPath)
function global:Get-Date { param([string]$Format); $date=[datetime]'2030-01-02T03:04:05'; if($Format){return $date.ToString($Format)}; return $date }
& $ScriptPath
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'restored-password.txt'), $env:PGPASSWORD)
`);
    if (collision) await fs.writeFile(path.join(output, filename), 'existing good backup');
    return {
        root, output,
        async run() {
            return execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', runner, '-ScriptPath', script], {
                cwd: root, windowsHide: true, timeout: 15000,
                env: { ...process.env, PGPASSWORD: 'fixture-original-password' }
            });
        },
        observed: async () => JSON.parse(await fs.readFile(path.join(root, 'observed.json'), 'utf8'))
    };
}

test('Backup publishes only after the fake dump succeeds and restores its password environment', { skip: process.platform !== 'win32' }, async t => {
    const f = await fixture(t, 'success');
    const result = await f.run();
    assert.match(result.stdout, /Backup succeeded:/);
    const observed = await f.observed();
    assert.equal(observed.existed, false, 'The final backup must not exist while dumping');
    assert.equal(observed.password, 'fixture-password');
    assert.match(path.basename(observed.target), /^\.fixture_only_2030-01-02_030405\.[a-f0-9]{32}\.tmp$/);
    assert.deepEqual(await fs.readdir(f.output), [filename]);
    assert.equal(await fs.readFile(path.join(f.output, filename), 'utf8'), 'PGDMP fixture archive bytes');
    assert.equal(await fs.readFile(path.join(f.root, 'restored-password.txt'), 'utf8'), 'fixture-original-password');
});

for (const mode of ['failure', 'throw', 'empty', 'missing']) test(`Backup ${mode} publishes nothing, cleans temporary output, and preserves older backups`, { skip: process.platform !== 'win32' }, async t => {
    const f = await fixture(t, mode);
    const older = Array.from({ length: 14 }, (_, i) => `fixture_only_2020-01-01_${String(i).padStart(6, '0')}.backup`);
    for (const name of older) await fs.writeFile(path.join(f.output, name), `good ${name}`);
    await assert.rejects(f.run(), error => error.code === 1);
    assert.deepEqual((await fs.readdir(f.output)).sort(), older.sort(), 'Failure must not publish or prune backups');
    assert.equal((await f.observed()).existed, false);
    for (const name of older) assert.equal(await fs.readFile(path.join(f.output, name), 'utf8'), `good ${name}`);
});

test('A same-second backup collision never overwrites the previous archive', { skip: process.platform !== 'win32' }, async t => {
    const f = await fixture(t, 'success', true);
    await assert.rejects(f.run(), error => error.code === 1);
    assert.equal((await f.observed()).existed, true);
    assert.deepEqual(await fs.readdir(f.output), [filename]);
    assert.equal(await fs.readFile(path.join(f.output, filename), 'utf8'), 'existing good backup');
});
