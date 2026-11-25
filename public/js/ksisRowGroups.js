// Presentation only: eligibility and save payloads remain owned by each page.
export function renderKsisRowGroups(rows, classify, renderTable, { completed = false } = {}) {
  const groups = [
    ['ready', completed ? 'ทำรายการแล้ว — ตรวจผลแต่ละแถว' : 'พร้อมกรอก', true],
    ['review', 'ต้องตรวจ / รอยืนยัน', true],
    ['skipped', 'ข้าม / มีข้อมูลแล้ว', false],
    ['outside', 'นอกหน้าปัจจุบัน — ยังไม่กรอก', false]
  ];
  return groups.map(([key, label, open]) => {
    const selected = rows.filter(row => classify(row) === key);
    if (!selected.length) return '';
    return `<details class="ksis-row-group" data-ksis-group="${key}"${open ? ' open' : ''}><summary>${label} <strong>${selected.length}</strong></summary>${renderTable(selected)}</details>`;
  }).join('');
}
