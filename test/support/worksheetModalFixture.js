import { controlFixture } from './controlFixture.js';

export async function worksheetModalFixture(embedded) {
    const config = { read: null, failSave: false, holdSave: null };
    const summary = { billingMonth: 11, billingYear: 2026, usedDays: 0, cpwsRecords: 0 };
    const row = id => ({ enrollmentId: id, studentName: `Modal child ${id}`, subjectCode: id === 12 ? 'TRP' : 'ME',
        currentLevelCode: 'A', latestWorksheetLabel: 'A101', latestPacketWorksheetNo: 101, latestWorksheetDate: '2026-11-20' });
    const f = await controlFixture('worksheet', async (req, res) => {
        if (req.path === '/worksheet/incomplete-ws') {
            if (config.read) return config.read(req, res);
            const regularPage = Number(req.query.regularPage || 1);
            res.json({ cutoffDate: '2026-11-21', regular: { rows: [row(regularPage === 1 ? 11 : 12)], page: regularPage, totalPages: 2, totalRows: 2 },
                kc: { rows: [row(13)], page: 1, totalPages: 1, totalRows: 1 } }); return true;
        }
        if (req.path.endsWith('/context')) {
            const id = Number(req.path.split('/')[3]);
            res.json({ enrollment: { enrollmentId: id, studentName: `Modal child ${id}`, subjectCode: 'ME', currentLevelMasterId: 1, currentLevelCode: 'A' }, studentEnrollments: [],
                defaults: { receiveDate: '2026-11-20', patternCode: 'daily10', mainWorksheetNo: 101 },
                patterns: [{ code: 'daily10', shortLabel: '10/day', suffixes: [1], dayOffsets: [0] }],
                worksheetOptions: { main: [{ worksheetNo: 101 }, { worksheetNo: 191 }], zun: [] }, history: [], worksheetMonthSummary: summary,
                completionState: { atCompletion: { canComplete: true, bypassWorksheet191: true, atMasterId: 5, maxScore: 100, maxTime: 10 },
                    latestAtCompletion: { atUsedId: 99, atMasterId: 5, levelMasterId: 1, levelCode: 'A', atDate: '2026-11-19', score: 75, usedTime: 5, atGroup: 1, isPass: false, maxScore: 100, maxTime: 10 } } }); return true;
        }
        if (req.path.endsWith('/worksheet-summary')) { res.json({ worksheetMonthSummary: summary }); return true; }
        if (req.path === '/worksheet/at-completion') {
            if (config.holdSave) await config.holdSave;
            res.status(config.failSave ? 503 : 200).json(config.failSave ? { error: 'Synthetic AT failure' } : { isPass: false, nextLevelMasterId: null }); return true;
        }
        return false;
    }, { embedded });
    return { ...f, config, row, load: id => f.page.evaluate(async id => (await import('/js/worksheet/worksheet.js')).loadEnrollmentContext(id), id || 11) };
}
