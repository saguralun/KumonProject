import assert from 'node:assert/strict';
import { test } from 'node:test';
globalThis.window = { escapeHtml: String };
const { prependHistoryRows } = await import('../public/js/worksheet/worksheetHistory.js');
delete globalThis.window;

test('WS history keeps newly entered rows first even with an incorrect or backdated Receive Date', () => {
    const current = [{worksheetUsedId:12,worksheetDate:'2026-12-31'}, {worksheetUsedId:13,worksheetDate:'2026-10-01'}];
    const added = [{worksheetUsedId:14,worksheetDate:'2026-11-20'}, {worksheetUsedId:15,worksheetDate:'0092-03-20'}];
    const before = structuredClone({current,added});
    assert.deepEqual(prependHistoryRows(current,added,3).map(row=>row.worksheetUsedId),[15,14,13]);
    assert.deepEqual(prependHistoryRows(current,[],2).map(row=>row.worksheetUsedId),[13,12]);
    const sameDate = [{worksheetUsedId:20,worksheetDate:'2026-11-20'},{worksheetUsedId:21,worksheetDate:'2026-11-20'},
        {worksheetUsedId:22,worksheetDate:'92-03-20'}];
    assert.deepEqual(prependHistoryRows(sameDate,[],3).map(row=>row.worksheetUsedId),[22,21,20]);
    assert.deepEqual({current,added},before);
});
