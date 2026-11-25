import assert from 'node:assert/strict';
import { test } from 'node:test';
import { controlFixture } from './support/controlFixture.js';
import { readKsisWorkspace, runKsisWorkspace } from '../services/ksisWorkspaceState.js';

test('AT recovery UI requires acknowledgment, retains failed recovery locks and preserves login warning across shared refresh/reload',
    { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 30000 }, async () => {
        const userId = 987730;
        let pending = true, rejectRecovery = true;
        const oldResult = { pendingDraft: true, saved: [], message: 'Fixture AT save unconfirmed', rows: [] };
        await runKsisWorkspace(userId, 'at', 'fill', {}, async () => oldResult);
        const f = await controlFixture('ksis', async (req, res) => {
            if (req.path === '/ksis/desktop/status') {
                // Like the existing workspace UI fixtures, omit the desktop
                // launcher flag so the mocked browser renders the workspace.
                res.json({ success: true, pendingDraft: pending, pendingWork: pending ? 'AT' : null }); return true;
            }
            if (req.path === '/ksis/workspace') {
                res.json({ success: true, ...readKsisWorkspace(userId), connection: { pendingDraft: pending, pendingWork: pending ? 'AT' : null } }); return true;
            }
            if (req.path === '/ksis/at/acknowledge') {
                try {
                    const result = await runKsisWorkspace(userId, 'at', 'acknowledge', req.body, async () => {
                        if (rejectRecovery) throw Object.assign(new Error('ยังมีข้อมูล AT แก้ค้างอยู่'), { statusCode: 409 });
                        pending = false;
                        return { acknowledged: true, pendingDraft: false, requiresLogin: true, previousResultUnverified: true,
                            message: 'กรุณาเข้าสู่ระบบ KSIS แล้วเตรียม AT ใหม่ ผลบันทึกรอบก่อนยังไม่ยืนยัน' };
                    });
                    res.json({ success: true, ...result });
                } catch (error) {
                    res.status(error.statusCode || 500).json({ success: false, error: error.message });
                }
                return true;
            }
            if (req.path === '/ksis/at/preview') {
                assert.equal(pending, false);
                const result = await runKsisWorkspace(userId, 'at', 'preview', req.body, async () => ({ requiresLogin: true }));
                res.json({ success: true, ...result }); return true;
            }
            return false;
        });
        try {
            const { page } = f;
            await page.locator('#ksisAtAcknowledge').waitFor({ state: 'visible' });
            assert.equal(await page.locator('#ksisAtPreview').isDisabled(), true);
            assert.equal(await page.locator('#ksisAtFill').isDisabled(), true);
            await page.locator('#ksisAtAcknowledge').click();
            const confirmation = await page.locator('#appDialogMessage').innerText();
            assert.match(confirmation, /โหลดหน้าเข้าสู่ระบบ KSIS ใหม่/);
            assert.match(confirmation, /ช่องเข้าสู่ระบบที่กรอกไว้จะถูกล้าง/);
            assert.match(confirmation, /ผลบันทึกรอบก่อนยังไม่ยืนยัน/);
            await f.choose(false);
            assert.equal(f.writes().length, 0, 'Cancel never calls recovery');
            await page.locator('#ksisAtAcknowledge').click(); await f.choose(true);
            await page.waitForFunction(() => document.getElementById('ksisAtSource').textContent.includes('แก้ค้าง'));
            assert.equal(await page.locator('#ksisAtPreview').isDisabled(), true);
            assert.equal(await page.locator('#reportMonth').isDisabled(), true);
            assert.equal(pending, true);
            rejectRecovery = false;
            await page.locator('#ksisAtAcknowledge').click(); await f.choose(true);
            await page.waitForFunction(() => !document.getElementById('ksisAtPreview').disabled
                && document.getElementById('ksisAtSource').textContent.includes('ผลบันทึกรอบก่อนยังไม่ยืนยัน'));
            assert.equal(await page.locator('#ksisAtFill').isDisabled(), true, 'No consumed preview can be resent');
            assert.equal(await page.locator('#reportMonth').isEnabled(), true);
            await page.reload();
            await page.waitForFunction(() => document.getElementById('ksisAtSource').textContent.includes('ผลบันทึกรอบก่อนยังไม่ยืนยัน'));
            for (const [width, height] of [[1440, 1000], [1024, 768]]) {
                await page.setViewportSize({ width, height });
                assert.match(await page.locator('#ksisAtSource').innerText(), /เข้าสู่ระบบ KSIS.*เตรียม AT ใหม่/);
                assert.equal(await page.locator('#ksisAtPreview').isEnabled(), true);
                assert.equal(await page.locator('#ksisAtFill').isDisabled(), true);
            }
            assert.deepEqual(f.writes().map(request => request.path), ['/ksis/at/acknowledge', '/ksis/at/acknowledge']);
            assert.deepEqual(readKsisWorkspace(userId).tools.at.result, oldResult, 'Previous attempt history is preserved');
            await page.locator('#ksisAtPreview').click();
            await page.waitForFunction(() => document.getElementById('ksisAtSource').textContent === 'กรุณาเข้าสู่ระบบ KSIS แล้วเตรียมใหม่');
            assert.equal(await page.locator('#ksisAtFill').isDisabled(), true);
            assert.equal(f.writes().at(-1).path, '/ksis/at/preview', 'A later normal login prompt keeps its usual behavior');
            assert.deepEqual(f.errors, []);
        } finally { await f.close(); }
    });
