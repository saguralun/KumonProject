import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { controlFixture } from './support/controlFixture.js';

async function fixture(embedded, { partial = true, fullyPaid = false, holdReprint = false, missing = false } = {}) {
  const previews = [], prints = [], payments = [], held = [];
  const details = ['ME', 'EFL', 'TRP'].map((subjectCode, index) => ({ enrollmentId: 101 + index, subjectCode, subjectName: subjectCode,
    currentLevelCode: 'A', isPaid: fullyPaid || (partial && index < 2), isSelected: !(fullyPaid || (partial && index < 2)),
    paidBillingId: partial && index < 2 ? 71 : null, paidReceiptBook: partial && index < 2 ? 10 : null,
    paidReceiptNo: partial && index < 2 ? 42 : null, tuitionFee: 1700, discountAmount: 0, netAmount: 1700 }));
  const f = await controlFixture('payment', async (req, res) => {
    if (req.path === '/payment/printer-status') { res.json({ supported: true, connected: true, printerName: 'Fixture' }); return true; }
    if (req.path === '/payment/status') {
      res.json({ summary: {}, rows: [{ studentId: 1, studentName: 'Fixture Student', sourceEnrollmentId: 103, isPaid: fullyPaid,
        isPartial: partial && !fullyPaid, billingId: fullyPaid ? 71 : partial ? 70 : null, subjects: 'ME, EFL, TRP', expectedNetAmount: 5100, unpaidNetAmount: 1700 }] }); return true;
    }
    if (req.path === '/payment/receipt/preview') {
      previews.push(req.body);
      const existing = req.body.existingBillingId === 71 && !missing;
      const rows = details.map(detail => ({ ...detail, isSelected: existing ? detail.isPaid
        : !detail.isPaid && (!Array.isArray(req.body.selectedEnrollmentIds) || req.body.selectedEnrollmentIds.includes(detail.enrollmentId)) }));
      const receiptDetails = rows.filter(row => row.isSelected), netAmount = receiptDetails.reduce((sum, row) => sum + row.netAmount, 0);
      const data = { paymentMethods: [{ paymentMethodId: 1, paymentMethodName: 'Cash' }, { paymentMethodId: 2, paymentMethodName: 'Transfer' }], receipt: {
        billingId: existing ? 71 : null, existingBillingId: partial ? 71 : null, partiallyPaid: partial,
        studentId: 1, studentName: 'Fixture Student', receiptBook: existing ? 10 : 11, receiptNo: existing ? 42 : 99,
        billingDate: existing ? '2026-10-26' : req.body.billingDate, billingTime: existing ? '2026-10-26T10:30:00+07:00' : null,
        billingMonth: req.body.billingMonth, billingYear: req.body.billingYear, paymentMethodId: existing ? 1 : (req.body.paymentMethodId || 2),
        paymentMethodName: existing ? 'Cash' : 'Transfer', details: rows, receiptDetails, totalAmount: netAmount, discountAmount: 0, netAmount
      } };
      if (req.body.existingBillingId === 71 && holdReprint) held.push(() => { if (!res.destroyed) res.json(data); });
      else res.json(data);
      return true;
    }
    if (req.path === '/payment/print-receipt') { prints.push(req.body); res.json({ success: true }); return true; }
    if (req.path === '/payment/receipt/payment') { payments.push(req.body); res.json({ success: true, billingId: 72, receipt: { billingId: 72 } }); return true; }
    return false;
  }, { embedded });
  return { ...f, previews, prints, payments, held, close: async () => { for (const release of held) release(); await f.close(); } };
}

for (const embedded of [false, true]) {
  const options = { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 25000 };
  test(`Partial payment switches between the saved receipt and only newly checked subjects (${embedded ? 'desktop' : 'browser'})`, options, async () => {
    const f = await fixture(embedded);
    try {
      const { page } = f;
      await page.locator('[data-receipt-row-index]').click(); await page.locator('#receiptPrint:enabled').waitFor();
      assert.match(await page.locator('#receiptPaper .receipt-total').innerText(), /1,700/);
      assert.equal(await page.locator('#receiptPaymentMethod').inputValue(), '2');
      await page.locator('[data-receipt-enrollment][value="103"]').uncheck();
      await page.locator('#receiptPrint:enabled').waitFor();
      assert.equal(f.previews.at(-1).existingBillingId, 71, 'Use the actual period receipt, not an older row hint');
      assert.match(await page.locator('#receiptModalSubtitle').innerText(), /เล่ม 10 เลขที่ 42/);
      assert.match(await page.locator('#receiptPaper').innerText(), /26\/10\/2569/);
      assert.match(await page.locator('#receiptPaper .receipt-total').innerText(), /3,400/);
      assert.equal(await page.locator('#receiptReceivePayment').isHidden(), true);
      assert.equal(await page.locator('#receiptCancelPayment').isHidden(), true);
      assert.equal(await page.locator('[data-receipt-enrollment]:checked:disabled').count(), 2);
      assert.equal(await page.locator('[data-receipt-enrollment][value="103"]').isEnabled(), true);
      assert.equal(await page.locator('#receiptPrint').evaluate(button => button === document.activeElement), true);
      const printed = page.waitForResponse(response => response.url().includes('/print-receipt'));
      await page.locator('#receiptPrint').click(); await printed;
      assert.equal(f.prints[0].billingId, 71); assert.equal(f.prints[0].netAmount, 3400);
      assert.deepEqual(f.prints[0].receiptDetails.map(row => row.enrollmentId), [101, 102]);
      assert.equal(f.payments.length, 0);
      await page.locator('[data-receipt-enrollment][value="103"]').check();
      assert.match(await page.locator('#receiptModalSubtitle').innerText(), /เล่ม 11 เลขที่ 99/);
      assert.match(await page.locator('#receiptPaper .receipt-total').innerText(), /1,700/);
      assert.equal(await page.locator('#receiptPaymentMethod').inputValue(), '2');
      assert.equal(await page.locator('#receiptReceivePayment').isVisible(), true);
      assert.equal(await page.locator('#receiptPrint').isEnabled(), true);
      await page.locator('#receiptReceivePayment').click();
      assert.match(await page.locator('#receiptConfirmMessage').innerText(), /จำนวนวิชา: 1/);
      assert.equal(await page.locator('#receiptConfirmAccept').evaluate(button => button === document.activeElement), true);
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.getElementById('receiptModal').classList.contains('hidden'));
      assert.deepEqual(f.payments[0].selectedEnrollmentIds, [103]); assert.equal(f.payments[0].paymentMethodId, '2');
      assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  });

  test(`A late saved-receipt response cannot replace newly selected extra billing (${embedded ? 'desktop' : 'browser'})`, options, async () => {
    const f = await fixture(embedded, { holdReprint: true });
    try {
      const { page } = f;
      await page.locator('[data-receipt-row-index]').click(); await page.locator('#receiptPrint:enabled').waitFor();
      await page.locator('[data-receipt-enrollment][value="103"]').uncheck();
      for (let attempt = 0; attempt < 200 && !f.held.length; attempt++) await delay(10);
      assert.equal(f.held.length, 1); assert.equal(await page.locator('#receiptPrint').isDisabled(), true);
      assert.equal(await page.locator('#receiptPaymentControls').isHidden(), true);
      await page.locator('[data-receipt-enrollment][value="103"]').check();
      const completed = page.waitForResponse(response => response.url().includes('/receipt/preview'));
      f.held[0](); await completed;
      assert.match(await page.locator('#receiptModalSubtitle').innerText(), /เล่ม 11 เลขที่ 99/);
      assert.match(await page.locator('#receiptPaper .receipt-total').innerText(), /1,700/);
      assert.equal(await page.locator('#receiptReceivePayment').isEnabled(), true);
      assert.equal(f.payments.length, 0); assert.equal(f.prints.length, 0); assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  });

  test(`No saved receipt leaves printing blocked and allows returning to extra billing (${embedded ? 'desktop' : 'browser'})`, options, async () => {
    const f = await fixture(embedded, { missing: true });
    try {
      const { page } = f;
      await page.locator('[data-receipt-row-index]').click(); await page.locator('#receiptPrint:enabled').waitFor();
      await page.locator('[data-receipt-enrollment][value="103"]').uncheck();
      await page.waitForFunction(() => document.getElementById('receiptMessage').textContent.includes('ไม่พบใบเสร็จเดิม'));
      assert.equal(await page.locator('#receiptPrint').isDisabled(), true);
      await page.locator('[data-receipt-enrollment][value="103"]').check();
      assert.equal(await page.locator('#receiptReceivePayment').isEnabled(), true);
      assert.equal(await page.locator('#receiptPrint').isEnabled(), true);
      assert.equal(f.payments.length, 0); assert.equal(f.prints.length, 0); assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  });

  test(`A wholly unpaid empty selection never invents a reprint or prints zero (${embedded ? 'desktop' : 'browser'})`, options, async () => {
    const f = await fixture(embedded, { partial: false });
    try {
      const { page } = f;
      await page.locator('[data-receipt-row-index]').click(); await page.locator('#receiptPrint:enabled').waitFor();
      for (const id of [101, 102, 103]) await page.locator(`[data-receipt-enrollment][value="${id}"]`).uncheck();
      assert.equal(await page.locator('#receiptPrint').isDisabled(), true);
      assert.equal(await page.locator('#receiptReceivePayment').isDisabled(), true);
      assert.equal(f.previews.length, 1);
      await page.locator('[data-receipt-enrollment][value="103"]').check();
      assert.equal(await page.locator('#receiptReceivePayment').isEnabled(), true);
      assert.equal(await page.locator('#receiptPrint').isEnabled(), true);
      assert.equal(f.payments.length, 0); assert.equal(f.prints.length, 0); assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  });

  test(`Closing a pending reprint keeps its response out of the next receipt (${embedded ? 'desktop' : 'browser'})`, options, async () => {
    const f = await fixture(embedded, { holdReprint: true });
    try {
      const { page } = f;
      await page.locator('[data-receipt-row-index]').click(); await page.locator('#receiptPrint:enabled').waitFor();
      await page.locator('[data-receipt-enrollment][value="103"]').uncheck();
      for (let attempt = 0; attempt < 200 && !f.held.length; attempt++) await delay(10);
      assert.equal(f.held.length, 1);
      await page.locator('#receiptClose').click();
      await page.locator('[data-receipt-row-index]').click(); await page.locator('#receiptPrint:enabled').waitFor();
      const completed = page.waitForResponse(response => response.url().includes('/receipt/preview'));
      f.held[0](); await completed;
      assert.match(await page.locator('#receiptModalSubtitle').innerText(), /เล่ม 11 เลขที่ 99/);
      assert.equal(await page.locator('[data-receipt-enrollment][value="103"]').isChecked(), true);
      assert.equal(await page.locator('#receiptReceivePayment').isEnabled(), true);
      assert.equal(f.payments.length, 0); assert.equal(f.prints.length, 0); assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  });

  test(`Fully paid receipts retain their original reprint and cancellation controls (${embedded ? 'desktop' : 'browser'})`, options, async () => {
    const f = await fixture(embedded, { fullyPaid: true });
    try {
      const { page } = f;
      await page.locator('[data-receipt-row-index]').click(); await page.locator('#receiptPrint:enabled').waitFor();
      assert.equal(f.previews[0].existingBillingId, 71);
      assert.equal(await page.locator('#receiptSubjectPicker').isHidden(), true);
      assert.equal(await page.locator('#receiptReceivePayment').isHidden(), true);
      assert.equal(await page.locator('#receiptCancelPayment').isVisible(), true);
      assert.match(await page.locator('#receiptPaper .receipt-total').innerText(), /5,100/);
      await page.locator('#receiptCancelPayment').click();
      assert.equal(await page.locator('#receiptConfirmDialog [value="cancel"]').evaluate(button => button === document.activeElement), true);
      await page.keyboard.press('Escape');
      assert.equal(f.payments.length, 0); assert.equal(f.prints.length, 0); assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  });
}
