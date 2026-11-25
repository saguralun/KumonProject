export function describeKsisAudit(result, { unit = 'รายวิชา' } = {}) {
  const scope = result.scope === 'all' ? 'ทุกหน้าตามตัวกรอง KSIS'
    : result.scope === 'current' ? `หน้าที่เลือก ${result.originalPage}` : 'ขอบเขตการตรวจเดิมไม่ระบุ';
  const date = new Date(result.verifiedAt);
  return [result.context, scope, `อ่าน ${result.pagesRead} หน้า`, result.period ? `${result.period.month}/${result.period.year}` : '', result.subject,
    Number.isFinite(date.getTime()) ? `ตรวจเมื่อ ${date.toLocaleString('th-TH')}` : '', 'อ่านอย่างเดียว',
    result.outsidePage ? `นอกหน้าที่ตรวจ ${result.outsidePage} ${unit}` : '',
    result.ignoredBlankRows ? `ไม่นับช่องวิชาว่าง ${result.ignoredBlankRows} แถว` : '',
    result.repeatedRows ? `รวมแถวเดิมที่แสดงซ้ำ ${result.repeatedRows} แถว` : ''].filter(Boolean).join(' • ');
}
