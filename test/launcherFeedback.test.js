import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs/promises';
const execute = promisify(execFile);
for (const scenario of ['reuse-ok', 'reuse-fail', 'dependencies', 'timeout', 'window-fail', 'success', 'cooldown']) {
  test(`Windows launcher feedback ${scenario} uses only mocked network/process/dialog effects`, { skip: process.platform !== 'win32', timeout: 35000 }, async () => {
    const { stdout } = await execute('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('test/support/launcherFeedbackHarness.ps1'),
      '-Source', path.resolve('launcher/start.ps1'), '-Scenario', scenario
    ], { windowsHide: true, timeout: 30000 });
    const result = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
    assert.equal(result.stops, 0);
    const error = ['reuse-fail', 'dependencies', 'timeout', 'window-fail'].includes(scenario);
    assert.equal(result.notices.length, error ? 1 : 0);
    if (error) { assert.match(result.notices[0], /KumonDB/); assert.match(result.notices[0], /Folder:/); assert.match(result.notices[0], /ไม่สำเร็จ|ยังไม่ครบ/); }
    assert.equal(result.starts.length, ['timeout', 'window-fail', 'success'].includes(scenario) ? 1 : 0);
    for (const start of result.starts) assert.equal(start.style, 'Hidden');
    if (scenario === 'success') assert.ok(result.requests.at(-1).endsWith('/desktop/show'));
    if (scenario === 'timeout') assert.ok(result.requests.every(url => url.endsWith('/runtime')));
    for (const url of result.requests) assert.ok(url.startsWith('http://localhost:3000/api/system/'));
  });
}
test('Launcher feedback supports copying diagnostics and bounded waiting without opening Chrome', async () => {
  const helper = await fs.readFile('launcher/launch-feedback.ps1', 'utf8');
  assert.match(helper, /Clipboard\]::SetText/); assert.match(helper, /TimeoutSeconds = 45/);
  assert.match(helper, /deadline/); assert.match(helper, /ShowDialog/); assert.doesNotMatch(helper, /Start-Process.*chrome/i);
});
