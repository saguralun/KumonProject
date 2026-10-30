// Bundled after updateWorktreeService.js by build-update-recovery.js; only Node built-ins are needed.
async function recoveryMain() {
    const args = process.argv.slice(2);
    const option = name => args.includes(name);
    const projectIndex = args.indexOf('--project');
    let project = projectIndex >= 0 ? args[projectIndex + 1] : null;
    if (!project) {
        const scriptDirectory = path.dirname(path.resolve(process.argv[1]));
        const candidates = [...new Set([scriptDirectory, path.dirname(scriptDirectory), process.cwd(), 'C:/Project/KumonProject', 'D:/Project/KumonDB'])];
        const matches = [];
        for (const candidate of candidates) {
            try {
                const pkg = JSON.parse(await fs.readFile(path.join(candidate, 'package.json'), 'utf8'));
                if (pkg.name === 'kumondb') { await fs.access(path.join(candidate, 'server.js')); matches.push(candidate); }
            } catch { }
        }
        if (matches.length === 1) project = matches[0];
        else {
            const picker = await execute('powershell.exe', ['-NoProfile', '-STA', '-Command',
                "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description='Select the KumonDB project folder containing server.js'; if($d.ShowDialog() -eq 'OK'){[Console]::Write($d.SelectedPath)}"], { windowsHide: true });
            project = picker.stdout.trim();
            if (!project) { console.log('Cancelled. No files changed.'); return; }
        }
    }
    project = await fs.realpath(project);
    const inspection = await inspectUpdateWorktree({ repoDir: project });
    if (option('--inspect-only')) { console.log(JSON.stringify(inspection)); return; }
    if (inspection.blocked.length) throw recoveryError(`ไม่ทับไฟล์ที่ยืนยันไม่ได้ว่าโปรแกรมสร้างเอง:\n${inspection.blocked.map(item => `- ${item.path}: ${item.reason}`).join('\n')}\nไฟล์เดิมยังอยู่ครบ`);
    let port = 3000;
    try {
        const env = await fs.readFile(path.join(project, '.env'), 'utf8');
        const configured = env.match(/^\s*PORT\s*=\s*["']?(\d+)["']?\s*(?:#.*)?$/m);
        if (configured) port = Number(configured[1]);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid application port. No files changed.');
    const origin = `http://127.0.0.1:${port}`;
    let previous;
    if (!option('--files-only')) {
        const response = await fetch(`${origin}/api/system/runtime`, { signal: AbortSignal.timeout(3000) });
        previous = await response.json();
        if (!response.ok || !previous.instanceId || !previous.processId) throw new Error('KumonDB is not available. Open the program first. No files changed.');
    }
    if (!option('--yes')) {
        try {
            await execute('powershell.exe', ['-NoProfile', '-STA', '-Command',
                "Add-Type -AssemblyName System.Windows.Forms; $m='Back up verified generated files and continue the KumonDB update?'+[Environment]::NewLine+$env:KUMON_RECOVERY_PROJECT+[Environment]::NewLine+'Finish unsaved app and KSIS work first. Unknown source changes will NOT be overwritten.'; if([System.Windows.Forms.MessageBox]::Show($m,'KumonDB Update Recovery','YesNo','Warning','Button2') -ne 'Yes'){exit 2}"],
            { windowsHide: true, env: { ...process.env, KUMON_RECOVERY_PROJECT: project } });
        } catch (error) { if (error.code === 2) { console.log('Cancelled. No files changed.'); return; } throw error; }
    }
    const recovered = await prepareUpdateWorktree({ repoDir: project });
    console.log(JSON.stringify(recovered));
    if (option('--files-only')) return;
    try {
        const response = await fetch(`${origin}/api/system/update-apply`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true }) });
        const result = await response.json();
        if (!response.ok || result.success === false) throw new Error(result.error || 'Update failed');
    } catch (error) { if (!(error instanceof TypeError)) throw error; }
    const deadline = Date.now() + 10 * 60000;
    do {
        try {
            const response = await fetch(`${origin}/api/system/runtime`, { signal: AbortSignal.timeout(2500) });
            const runtime = await response.json();
            if (response.ok && runtime.instanceId && runtime.instanceId !== previous.instanceId) { console.log('Update completed. The new server is ready.'); return; }
        } catch { }
        await new Promise(resolve => setTimeout(resolve, 1000));
    } while (Date.now() < deadline);
    throw new Error('Restart not confirmed. Original files remain backed up. Check the project logs folder.');
}

await recoveryMain().catch(error => { console.error(error.message); process.exitCode = 1; });
