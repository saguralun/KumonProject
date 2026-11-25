import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const normalize = text => String(text || '').replace(/\s+/g, ' ').trim();
const nameOf = line => line.trim().slice(2).replace(/ \([\d.]+ms\)$/, '');
const routeOf = name => name === '/' ? '/index.html' : name;

export async function collectControlCoverage({ traceDirectory, inventoryPath, outputDirectory }) {
    const inventory = JSON.parse(await fs.readFile(inventoryPath, 'utf8'));
    const files = await fs.readdir(traceDirectory);
    const events = [], malformed = [];
    for (const file of files.filter(name => /^controls-\d+\.jsonl$/.test(name))) {
        const lines = (await fs.readFile(path.join(traceDirectory, file), 'utf8')).split(/\r?\n/);
        for (const [index, line] of lines.entries()) {
            if (!line) continue;
            try { events.push(JSON.parse(line)); }
            catch { malformed.push({ file, line: index + 1 }); }
        }
    }
    const runs = [];
    for (const file of files.filter(name => /\.log$/.test(name)).sort()) {
        const text = await fs.readFile(path.join(traceDirectory, file), 'utf8');
        const number = label => Number(text.match(new RegExp(`ℹ ${label} (\\d+)`))?.[1] ?? NaN);
        runs.push({ file, completed: Number.isFinite(number('tests')), tests: number('tests'),
            pass: number('pass'), fail: number('fail'), cancelled: number('cancelled'), skipped: number('skipped'),
            passedNames: text.split(/\r?\n/).filter(line => line.startsWith('✔ ')).map(nameOf),
            failedNames: [...new Set(text.split(/\r?\n/).filter(line => line.startsWith('✖ ') && line.trim() !== '✖ failing tests:').map(nameOf))] });
    }
    const passedNames = new Set(runs.flatMap(run => run.passedNames));
    const initial = runs.find(run => run.file === 'all-ui.log');
    const unresolvedInitialFailures = (initial?.failedNames || []).filter(name => !passedNames.has(name));
    let byId = 0, byLabel = 0, notObserved = 0, ambiguous = 0;
    const pages = inventory.pages.map(page => {
        const route = `/${page.page}`;
        const clicks = events.filter(event => event.kind === 'click' && routeOf(event.page) === route && event.tag !== 'a');
        const controls = page.controls.map(control => {
            let matching = [], match = 'not_observed';
            if (control.id) {
                matching = clicks.filter(event => event.id === control.id);
                if (matching.length) { match = 'observed_id'; byId++; }
            } else {
                const label = normalize(control.label);
                const candidates = page.controls.filter(other => !other.id && normalize(other.label) === label);
                const found = clicks.filter(event => !event.id && normalize(event.label) === label);
                if (label && candidates.length === 1 && found.length) { matching = found; match = 'observed_unique_label'; byLabel++; }
                else if (found.length) { match = 'ambiguous_label'; ambiguous++; }
            }
            if (match === 'not_observed') notObserved++;
            return { ...control, match, clickEvents: matching.length,
                trustedEvents: matching.filter(event => event.trusted).length,
                testFiles: [...new Set(matching.map(event => event.testFile).filter(Boolean))].sort() };
        });
        return { page: page.page, declaredButtons: page.count,
            observed: controls.filter(control => control.match.startsWith('observed_')).length,
            controls };
    });
    const dynamic = new Map(), links = new Map();
    for (const event of events) {
        if (event.kind !== 'click') continue;
        const page = pages.find(page => `/${page.page}` === routeOf(event.page));
        if (event.tag === 'a') {
            const key = `${event.page}|${event.id}|${normalize(event.label)}`;
            const row = links.get(key) || { page: event.page, id: event.id, label: normalize(event.label), events: 0 };
            row.events++; links.set(key, row); continue;
        }
        const matched = page?.controls.some(control => control.match.startsWith('observed_') &&
            (control.id ? control.id === event.id : !event.id && normalize(control.label) === normalize(event.label)));
        if (matched) continue;
        const key = `${event.page}|${event.id}|${(event.dataKeys || []).join(',')}|${normalize(event.label)}`;
        const row = dynamic.get(key) || { page: event.page, id: event.id, label: normalize(event.label),
            dataKeys: event.dataKeys, events: 0, testFiles: new Set() };
        row.events++; if (event.testFile) row.testFiles.add(event.testFile); dynamic.set(key, row);
    }
    const result = {
        generatedAt: new Date().toISOString(),
        scope: 'Synthetic workflow click observations; not proof of every postcondition or every possible record/state.',
        limitations: [
            'A missing click does not prove a button is broken; disabled-state assertions and indirect calls may not emit a click.',
            'Unique-label matches are weaker than exact per-page ID matches.',
            'Dynamic controls and navigation links have no complete static denominator.',
            'A click in a passing workflow does not establish all data, permission, printer or network scenarios.'
        ],
        summary: { declaredPages: pages.length, declaredButtons: pages.reduce((sum, page) => sum + page.declaredButtons, 0),
            observedById: byId, observedByUniqueLabel: byLabel, notObserved, ambiguous,
            observedClickEvents: events.length, observedDynamicSignatures: dynamic.size, observedLinkSignatures: links.size,
            malformedTraceLines: malformed.length },
        runs, unresolvedInitialFailures, pages,
        dynamic: [...dynamic.values()].map(row => ({ ...row, testFiles: [...row.testFiles].sort() })),
        links: [...links.values()], malformed
    };
    await fs.mkdir(outputDirectory, { recursive: true });
    await fs.writeFile(path.join(outputDirectory, 'control-coverage.json'), JSON.stringify(result, null, 2) + '\n');
    const lines = ['# Control observations', '',
        'เฉพาะข้อมูลจำลอง: การพบ click ไม่เท่ากับยืนยันทุกผลลัพธ์ และปุ่มที่ไม่พบ click ยังไม่ถือว่าเสีย', '',
        '| หน้า | ปุ่มใน HTML | พบ action ที่จับคู่ได้ | ยังจับคู่ไม่ได้ |', '| --- | ---: | ---: | ---: |',
        ...pages.map(page => `| ${page.page} | ${page.declaredButtons} | ${page.observed} | ${page.declaredButtons - page.observed} |`),
        '', '## ปุ่มที่ยังไม่มีหลักฐาน action ตรงจากรอบนี้', '',
        ...pages.flatMap(page => page.controls.filter(control => !control.match.startsWith('observed_'))
            .map(control => `- ${page.page}: ${control.id ? `\`${control.id}\`` : '(ไม่มี ID)'} — ${normalize(control.label) || '(ไม่มีข้อความ)'}`)),
        '', 'รายละเอียด event, ข้อจำกัด และผลแต่ละรอบอยู่ใน control-coverage.json', ''];
    await fs.writeFile(path.join(outputDirectory, 'control-coverage.md'), lines.join('\n'));
    return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const traceDirectory = (await fs.readFile('logs/persona-review-directory.txt', 'utf8')).trim();
    const result = await collectControlCoverage({ traceDirectory,
        inventoryPath: process.env.KUMON_REVIEW_INVENTORY || path.join(os.tmpdir(), 'kumondb-button-inventory.json'),
        outputDirectory: path.resolve('test/reviews/2026-11-24') });
    console.log(JSON.stringify({ summary: result.summary, runs: result.runs.map(({ passedNames, failedNames, ...run }) => run),
        unresolvedInitialFailures: result.unresolvedInitialFailures }, null, 2));
}
