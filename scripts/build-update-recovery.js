import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function buildUpdateRecovery(root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')) {
    const module = await fs.readFile(path.join(root, 'services/updateWorktreeService.js'), 'utf8');
    const entry = await fs.readFile(path.join(root, 'scripts/update-recovery-entry.js'), 'utf8');
    const header = [
        '@echo off',
        'setlocal',
        'chcp 65001 >nul',
        'node --input-type=commonjs -e "const f=require(\'node:fs\');const a=f.readFileSync(process.argv[1],\'utf8\').split(/\\r?\\n/);const i=a.indexOf(\'// KUMONDB_RECOVERY_MODULE\');if(i<0)process.exit(1);import(\'data:text/javascript;base64,\'+Buffer.from(a.slice(i+1).join(\'\\n\')).toString(\'base64\')).catch(e=>{console.error(e.message);process.exitCode=1;});" -- "%~f0" %*',
        'set "KUMON_RECOVERY_RESULT=%ERRORLEVEL%"',
        'if not "%KUMON_RECOVERY_RESULT%"=="0" echo Recovery stopped. No unknown source changes were overwritten.',
        'pause',
        'exit /b %KUMON_RECOVERY_RESULT%',
        '// KUMONDB_RECOVERY_MODULE'
    ].join('\n');
    return `${header}\n${module}\n${entry}`.replace(/\r?\n/g, '\r\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    await fs.writeFile(new URL('../launcher/recover-update.cmd', import.meta.url), await buildUpdateRecovery());
}
