// Describes the existing eligibility result; never decides whether to save.
export function completionControlHelp({ kind, at = {}, free = {}, zun = {}, hasZun, mainAllowed, zunAllowed, busy }) {
    const freeMode = Boolean(free.canComplete || (free.isFreeCompletionLevel && at.hasAtMaster === false));
    const mainLabel = freeMode ? 'จบ Level' : 'สอบ AT';
    if (busy) return { mainLabel, message: busy };
    if (kind === 'zun') {
        if (!hasZun) return { mainLabel, message: 'ยังไม่ได้กำหนดระดับ Zun • เลือก Main เพื่อสอบ AT' };
        return { mainLabel, message: zunAllowed
            ? 'พร้อมจบ Zun • เลือก Main หากต้องการสอบ AT'
            : 'ต้องบันทึก Zun ชุด 91 ก่อนจบ Zun • เลือก Main เพื่อสอบ AT' };
    }
    if (mainAllowed) return { mainLabel, message: at.bypassWorksheet191 && !freeMode
        ? 'KC: สอบ AT ได้โดยไม่ต้องมีชุดกระดาษ 191'
        : `พร้อม${freeMode ? 'จบ Level โดยไม่สอบ AT' : 'สอบ AT'}` };
    if (freeMode && free.nextLevelMasterId === null) return { mainLabel, message: 'ยังไม่มีระดับถัดไปสำหรับการจบ Level ในข้อมูลระดับ' };
    if (freeMode) return { mainLabel, message: 'ต้องบันทึก Main ชุด 191 ก่อนจบ Level โดยไม่สอบ AT' };
    if (at.hasAtMaster === false) return { mainLabel, message: 'ยังไม่มีข้อมูล AT สำหรับระดับนี้ จึงยังสอบ AT ไม่ได้' };
    if (!at.bypassWorksheet191 && (at.hasAtMaster || at.atMasterId)) return { mainLabel, message: 'ต้องมี Main ชุด 191 ในประวัติและกราฟปัจจุบันก่อนสอบ AT' };
    return { mainLabel, message: 'ยังไม่มีข้อมูลเงื่อนไขสอบ AT / จบระดับสำหรับวิชานี้' };
}
