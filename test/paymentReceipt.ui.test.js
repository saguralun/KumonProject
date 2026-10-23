import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { once } from 'node:events';
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApplicationDesktop } from '../services/ksisDesktop.js';

for (const embedded of [false, true]) test(`Choosing two of three subjects, cancellation and visible payment errors (${embedded ? 'integrated app' : 'browser'})`, { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 30000 }, async () => {
    const app = express(); app.use(express.static('public'));
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    let browser, desktop, root;
    try {
        const paid = new Set(), payments = [], errors = []; let rejectNext = true;
        const handler = (route) => {
            const pathname = new URL(route.request().url()).pathname;
            let data = { success: true };
            if (pathname === '/api/auth/me') data = { user: { role: 'admin' }, permissions: ['*'] };
            if (pathname === '/api/payment/printer-status') data = { success: true, supported: false };
            if (pathname === '/api/payment/status') data = { success: true, billingMonth: 10, billingYear: 2026,
                summary: {}, rows: [{ studentId: 1, studentName: 'Test Student', sourceEnrollmentId: 103, subjects: 'ME, EFL, TRP', isPaid: false, isPartial: paid.size > 0, expectedNetAmount: 5100, unpaidNetAmount: 1700 }] };
            if (pathname === '/api/payment/receipt/preview') {
                const body = route.request().postDataJSON();
                assert.equal(body.existingBillingId, null);
                const details = ['ME', 'EFL', 'TRP'].map((subjectCode, index) => ({ enrollmentId: 101 + index, subjectCode, subjectName: subjectCode, currentLevelCode: 'A',
                    isPaid: paid.has(101 + index), isSelected: !paid.has(101 + index), tuitionFee: 1700, netAmount: 1700, discountAmount: 0 }));
                data = { success: true, paymentMethods: [{ paymentMethodId: 1, paymentMethodName: 'Cash' }], receipt: {
                    billingId: null, studentId: 1, studentName: 'Test Student', billingDate: '2026-10-23', billingMonth: 10, billingYear: 2026,
                    receiptBook: 1, receiptNo: 1, paymentMethodId: 1, paymentMethodName: 'Cash', details, receiptDetails: details.filter((row) => row.isSelected), totalAmount: (3 - paid.size) * 1700, netAmount: (3 - paid.size) * 1700 } };
            }
            if (pathname === '/api/payment/receipt/payment') {
                const body = route.request().postDataJSON(); payments.push(body);
                if (rejectNext) { rejectNext = false; return route.fulfill({ status: 409, contentType: 'application/json', body: '{"success":false,"error":"Fixture payment rejected"}' }); }
                for (const id of body.selectedEnrollmentIds) paid.add(id);
                data = { success: true, billingId: 20 + payments.length, receipt: { billingId: 20 + payments.length } };
            }
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
        };
        const origin = `http://localhost:${server.address().port}`;
        let page;
        if (embedded) {
            root = await fs.mkdtemp(path.join(os.tmpdir(), 'kumondb-payment-test-'));
            desktop = await createApplicationDesktop({ origin, profileDirectory: root, startPath: '/payment.html', configureContext: (context) => context.route('**/api/**', handler) });
            page = desktop.main;
        } else {
            browser = await chromium.launch({ channel: 'chrome', headless: true, chromiumSandbox: true });
            page = await browser.newPage(); await page.route('**/api/**', handler);
            await page.goto(`${origin}/payment.html`);
        }
        page.on('pageerror', (error) => errors.push(error.message));
        await page.locator('[data-receipt-row-index]').click();
        await page.locator('[data-receipt-enrollment][value="103"]').uncheck();
        assert.equal(await page.locator('[data-receipt-enrollment]:checked').count(), 2);
        assert.match(await page.locator('#receiptPaper .receipt-total').innerText(), /3,400/);
        await page.locator('#receiptReceivePayment').click();
        assert.match(await page.locator('#receiptConfirmMessage').innerText(), /จำนวนวิชา: 2/);
        assert.equal(payments.length, 0);
        await page.screenshot({ path: path.join(os.tmpdir(), `kumondb-partial-payment-confirm-${embedded}.png`), fullPage: true });
        await page.evaluate(() => {
            const input = document.querySelector('[data-receipt-enrollment][value="101"]');
            input.checked = false; input.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await page.locator('#receiptConfirmAccept').click();
        await page.locator('#receiptMessage').waitFor();
        assert.match(await page.locator('#receiptMessage').innerText(), /เปลี่ยนระหว่างยืนยัน/);
        assert.equal(payments.length, 0);
        await page.locator('[data-receipt-enrollment][value="101"]').check();
        await page.locator('#receiptReceivePayment').click();
        await page.keyboard.press('Escape');
        assert.equal(payments.length, 0);
        await page.locator('#receiptReceivePayment').click();
        await page.locator('#receiptConfirmAccept').click();
        await page.locator('#receiptMessage').waitFor();
        assert.match(await page.locator('#receiptMessage').innerText(), /Fixture payment rejected/);
        assert.equal(await page.locator('#receiptReceivePayment').isEnabled(), true);
        assert.equal(await page.locator('[data-receipt-enrollment]:checked').count(), 2);
        await page.screenshot({ path: path.join(os.tmpdir(), `kumondb-partial-payment-error-${embedded}.png`), fullPage: true });
        await page.locator('#receiptReceivePayment').click();
        await page.locator('#receiptConfirmAccept').click();
        await page.waitForFunction(() => document.getElementById('receiptModal').classList.contains('hidden'));
        assert.deepEqual(payments.map((item) => item.selectedEnrollmentIds), [[101, 102], [101, 102]]);
        await page.locator('[data-receipt-row-index]').click();
        await page.locator('[data-receipt-enrollment][value="103"]').waitFor();
        assert.equal(await page.locator('[data-receipt-enrollment]:checked:not(:disabled)').count(), 1);
        assert.equal(await page.locator('[data-receipt-enrollment][value="101"]').isDisabled(), true);
        await page.locator('#receiptReceivePayment').click();
        await page.locator('#receiptConfirmAccept').click();
        await page.waitForFunction(() => document.getElementById('receiptModal').classList.contains('hidden'));
        assert.deepEqual(payments[2].selectedEnrollmentIds, [103]);
        assert.deepEqual(errors, []);
    } finally {
        await desktop?.application.close(); await browser?.close(); await new Promise((resolve) => server.close(resolve));
        if (root) await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
});
