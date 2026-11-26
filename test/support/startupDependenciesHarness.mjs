import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';
import * as childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

// This subprocess renders buffers and workbooks only. No printer, browser,
// backup command or production database can be invoked by the fixture.
for (const name of ['exec', 'execFile', 'execFileSync', 'execSync', 'spawn', 'spawnSync', 'fork']) {
    childProcess.default[name] = () => assert.fail('External process forbidden in dependency fixture');
}
syncBuiltinESMExports();
const require = createRequire(import.meta.url);
const loaded = name => Object.keys(require.cache).some(file => file.replaceAll('\\', '/').includes(`/node_modules/${name}/`));
const raw = await import('../../services/printerRawService.js');
const excel = await import('../../services/excelExportService.js');
assert.equal(loaded('@napi-rs/canvas'), false, 'Receipt imports must not load the native canvas');
assert.equal(loaded('exceljs'), false, 'Export imports must not load ExcelJS');

const sample = { center: { centerName: 'FIXTURE ONLY' }, studentName: 'Fixture Student', studentId: 1, receiptBook: 2, receiptNo: 3,
    billingDate: '2026-11-26', billingMonth: 11, billingYear: 2026, paymentMethodName: 'Cash', totalAmount: 850, netAmount: 850,
    receiptDetails: [{ subjectCode: 'ME', enrollmentId: 1, currentLevelCode: 'A', tuitionFee: 850, registrationFee: 0, netAmount: 850 }] };
const ascii = raw.buildReceiptPayload(sample);
assert.ok(ascii.includes(Buffer.from('850.00 THB')));
assert.equal(loaded('@napi-rs/canvas'), false, 'ASCII receipts do not need canvas');

const load = Module._load;
let attempts = 0;
Module._load = function (id, ...args) {
    if (id === '@napi-rs/canvas' && attempts++ === 0) throw Error('Synthetic first canvas load failed');
    return load.call(this, id, ...args);
};
try {
    assert.throws(() => raw.buildReceiptPayload({ ...sample, studentName: 'นักเรียน ทดสอบ (ตัวอย่าง)' }), /Synthetic/);
    const thai = raw.buildReceiptPayload({ ...sample, studentName: 'นักเรียน ทดสอบ (ตัวอย่าง)' });
    assert.equal(loaded('@napi-rs/canvas'), true);
    assert.ok(thai.includes(Buffer.from([0x1d, 0x76, 0x30, 0x00])), 'Thai receipt still contains an ESC/POS bitmap');
    assert.deepEqual(thai, raw.buildReceiptPayload({ ...sample, studentName: 'นักเรียน ทดสอบ (ตัวอย่าง)' }));
} finally { Module._load = load; }

const [flat, pivot] = await Promise.all([
    excel.buildFlatWorkbook({ sheetName: 'Fixture', columns: ['Subject', 'Amount'], rows: [['ME', 850]] }),
    excel.buildPivotWorkbook([{ name: 'Fixture pivot', columns: ['1'], rows: [{ label: 'A', values: { '1': 2 }, total: 2 }], columnTotals: { '1': 2 }, grandTotal: 2 }])
]);
assert.equal(loaded('exceljs'), true);
const ExcelJS = (await import('exceljs')).default;
for (const book of [flat, pivot]) {
    const parsed = new ExcelJS.Workbook(); await parsed.xlsx.load(await book.xlsx.writeBuffer());
    assert.equal(parsed.worksheets.length, 1);
    assert.ok(parsed.worksheets[0].rowCount >= 2);
}
console.log(JSON.stringify({ lazyImports: true, asciiAndThaiReceipts: true, failedCanvasLoadRetry: true, concurrentExports: true, actualPrintOrDatabaseCalls: false }));
