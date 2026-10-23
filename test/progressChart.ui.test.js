import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { once } from 'node:events';
import { chromium } from 'playwright-core';
import os from 'node:os';
import path from 'node:path';

test('Progress dots stay inside their color bands with descending reference thresholds and clamped upper levels', {
    skip: process.env.TEST_BROWSER_UI !== '1', timeout: 30000
}, async () => {
    const app = express(); app.use(express.static('public'));
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const browser = await chromium.launch({ channel: 'chrome', headless: true, chromiumSandbox: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const errors = [], writes = [];
        page.on('pageerror', error => errors.push(error.message));
        const levels = Array.from({ length: 14 }, (_, i) => `L${i}`);
        // The API emits thresholds in award order, not ascending month order.
        const positions = { '0': 1, '6M': 3, '2Y': 6, '3Y': 8, '5Y': 10, '7Y': 12 };
        const referenceLines = ['0', '7Y', '5Y', '3Y', '2Y', '6M'].map(code => ({ code, points: [
            { grade: 'ป.1', levelPosition: positions[code] },
            { grade: 'ม.6', levelPosition: Math.min(13 + positions[code] / 6, 13.9999) }
        ] }));
        const pupils = [ ['KSIS', 2.8], ['6M', 3.1], ['2Y', 6.1], ['3Y', 8.1], ['5Y', 10.1], ['7Y', 12.1], ['none', .7] ];
        const students = pupils.map(([code, levelPosition], index) => ({ enrollmentId: index + 1, name: `Student ${index}`, gradeClass: 'ป.1', levelCode: 'L2', percent: 80, levelPosition, gradeSyncStatus: code === 'none' ? null : { code, gapMonths: 3 } }));
        students.push({ ...students[0], enrollmentId: 99, gradeClass: 'ม.6', levelPosition: 13.99995 });
        await page.route('https://fonts.**', route => route.abort());
        await page.route('**/api/**', route => {
            const request = route.request(), url = new URL(request.url());
            if (request.method() !== 'GET') writes.push(url.pathname);
            const data = url.pathname === '/api/auth/me' ? { user: { role: 'admin' }, permissions: ['*'] }
                : url.pathname === '/api/progress-chart' ? { subjectCode: url.searchParams.get('subject'), grades: ['ป.1', 'ม.6'], levels, referenceLines, students }
                : { success: true, checked: false };
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
        });
        await page.goto(`http://127.0.0.1:${server.address().port}/progress-chart.html`);
        for (const subject of ['ME', 'EFL', 'TRP']) {
            await page.locator(`#subjectTabs [data-subject="${subject}"]`).click();
            await page.locator('.student-dot').first().waitFor();
            const dots = await page.locator('.student-dot').evaluateAll(elements => elements.map(element => ({ id: Number(element.dataset.enrollmentId), y: Number(element.getAttribute('cy')), fill: element.getAttribute('fill') })));
            assert.equal(dots.length, students.length);
            assert.ok(dots.every(dot => Number.isFinite(dot.y)), 'Clamped thresholds cannot produce NaN coordinates');
            const yAt = position => 16 + (14 - position) * 32;
            for (const [index, [code]] of pupils.entries()) {
                const dot = dots.find(item => item.id === index + 1);
                const bands = { KSIS: [1, 3], '6M': [3, 6], '2Y': [6, 8], '3Y': [8, 10], '5Y': [10, 12], '7Y': [12, 14], none: [0, 1] };
                const [lower, upper] = bands[code];
                assert.ok(dot.y <= yAt(lower) && dot.y >= yAt(upper), `${subject}: ${code} dot crossed its reference boundary: ${JSON.stringify(dot)}`);
            }
            const blue = dots.find(dot => dot.id === 1), green = dots.find(dot => dot.id === 2);
            assert.equal(blue.fill, '#7dd3fc'); assert.equal(green.fill, '#059669');
            assert.ok(blue.y > green.y, 'On-pace light blue must remain below the six-month green band');
            const labels=await page.locator('.ref-line-label').evaluateAll(elements=>elements.map(element=>{const rect=element.getBoundingClientRect();return {code:element.textContent,x:rect.x,y:rect.y,width:rect.width,height:rect.height};}).sort((a,b)=>a.y-b.y));
            assert.equal(labels.length,referenceLines.length,'Each threshold has a readable label');
            for(let i=1;i<labels.length;i++) assert.ok(labels[i].y>=labels[i-1].y+labels[i-1].height+3,`${subject}: threshold labels overlap: ${JSON.stringify(labels)}`);
            const connectors=await page.locator('.ref-label-connector').evaluateAll(elements=>elements.map(element=>element.getPointAtLength(0).y));
            assert.equal(connectors.length,referenceLines.length);
            const sources=referenceLines.map(line=>yAt(line.points.at(-1).levelPosition)).sort((a,b)=>a-b);
            assert.ok(connectors.every((y,index)=>Math.abs(y-sources[index])<.01),'Leader lines retain the original threshold endpoints');
        }
        await page.locator('#gradeFilterNone').click();
        assert.equal(await page.locator('.student-dot').count(), 0);
        await page.locator('#gradeFilterAll').click(); await page.locator('.student-dot').first().waitFor();
        for(const width of [1440,390]) {
            await page.setViewportSize({width,height:900});
            const labels=await page.locator('.ref-line-label').evaluateAll(elements=>elements.map(element=>{const rect=element.getBBox();return {y:rect.y,bottom:rect.y+rect.height,x:rect.x,right:rect.x+rect.width};}).sort((a,b)=>a.y-b.y));
            const svg=await page.locator('.progress-svg').evaluate(element=>({width:element.viewBox.baseVal.width,height:element.viewBox.baseVal.height}));
            assert.ok(labels.every(label=>label.y>=0&&label.bottom<=svg.height&&label.right<=svg.width),'Labels stay inside the scrollable chart');
            assert.ok(labels.every((label,index)=>!index||label.y>=labels[index-1].bottom+3),'Responsive labels do not overlap');
            await page.screenshot({path:path.join(os.tmpdir(),`kumondb-progress-labels-${width}.png`),fullPage:true});
        }
        await page.screenshot({ path: path.join(os.tmpdir(), 'kumondb-progress-chart-bands.png'), fullPage: true });
        assert.deepEqual(errors, []); assert.deepEqual(writes, []);
    } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
