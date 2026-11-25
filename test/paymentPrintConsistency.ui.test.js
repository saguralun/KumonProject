import assert from 'node:assert/strict';
import { test } from 'node:test';
import { controlFixture } from './support/controlFixture.js';
import { receiptSnapshot } from '../public/js/receiptSnapshot.js';

async function fixture(embedded, { holdPrint = false } = {}) {
    const prints = [], payments = [], held = [];
    const catalog = ['ME', 'EFL', 'TRP'].map((subjectCode, index) => ({
        enrollmentId: 101 + index, subjectCode, subjectName: subjectCode,
        currentLevelCode: 'A', tuitionFee: 1700, netAmount: 1700, discountAmount: 0
    }));
    const f = await controlFixture('payment', async (req, res) => {
        if (req.path === '/payment/printer-status') {
            res.json({ supported: true, connected: true, printerName: 'Synthetic sink' }); return true;
        }
        if (req.path === '/payment/status') {
            res.json({ summary: {}, rows: [{ studentId: 1, studentName: 'Synthetic student',
                sourceEnrollmentId: 103, isPaid: false, subjects: 'ME, EFL, TRP', expectedNetAmount: 5100 }] }); return true;
        }
        if (req.path === '/payment/receipt/preview') {
            const selected = new Set(req.body.selectedEnrollmentIds ?? catalog.map(item => item.enrollmentId));
            const details = catalog.map(item => ({ ...item, isPaid: false, isSelected: selected.has(item.enrollmentId) }));
            const receiptDetails = details.filter(item => item.isSelected);
            const netAmount = receiptDetails.reduce((total, item) => total + item.netAmount, 0);
            const method = Number(req.body.paymentMethodId || 1);
            res.json({ paymentMethods: [{ paymentMethodId: 1, paymentMethodName: 'Cash' }, { paymentMethodId: 2, paymentMethodName: 'Transfer' }],
                receipt: { billingId: null, studentId: 1, studentName: 'Synthetic student', receiptBook: 1, receiptNo: 21,
                    billingDate: req.body.billingDate, billingMonth: req.body.billingMonth, billingYear: req.body.billingYear,
                    paymentMethodId: method, paymentMethodName: method === 1 ? 'Cash' : 'Transfer',
                    details, receiptDetails, netAmount, totalAmount: netAmount, discountAmount: 0 } }); return true;
        }
        if (req.path === '/payment/print-receipt') {
            prints.push(req.body);
            if (holdPrint) held.push(() => { if (!res.writableEnded && !res.destroyed) res.json({ success: true }); });
            else res.json({ success: true });
            return true;
        }
        if (req.path === '/payment/receipt/payment') {
            payments.push(req.body);
            res.json({ success: true, billingId: 80, receipt: { billingId: 80 } }); return true;
        }
        return false;
    }, { embedded });
    return { ...f, prints, payments, held, close: async () => { held.forEach(release => release()); await f.close(); } };
}

for (const embedded of [false, true]) {
    const options = { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 45000 };
    test(`Printing locks the payment selection while a background job is pending (${embedded ? 'desktop' : 'browser'})`, options, async () => {
        const f = await fixture(embedded, { holdPrint: true });
        try {
            const { page } = f;
            await page.locator('[data-receipt-row-index]').click();
            await page.locator('#receiptPrint:enabled').waitFor();
            const sent = page.waitForRequest(request => request.url().includes('/print-receipt'));
            await page.locator('#receiptPrint').click(); await sent;
            assert.equal(await page.locator('[data-receipt-enrollment]:disabled').count(), 3);
            assert.equal(await page.locator('#receiptPaymentMethod').isDisabled(), true);
            assert.equal(await page.locator('#receiptEditPrinted').isDisabled(), true);
            assert.equal(await page.locator('#receiptReceivePayment').isEnabled(), true);
            // Programmatic stale change events must not alter a printed draft either.
            await page.locator('[data-receipt-enrollment][value="103"]').evaluate(input => {
                input.checked = false; input.dispatchEvent(new Event('change', { bubbles: true }));
            });
            assert.equal(await page.locator('[data-receipt-enrollment]:checked').count(), 3);
            await page.locator('#receiptReceivePayment').click();
            assert.match(await page.locator('#receiptConfirmMessage').innerText(), /จำนวนวิชา: 3/);
            assert.equal(await page.locator('#receiptConfirmAccept').evaluate(button => button === document.activeElement), true);
            await page.locator('#receiptConfirmAccept').click();
            await page.waitForFunction(() => document.getElementById('receiptModal').classList.contains('hidden'));
            assert.equal(f.payments.length, 1);
            assert.deepEqual(f.payments[0].selectedEnrollmentIds, [101, 102, 103]);
            assert.equal(f.payments[0].expectedReceiptSnapshot, receiptSnapshot(f.prints[0]));
            await page.waitForFunction(() => document.getElementById('statusLine').textContent.includes('Billing #80'));
            assert.deepEqual(f.errors, []);
        } finally { await f.close(); }
    });

    test(`Changing a printed draft requires explicit paper cancellation and a new print (${embedded ? 'desktop' : 'browser'})`, options, async () => {
        const f = await fixture(embedded);
        try {
            const { page } = f;
            await page.locator('[data-receipt-row-index]').click(); await page.locator('#receiptPrint:enabled').waitFor();
            const printed = page.waitForResponse(response => response.url().includes('/print-receipt'));
            await page.locator('#receiptPrint').click(); await printed;
            await page.locator('#receiptEditPrinted:enabled').waitFor();
            await page.locator('#receiptEditPrinted').click();
            assert.equal(await page.locator('#receiptConfirmDialog [value="cancel"]').evaluate(button => button === document.activeElement), true);
            await page.locator('#receiptConfirmDialog [value="cancel"]').click();
            assert.equal(await page.locator('#receiptPaymentMethod').isDisabled(), true);
            await page.locator('#receiptEditPrinted').click(); await page.locator('#receiptConfirmAccept').click();
            await page.locator('[data-receipt-enrollment][value="103"]:enabled').waitFor();
            await page.locator('[data-receipt-enrollment][value="103"]').uncheck();
            const changed = page.waitForResponse(response => response.url().includes('/receipt/preview'));
            await page.locator('#receiptPaymentMethod').selectOption('2'); await changed;
            assert.match(await page.locator('#receiptPaper .receipt-total').innerText(), /3,400/);
            assert.equal(await page.locator('#receiptReceivePayment').isDisabled(), true);
            await page.locator('#receiptReceivePayment').dispatchEvent('click');
            assert.equal(f.payments.length, 0);
            const reprinted = page.waitForResponse(response => response.url().includes('/print-receipt'));
            await page.locator('#receiptPrint').click(); await reprinted;
            await page.locator('#receiptReceivePayment').click(); await page.locator('#receiptConfirmAccept').click();
            await page.waitForFunction(() => document.getElementById('receiptModal').classList.contains('hidden'));
            assert.equal(f.prints.length, 2); assert.equal(f.prints[0].netAmount, 5100); assert.equal(f.prints[1].netAmount, 3400);
            assert.deepEqual(f.payments[0].selectedEnrollmentIds, [101, 102]);
            assert.equal(Number(f.payments[0].paymentMethodId), 2);
            assert.equal(f.payments[0].expectedReceiptSnapshot, receiptSnapshot(f.prints[1]));
            assert.deepEqual(f.errors, []);
        } finally { await f.close(); }
    });

    test(`Closing an unpaid printed draft warns about discarding its paper (${embedded ? 'desktop' : 'browser'})`, options, async () => {
        const f = await fixture(embedded);
        try {
            const { page } = f;
            await page.locator('[data-receipt-row-index]').click(); await page.locator('#receiptPrint:enabled').waitFor();
            const printed = page.waitForResponse(response => response.url().includes('/print-receipt'));
            await page.locator('#receiptPrint').click(); await printed;
            await page.locator('#receiptClose').click();
            assert.match(await page.locator('#receiptConfirmMessage').innerText(), /ยังไม่ได้รับเงิน.*ยกเลิกใช้กระดาษ/);
            await page.locator('#receiptConfirmDialog [value="cancel"]').click();
            assert.equal(await page.locator('#receiptModal').isVisible(), true);
            await page.locator('#receiptClose').click(); await page.locator('#receiptConfirmAccept').click();
            await page.waitForFunction(() => document.getElementById('receiptModal').classList.contains('hidden'));
            assert.equal(f.payments.length, 0);
            assert.deepEqual(f.errors, []);
        } finally { await f.close(); }
    });
}
