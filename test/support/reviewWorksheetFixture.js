import { controlFixture } from './controlFixture.js';

export async function reviewWorksheetFixture(embedded) {
  const config = { rejectNumber: true, holdNumber: null, rejectHistory: false, rejectContext: false, transformContext: null };
  const summary = { billingMonth: 11, billingYear: 2026, usedDays: 1, cpwsRecords: 1 };
  const rows = new Map();
  const entry = id => ({ worksheetUsedId: id * 10, enrollmentId: id, worksheetMasterId: 101, actualWorksheetNo: 101,
    worksheetDate: '2026-11-20', levelMasterId: 1, levelCode: 'A', worksheetType: 'WS', packetWorksheetNo: 101, worksheetLabel: 'A101', cpws: true, isStockProcessed: false });
  const context = id => {
    if (!rows.has(id)) rows.set(id, entry(id));
    return { enrollment: { enrollmentId: id, studentName: `Review child ${id}`, subjectCode: 'ME', currentLevelMasterId: 1, currentLevelCode: 'A',
      currentZunLevelMasterId: 3, currentZunLevelCode: 'ZI', isKumonConnect: id === 2 },
      studentEnrollments: [1, 2].map(enrollmentId => ({ enrollmentId, studentName: `Review child ${enrollmentId}`, subjectCode: enrollmentId === 1 ? 'ME' : 'EFL', currentLevelCode: 'A' })),
      defaults: { receiveDate: '2026-11-20', patternCode: 'daily10', mainWorksheetNo: 101 },
      patterns: [{ code: 'daily10', shortLabel: '10/day', suffixes: [1], dayOffsets: [0] }],
      worksheetOptions: { main: [{ worksheetNo: 101 }, { worksheetNo: 191 }], zun: [{ worksheetNo: 1 }, { worksheetNo: 91 }] },
      history: [rows.get(id), { ...rows.get(id), worksheetUsedId: id * 10 + 1, isStockProcessed: true }], worksheetMonthSummary: summary,
      completionState: { atCompletion: { canComplete: id === 2, hasAtMaster: true, hasWorksheet191: false, bypassWorksheet191: id === 2, atMasterId: 5, maxScore: 100, maxTime: 10, nextLevelMasterId: 2 },
        freeLevelCompletion: { canComplete: false, hasWorksheet191: false, nextLevelMasterId: 2 },
        zunCompletion: { canComplete: false, currentZunLevelMasterId: 3, currentZunLevelCode: 'ZI', nextZunLevelMasterId: 4, nextZunLevelCode: 'ZII' } } };
  };
  const f = await controlFixture('worksheet', async (req, res) => {
    if (req.path.endsWith('/context')) {
      const id = Number(req.path.split('/')[3]);
      if (id === 2 && config.rejectContext) res.status(503).json({ error: 'Synthetic context unavailable' });
      else {
        const data = context(id); if (config.transformContext) config.transformContext(data, id);
        res.json(data);
      } return true;
    }
    if (req.path.endsWith('/worksheet-summary')) { res.json({ worksheetMonthSummary: summary }); return true; }
    if (req.path.endsWith('/history')) {
      if (config.rejectHistory) res.status(503).json({ error: 'Synthetic history unavailable' });
      else res.json({ history: context(Number(req.path.split('/')[3])).history, worksheetMonthSummary: summary }); return true;
    }
    if (req.path === '/worksheet/entries/10/number') {
      if (config.holdNumber) await config.holdNumber;
      if (config.rejectNumber) res.status(409).json({ error: 'Synthetic number rejection' });
      else {
        const previous = rows.get(1), value = req.body.worksheetNo;
        const saved = { ...previous, actualWorksheetNo: value, worksheetMasterId: 21, packetWorksheetNo: 21, worksheetLabel: `A${value}` };
        rows.set(1, saved); res.json({ entry: saved });
      }
      return true;
    }
    if (req.path === '/worksheet/entries/10/date') {
      const saved = { ...rows.get(1), worksheetDate: req.body.worksheetDate }; rows.set(1, saved); res.json({ entry: saved }); return true;
    }
    return false;
  }, { embedded });
  return { ...f, config, rows, async load(id = 1) {
    await f.page.evaluate(async id => (await import('/js/worksheet/worksheet.js')).loadEnrollmentContext(id), id);
    await f.page.waitForFunction(() => document.activeElement?.matches('[data-ws-input]'));
  } };
}
