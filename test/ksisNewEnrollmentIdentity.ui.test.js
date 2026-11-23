import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planKsisReportDraft } from '../services/ksisReportDraft.js';
import { planKsisAt } from '../services/ksisAtEntry.js';
import { controlFixture } from './support/controlFixture.js';

for (const embedded of [false, true]) for (const view of ['draft', 'at']) test(`KSIS ${view} previews N/EO/IT by identity and distinguishes off-page children (${embedded ? 'desktop' : 'browser'})`, {
  skip: process.env.TEST_BROWSER_UI !== '1', timeout: 25000
}, async () => {
  const period = { month: 10, year: 2026 };
  const field = (value, options = []) => ({ value, options, writable: true });
  const records = ['N', 'EO', 'IT'].map((Status1, index) => ({ ID: index + 1, StudentId: index + 100, Subject: 'ME', Status1,
    'รหัสคุมอง': index === 0 ? '' : index === 1 ? '123456789' : '7642650000002',
    'ชื่อจริง': `เด็ก${Status1}`, 'นามสกุล': 'ทดสอบ', 'วันเกิด': '18/09/2020', CurrentLevel: 'C90', WksUsed: 8,
    TestType: 'AT', DateTest: '10/10/2026', LevelTest: 'C', Time: 4, Score: 100, Group: 1 }));
  const targets = records.map(source => ({ key: `student-${source.ID}`, studentKey: `header:${source.ID}`, kumonId: '7642650000001',
    fullName: `${source['ชื่อจริง']} ทดสอบ`, birthDate: '18/09/2563', subject: 'ME', dirty: false,
    level: field('C', ['C']), worksheet: field('90', ['90']), used: field('8'), status: field(source.Status1, ['N', 'EO', 'IT']),
    tests: [{ key: `test-${source.ID}`, subject: 'ME', date: field(''), level: field('', [{ label: 'C', value: 'C' }]),
      time: field(''), score: field(''), group: field(''), passed: false, dirty: false, error: '' }] }));
  records.push({ ...records[0], ID: 4, StudentId: 104, 'ชื่อจริง': 'เด็กอยู่อีกหน้า' },
    { ...records[0], ID: 5, StudentId: 105, 'ชื่อจริง': 'เด็กวันเกิดไม่ครบ', 'วันเกิด': '' });
  const doc = { context: 'ชื่อศูนย์ TEST ประจำเดือน Oct - 2026', page: 1, modalOpen: false,
    subjectLabel: 'Math', editable: true, rows: targets, students: targets };
  const rows = view === 'draft' ? planKsisReportDraft(records, doc, period, 'ME', { includeZun: false }) : planKsisAt(records, doc, period, 'ME');
  const f = await controlFixture('ksis', async (req, res) => {
    if (req.path === '/ksis/desktop/open') {
      res.json({ success: true, embedded: true }); return true;
    }
    if (req.path === `/ksis/${view}/preview`) {
      res.json({ success: true, previewId: `new-${view}`, rows, context: doc.context, page: 1, subject: 'ME', period }); return true;
    }
    return false;
  }, { embedded });
  try {
    const { page } = f;
    if (view === 'at') await page.locator('#ksisAtButton').click();
    await page.locator(view === 'draft' ? '#ksisDraftPreview' : '#ksisAtPreview').click();
    const selector = view === 'draft' ? '[data-confirm-identity]' : '[data-at-identity]';
    const container = page.locator(view === 'draft' ? '#ksisDraftRows' : '#ksisAtRows');
    await container.getByText('จับคู่ชื่อและวันเกิดตรงกันแล้ว', { exact: true }).first().waitFor();
    assert.equal(await page.locator(selector).count(), 0);
    assert.equal(await container.locator('.match-conflict').count(), 1);
    assert.match(await container.innerText(), /เด็กวันเกิดไม่ครบ/);
    if (view === 'draft') {
      assert.doesNotMatch(await container.innerText(), /เด็กอยู่อีกหน้า/);
      assert.match(await page.locator('#ksisDraftSource').innerText(), /นอกหน้า 1 รายการ/);
    } else {
      const outside = container.locator('tr').filter({ hasText: 'เด็กอยู่อีกหน้า' });
      assert.equal(await outside.locator('.match-state').innerText(), 'ไม่อยู่ในหน้าปัจจุบัน');
      assert.match(await outside.locator('.match-state').getAttribute('class'), /match-info/);
    }
    const fill = page.locator(view === 'draft' ? '#ksisDraftFill' : '#ksisAtFill');
    assert.equal(await fill.isEnabled(), true);
    await fill.click();
    assert.equal(await page.locator(view === 'draft' ? '#ksisDraftDialog' : '#ksisAtDialog').isVisible(), true);
    assert.equal(f.requests.some(req => req.path.endsWith('/fill')), false);
    await page.locator(view === 'draft' ? '#ksisDraftCancel' : '#ksisAtCancel').click();
    assert.equal(f.requests.some(req => req.path.endsWith('/fill')), false);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});
