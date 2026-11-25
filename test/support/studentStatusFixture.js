import { controlFixture } from './controlFixture.js';

export async function studentStatusFixture(embedded, initialStatus = 'A') {
  const config = { status: initialStatus, failRead: false, holdDate: null, hold: null, staleOnce: false, revision: 1 };
  const statuses = ['C', 'A', 'R', 'N', 'EO', 'OT', 'CP'].map((code, index) => ({ id: index + 1, code, group: 1, name: code }));
  const student = { studentId: 1, firstName: 'Preview', lastName: 'Child', displayName: 'Preview Child', prefixId: 1, genderId: 1, schoolGradeId: 1 };
  const profile = () => ({ student, enrollments: [{ enrollmentId: 10, subjectId: 1, subjectCode: 'ME', currentLevelMasterId: 1, currentLevelCode: 'A',
    startingWorksheetMasterId: 1, enStartDate: '2026-01-01', currentStatusGroup1Id: statuses.find(s => s.code === config.status).id, statusGroup1Code: config.status }] });
  const masters = { prefixes: [{ id: 1, name: 'ด.ช.' }], genders: [{ id: 1, name: 'ชาย' }], grades: [{ id: 1, label: 'PK3' }], subjects: [{ id: 1, code: 'ME', name: 'Math' }],
    statuses, levels: [{ id: 1, subjectId: 1, code: 'A', type: 1 }], worksheets: [{ id: 1, levelMasterId: 1, worksheetNo: 1 }], schedules: [], dtMasters: [], studentHints: {}, addressRows: [] };
  const f = await controlFixture('student-manager', async (req, res) => {
    if (req.path === '/students/masters') { res.json({ masters }); return true; }
    if (req.path === '/students/search') { res.json({ rows: [student] }); return true; }
    if (req.path === '/students/1') { res.json(profile()); return true; }
    if (req.path.endsWith('/status-preview')) {
      const action = req.query.action, date = req.query.resumeDate || null, revision = config.revision;
      const statusCode = action === 'resume' ? date >= '2026-11-21' ? 'N' : 'R' : 'A';
      if (date === config.holdDate && config.hold) await config.hold;
      if (config.failRead) { res.status(503).json({ error: 'Fixture Preview unavailable' }); return true; }
      res.json({ preview: { fingerprint: `preview-${revision}-${action}-${date}`, action, resumeDate: date, statusCode,
        period: { month: action === 'resume' ? date >= '2026-11-21' ? 12 : 11 : 8, year: 2026 }, periodSource: action === 'resume' ? 'resume_date' : 'next_billing',
        latestPeriod: { month: 7, year: 2026 }, missedMonths: action === 'resume' ? 4 : null,
        startDate: statusCode === 'N' ? date : '2026-01-01', changesStartDate: statusCode === 'N', halfMonth: date === '2026-11-20' } }); return true;
    }
    if (req.path.endsWith('/status-action')) {
      if (config.staleOnce) { config.staleOnce = false; config.revision++; res.status(409).json({ error: 'ข้อมูลสำหรับเปลี่ยนสถานะเปลี่ยนแล้ว กรุณาตรวจสรุปใหม่ก่อนยืนยัน' }); return true; }
      config.status = req.body.action === 'resume' ? 'R' : 'A';
      res.json({ profile: profile(), enrollmentId: 10, message: 'Fixture status saved' }); return true;
    }
    return false;
  }, { embedded });
  return { ...f, config, async load() {
    await f.page.locator('#studentSearch').fill('Preview');
    await f.page.locator('[data-student-id="1"]').click();
    await f.page.waitForFunction(() => document.querySelector('#enrollmentForm [name=enrollmentId]').value === '10');
    await f.page.locator('#enrollmentActionBar').evaluate(bar => { bar.closest('details').open = true; });
  } };
}
