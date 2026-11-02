import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { controlFixture } from './support/controlFixture.js';

for (const embedded of [false, true]) for (const failFirst of [false, true]) {
  test(`Background receipt printing permits payment and isolates late ${failFirst ? 'failure' : 'success'} (${embedded ? 'desktop' : 'browser'})`, {
    skip: process.env.TEST_BROWSER_UI !== '1', timeout: 25000
  }, async () => {
    const prints = [], payments = [];
    const f = await controlFixture('payment', async (req, res) => {
      if (req.path === '/payment/printer-status') { res.json({ supported: true, connected: true, printerName: 'Fixture printer' }); return true; }
      if (req.path === '/payment/status') {
        res.json({ summary: {}, rows: [1, 2].map(id => ({ studentId: id, studentName: `Student ${id}`, sourceEnrollmentId: id * 10,
          subjects: 'ME', isPaid: false, expectedNetAmount: 1700 })) }); return true;
      }
      if (req.path === '/payment/receipt/preview') {
        const id = Number(req.body.enrollmentId) / 10;
        const details = [{ enrollmentId: id * 10, subjectCode: 'ME', subjectName: 'Math', currentLevelCode: 'A', isPaid: false,
          isSelected: true, tuitionFee: 1700, netAmount: 1700, discountAmount: 0 }];
        res.json({ paymentMethods: [{ paymentMethodId: 1, paymentMethodName: 'Cash' }], receipt: {
          billingId: null, studentId: id, studentName: `Student ${id}`, billingDate: req.body.billingDate,
          billingMonth: req.body.billingMonth, billingYear: req.body.billingYear, receiptBook: 1, receiptNo: id,
          paymentMethodId: 1, paymentMethodName: 'Cash', details, receiptDetails: details, totalAmount: 1700, discountAmount: 0, netAmount: 1700
        } }); return true;
      }
      if (req.path === '/payment/print-receipt') {
        prints.push({ body: req.body, res, finish(fail = false) {
          if (!res.writableEnded && !res.destroyed) res.status(fail ? 503 : 200).json(fail ? { error: 'Fixture printer failed' } : { success: true });
        } }); return true;
      }
      if (req.path === '/payment/receipt/payment') {
        payments.push(req.body); res.json({ success: true, billingId: 100, receipt: { billingId: 100 } }); return true;
      }
      return false;
    }, { embedded });
    async function waitPrint(count) {
      for (let attempt = 0; attempt < 200 && prints.length < count; attempt++) await delay(10);
      assert.equal(prints.length, count);
    }
    try {
      const { page } = f;
      await page.locator('[data-receipt-row-index="0"]').click();
      await page.locator('#receiptPrint:enabled').waitFor();
      await page.locator('#receiptPrint').click(); await waitPrint(1);
      assert.equal(await page.locator('#receiptReceivePayment').evaluate(button => button === document.activeElement), true);
      assert.doesNotMatch(await page.locator('#receiptPrint').innerText(), /กำลังพิมพ์/);
      await page.locator('#receiptPrint').dispatchEvent('click'); assert.equal(prints.length, 1);
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('#receiptConfirmAccept').evaluate(button => button === document.activeElement), true);
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.getElementById('receiptModal').classList.contains('hidden'));
      assert.equal(payments.length, 1); assert.equal(prints[0].res.writableEnded, false);
      await page.locator('[data-receipt-row-index="1"]').click();
      await page.locator('#receiptPrint:enabled').waitFor();
      await page.locator('#receiptPrint').click(); await waitPrint(2);
      assert.equal(prints[0].body.studentId, 1); assert.equal(prints[1].body.studentId, 2);
      assert.equal(prints[0].body.billingId, null, 'The original print payload must not change after payment');
      await page.keyboard.press('Enter');
      const firstDone = page.waitForResponse(response => response.url().includes('/print-receipt'));
      prints[0].finish(failFirst); await firstDone;
      await page.waitForFunction(() => document.getElementById('receiptConfirmAccept') === document.activeElement);
      assert.equal(await page.locator('#receiptConfirmDialog').evaluate(dialog => dialog.open), true);
      assert.equal(await page.locator('#receiptPrint').isDisabled(), true);
      if (failFirst) {
        await page.waitForFunction(() => document.getElementById('statusLine').textContent.includes('Student 1'));
        assert.match(await page.locator('#statusLine').innerText(), /1\/1.*Student 1.*Fixture printer failed/);
        assert.equal(await page.locator('#receiptMessage').isHidden(), true);
      }
      const secondDone = page.waitForResponse(response => response.url().includes('/print-receipt'));
      prints[1].finish(!failFirst); await secondDone;
      if (!failFirst) await page.waitForFunction(() => document.getElementById('receiptMessage').textContent.includes('Student 2'));
      assert.equal(await page.locator('#receiptConfirmAccept').evaluate(button => button === document.activeElement), true);
      await page.locator('#receiptConfirmDialog [value="cancel"]').click();
      assert.equal(payments.length, 1);
      assert.equal(await page.locator('#receiptReceivePayment').isEnabled(), true);
      assert.deepEqual(f.errors, []);
    } finally { for (const job of prints) job.finish(); await f.close(); }
  });
}
