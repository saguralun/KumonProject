import assert from 'node:assert/strict';
import { test } from 'node:test';
import { completionControlHelp } from '../public/js/worksheet/worksheetCompletionHelp.js';

test('Completion explanations distinguish missing packets, missing AT, free levels and KC without changing eligibility', () => {
  const cases = [
    [{ kind: 'main', at: { hasAtMaster: true }, mainAllowed: false }, /191/],
    [{ kind: 'main', at: { hasAtMaster: false }, mainAllowed: false }, /ไม่มีข้อมูล AT/],
    [{ kind: 'main', at: { hasAtMaster: false }, free: { isFreeCompletionLevel: true, nextLevelMasterId: 2 } }, /191.*ไม่สอบ AT/],
    [{ kind: 'main', at: { hasAtMaster: false }, free: { isFreeCompletionLevel: true, nextLevelMasterId: null } }, /ไม่มีระดับถัดไป/],
    [{ kind: 'main', at: { bypassWorksheet191: true }, mainAllowed: true }, /KC/],
    [{ kind: 'zun', hasZun: true, zunAllowed: false }, /91/],
    [{ kind: 'zun', hasZun: false }, /ยังไม่ได้กำหนดระดับ Zun/],
    [{ kind: 'zun', hasZun: true, zunAllowed: true }, /พร้อมจบ Zun/],
    [{ kind: 'main', busy: 'กำลังบันทึก WS' }, /กำลังบันทึก WS/]
  ];
  for (const [input, expected] of cases) {
    const before = structuredClone(input);
    assert.match(completionControlHelp(input).message, expected);
    assert.deepEqual(input, before, 'Explanation must not change eligibility or application state');
  }
  assert.equal(completionControlHelp({ kind: 'main', at: { hasAtMaster: false }, free: { isFreeCompletionLevel: true } }).mainLabel, 'จบ Level');
  assert.equal(completionControlHelp({ kind: 'main', at: { hasAtMaster: false }, free: { isFreeCompletionLevel: false } }).mainLabel, 'สอบ AT');
});
