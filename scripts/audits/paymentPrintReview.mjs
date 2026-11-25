import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { controlFixture } from '../../test/support/controlFixture.js';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const evidencePath = path.join(repository, 'test/reviews/2026-11-24/payment-evidence.json');
const clone = value => JSON.parse(JSON.stringify(value));
const sortedIds = ids => [...ids].map(Number).sort((a, b) => a - b);

// Imports are inert: only explicitly calling this function launches one browser.
// No production server, payment service, database or printer is called.
export async function runPaymentPrintReview() {
  assert.equal(path.resolve(process.cwd()), path.resolve(repository), 'Run from the KumonDB repository root');
  const catalog = ['ME', 'EFL', 'TRP'].map((subjectCode, index) => ({
    enrollmentId: 101 + index, subjectCode, subjectName: `Synthetic ${subjectCode}`,
    currentLevelCode: 'A', tuitionFee: 1700, registrationFee: 0,
    additionalFee: 0, discountAmount: 0, netAmount: 1700
  }));
  const student = { studentId: 900001, studentName: 'Synthetic Payment Review Student' };
  const paid = new Set();
  const report = {
    scenario: 'Print three subjects, deselect the third, then receive payment',
    syntheticOnly: true,
    setup: { billingDate: '2026-11-24', billingMonth: 12, billingYear: 2026,
      periodReason: 'Payment defaults to the following month after day 20.' },
    status: 'not-completed',
    mismatch: null,
    limitations: [
      'Observes actual browser HTTP requests against synthetic endpoints, not production persistence or physical printing.',
      'Payment requests contain enrollment IDs, not an amount; payment net is derived from the fixture catalog (1700 THB per subject).'
    ],
    catalog: clone(catalog),
    network: { fixtureOrigin: null, requests: [], blocked: [] },
    apiRequests: [], previewRequests: [], printRequests: [], paymentRequests: [],
    ui: {}
  };
  let fixture, failure, fixtureOrigin;
  const capture = req => ({
    sequence: report.apiRequests.length + 1,
    method: req.method,
    url: `http://${req.get('host')}${req.originalUrl}`,
    body: clone(req.body ?? null)
  });
  function selectedIds(body) {
    const ids = body.selectedEnrollmentIds == null ? catalog.map(row => row.enrollmentId) : body.selectedEnrollmentIds;
    assert.ok(Array.isArray(ids), 'Selection must be an array');
    assert.equal(new Set(ids).size, ids.length, 'Selection must not duplicate IDs');
    for (const id of ids) assert.ok(catalog.some(row => row.enrollmentId === id), `Unknown synthetic enrollment ${id}`);
    return ids.filter(id => !paid.has(id));
  }
  function receiptFor(body, billingId = null) {
    const selection = new Set(selectedIds(body));
    const details = catalog.map(row => ({ ...row, isPaid: paid.has(row.enrollmentId), isSelected: selection.has(row.enrollmentId) }));
    const receiptDetails = details.filter(row => row.isSelected);
    const netAmount = receiptDetails.reduce((sum, row) => sum + row.netAmount, 0);
    return {
      ...student, billingId, existingBillingId: null, alreadyPaid: paid.size === catalog.length,
      partiallyPaid: paid.size > 0 && paid.size < catalog.length,
      sourceEnrollmentId: 103, receiptBook: 90, receiptNo: 1,
      billingDate: body.billingDate, billingMonth: Number(body.billingMonth), billingYear: Number(body.billingYear),
      paymentMethodId: Number(body.paymentMethodId || 1), paymentMethodName: 'Cash',
      totalAmount: netAmount, discountAmount: 0, netAmount, details, receiptDetails
    };
  }
  function assertReceiptInput(body) {
    assert.equal(body.enrollmentId, 103);
    assert.equal(body.billingMonth, 12);
    assert.equal(body.billingYear, 2026);
    assert.equal(body.billingDate, '2026-11-24');
    assert.equal(Number(body.paymentMethodId || 1), 1);
  }

  try {
    assert.equal(catalog.length, 3);
    assert.ok(catalog.every(row => row.netAmount === 1700));
    // controlFixture navigates before returning. Use a source-free fixture page
    // first, so origin guards are installed before any Payment scripts execute.
    fixture = await controlFixture('api/payment/review-bootstrap', async (req, res) => {
      const origin = `http://${req.get('host')}`;
      assert.equal(new URL(origin).hostname, 'localhost');
      assert.notEqual(new URL(origin).port, '3000');
      if (fixtureOrigin) assert.equal(origin, fixtureOrigin);
      const request = capture(req);
      report.apiRequests.push(request);
      if (req.path === '/payment/review-bootstrap.html') {
        assert.equal(req.method, 'GET');
        res.type('html').send('<!doctype html><title>Synthetic review bootstrap</title>');
      } else if (req.path === '/system/update-check') {
        assert.equal(req.method, 'GET');
        // authClient's passive monitor stays entirely inside the fixture.
        res.json({ success: true, checked: false });
      } else if (req.path === '/payment/printer-status') {
        assert.equal(req.method, 'GET');
        res.json({ success: true, supported: true, connected: true, printerName: 'Synthetic sink (no hardware)' });
      } else if (req.path === '/payment/status') {
        assert.equal(req.method, 'GET');
        assert.equal(Number(req.query.billingMonth), 12);
        assert.equal(Number(req.query.billingYear), 2026);
        assert.equal(req.query.subject, 'ALL');
        const unpaidNetAmount = catalog.filter(row => !paid.has(row.enrollmentId)).reduce((sum, row) => sum + row.netAmount, 0);
        const paymentState = paid.size === 0 ? 'unpaid' : paid.size === 3 ? 'paid' : 'partial';
        const row = {
          ...student, sourceEnrollmentId: 103, paymentState, isPaid: paid.size === 3,
          isPartial: paymentState === 'partial', billingId: paid.size ? 700001 : null,
          subjects: catalog.map(item => `${item.subjectCode}${paid.has(item.enrollmentId) ? ' paid' : ''}`).join(', '),
          expectedNetAmount: 5100, unpaidNetAmount, netAmount: 5100 - unpaidNetAmount
        };
        const matches = req.query.status === 'all' || req.query.status === paymentState;
        res.json({ success: true, billingMonth: 12, billingYear: 2026,
          summary: { totalStudents: 1, paidStudents: Number(paymentState === 'paid'),
            partialStudents: Number(paymentState === 'partial'), unpaidStudents: Number(paymentState === 'unpaid'),
            expectedNetAmount: 5100, totalNetAmount: row.netAmount, unpaidNetAmount }, rows: matches ? [row] : [] });
      } else if (req.path === '/payment/receipt/preview') {
        assert.equal(req.method, 'POST');
        assertReceiptInput(req.body);
        assert.equal(req.body.existingBillingId, null, 'Scenario starts with a wholly unpaid student');
        report.previewRequests.push(request);
        res.json({ success: true, paymentMethods: [{ paymentMethodId: 1, paymentMethodName: 'Cash' }], receipt: receiptFor(req.body) });
      } else if (req.path === '/payment/print-receipt') {
        assert.equal(req.method, 'POST');
        assert.equal(req.body.studentId, student.studentId);
        assert.equal(req.body.studentName, student.studentName);
        assert.ok(Array.isArray(req.body.receiptDetails));
        for (const item of req.body.receiptDetails) {
          const known = catalog.find(row => row.enrollmentId === item.enrollmentId);
          assert.ok(known, 'Print request contains only synthetic enrollments');
          assert.equal(item.netAmount, known.netAmount);
        }
        assert.equal(req.body.netAmount, req.body.receiptDetails.reduce((sum, row) => sum + row.netAmount, 0));
        report.printRequests.push(request);
        // Acknowledge bytes received by a sink; never import/call printer code.
        res.json({ success: true });
      } else if (req.path === '/payment/receipt/payment') {
        assert.equal(req.method, 'POST');
        assertReceiptInput(req.body);
        const receipt = receiptFor(req.body, 700001);
        assert.ok(receipt.receiptDetails.length > 0, 'Payment must select unpaid synthetic subjects');
        report.paymentRequests.push(request);
        for (const detail of receipt.receiptDetails) paid.add(detail.enrollmentId);
        res.json({ success: true, billingId: receipt.billingId, receipt });
      } else {
        assert.fail(`Unexpected fixture API request: ${req.method} ${req.path}`);
      }
      return true;
    });
    const { page, origin } = fixture;
    fixtureOrigin = origin;
    report.network.fixtureOrigin = origin;
    assert.notEqual(new URL(origin).port, '3000');
    for (const request of await page.requests()) {
      assert.equal(new URL(request.url()).origin, origin, 'Bootstrap request must stay on fixture origin');
      report.network.requests.push({ method: request.method(), url: request.url() });
    }
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) {
        report.network.blocked.push({ method: request.method(), url: url.href });
        await route.abort('blockedbyclient');
        return;
      }
      if (url.pathname === '/payment.html') {
        const response = await route.fetch({ maxRedirects: 0 });
        assert.equal(response.status(), 200);
        // Only remove remote font/preconnect links. Payment markup and JS stay
        // unchanged; no receipt state, handlers or outgoing payloads are patched.
        const html = (await response.text()).replace(/<link\b[^>]*\bhref\s*=\s*["']https?:\/\/[^"']*["'][^>]*>/gi, '');
        await route.fulfill({ response, body: html });
        return;
      }
      await route.continue();
    });
    page.on('request', request => report.network.requests.push({ method: request.method(), url: request.url() }));
    await page.clock.setFixedTime(new Date('2026-11-24T10:00:00+07:00'));
    await page.goto(`${origin}/payment.html`);
    assert.equal(new URL(page.url()).origin, origin);
    await page.locator('[data-receipt-row-index="0"]').click();
    await page.locator('#receiptPrint:enabled').waitFor();
    assert.deepEqual(fixture.errors, []);
    assert.ok(report.previewRequests.length > 0);
    assert.equal(await page.locator('[data-receipt-enrollment]').count(), 3);
    assert.equal(await page.locator('[data-receipt-enrollment]:checked:not(:disabled)').count(), 3);
    report.ui.beforePrint = await page.locator('#receiptPaper .receipt-total').innerText();
    assert.match(report.ui.beforePrint, /5,100/);
    assert.equal(report.printRequests.length, 0);
    assert.equal(report.paymentRequests.length, 0);

    const responseFor = pathname => page.waitForResponse(response => response.url() === `${origin}${pathname}` && response.request().method() === 'POST');
    const printed = responseFor('/api/payment/print-receipt');
    await page.locator('#receiptPrint').click();
    assert.equal((await printed).status(), 200);
    assert.equal(report.printRequests.length, 1, 'One explicit Print action must reach the fixture');
    const initialPrint = report.printRequests[0];
    assert.equal(initialPrint.body.billingId, null, 'Print occurs before receiving payment');
    assert.deepEqual(sortedIds(initialPrint.body.receiptDetails.map(row => row.enrollmentId)), [101, 102, 103]);
    assert.equal(initialPrint.body.netAmount, 5100);
    assert.equal(report.paymentRequests.length, 0);

    await page.locator('[data-receipt-enrollment][value="103"]').uncheck();
    assert.equal(await page.locator('[data-receipt-enrollment]:checked:not(:disabled)').count(), 2);
    report.ui.afterDeselect = await page.locator('#receiptPaper .receipt-total').innerText();
    report.ui.printDisabledAfterDeselect = await page.locator('#receiptPrint').isDisabled();
    assert.match(report.ui.afterDeselect, /3,400/);
    await page.locator('#receiptReceivePayment').click();
    report.ui.confirmation = await page.locator('#receiptConfirmMessage').innerText();
    assert.match(report.ui.confirmation, /จำนวนวิชา: 2/);
    assert.match(report.ui.confirmation, /ยอดสุทธิ: 3,400/);
    assert.match(report.ui.confirmation, /Synthetic Payment Review Student/);
    assert.equal(report.paymentRequests.length, 0, 'Opening confirmation must not receive money');
    const received = responseFor('/api/payment/receipt/payment');
    await page.locator('#receiptConfirmAccept').click();
    assert.equal((await received).status(), 200);
    await page.waitForFunction(() => document.getElementById('receiptModal').classList.contains('hidden'));
    // Wait for the post-payment refresh so its requests/errors are included.
    await page.waitForFunction(() => document.getElementById('statusLine').textContent === 'พร้อมใช้งาน');
    assert.equal(report.paymentRequests.length, 1);
    const payment = report.paymentRequests[0];
    assert.deepEqual(sortedIds(payment.body.selectedEnrollmentIds), [101, 102]);
    assert.ok(initialPrint.sequence < payment.sequence, 'Print must precede payment');
    assert.equal(initialPrint.body.billingMonth, payment.body.billingMonth);
    assert.equal(initialPrint.body.billingYear, payment.body.billingYear);
    assert.equal(initialPrint.body.billingDate, payment.body.billingDate);
    assert.equal(Number(initialPrint.body.paymentMethodId), Number(payment.body.paymentMethodId));
    assert.deepEqual(fixture.errors, []);
    assert.deepEqual(report.network.blocked, [], 'No browser request may target another origin');
    for (const request of [...report.network.requests, ...report.apiRequests]) assert.equal(new URL(request.url).origin, origin);
    assert.ok(report.apiRequests.every(request => request.method === 'GET' || [
      '/api/payment/receipt/preview', '/api/payment/print-receipt', '/api/payment/receipt/payment'
    ].includes(new URL(request.url).pathname)), 'No unrelated writes are allowed');

    const printedIds = sortedIds(initialPrint.body.receiptDetails.map(row => row.enrollmentId));
    const paymentIds = sortedIds(payment.body.selectedEnrollmentIds);
    const paymentNetFromCatalog = paymentIds.reduce((sum, id) => sum + catalog.find(row => row.enrollmentId === id).netAmount, 0);
    const sameSubjects = JSON.stringify(printedIds) === JSON.stringify(paymentIds);
    const sameNet = Number(initialPrint.body.netAmount) === paymentNetFromCatalog;
    report.comparison = { printedIds, paymentIds, printedNet: initialPrint.body.netAmount, paymentNetFromCatalog, sameSubjects, sameNet };
    // Observation, not an expected assertion: a matching result is also valid.
    report.mismatch = !sameSubjects || !sameNet;
    report.status = 'completed';
  } catch (error) {
    failure = error;
    report.status = 'failed';
    report.mismatch = null;
    report.failure = { name: error.name, message: error.message, stack: error.stack };
  } finally {
    if (fixture) {
      report.fixtureErrors = clone(fixture.errors);
      try { await fixture.close(); } catch (error) {
        failure ||= error;
        report.status = 'failed';
        report.mismatch = null;
        report.cleanupFailure = { name: error.name, message: error.message };
      }
    }
  }
  report.generatedAt = new Date().toISOString();
  await fs.mkdir(path.dirname(evidencePath), { recursive: true });
  await fs.writeFile(evidencePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  if (failure) { failure.evidence = report; throw failure; }
  return report;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  runPaymentPrintReview().then(report => {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }).catch(error => {
    process.stdout.write(`${JSON.stringify(error.evidence || { status: 'failed', mismatch: null, error: error.message }, null, 2)}\n`);
    process.stderr.write(`Payment review failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
