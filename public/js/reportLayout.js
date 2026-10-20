export const REPORT_PAGE_SIZE = 20;
export const REPORT_SUBJECTS = ["ME", "EFL", "TRP"];

function statusRank(code) {
  if (["A", "OT"].includes(code)) return 0;
  if (code === "C") return 1;
  if (["N", "R", "EO", "IT"].includes(code)) return 2;
  return 3;
}

const names = new Intl.Collator("th", { numeric: true, sensitivity: "base" });

export function subjectReportRows(rows, subject) {
  const gradeRank = (row) => row.IDGrade === "" || row.IDGrade == null || !Number.isFinite(Number(row.IDGrade))
    ? Number.MAX_SAFE_INTEGER : Number(row.IDGrade);
  return rows.filter((row) => row.Subject === subject).sort((a, b) =>
    statusRank(a.Status1) - statusRank(b.Status1)
    || gradeRank(a) - gradeRank(b)
    || names.compare(a["ชื่อจริง"] || "", b["ชื่อจริง"] || "")
    || names.compare(a["นามสกุล"] || "", b["นามสกุล"] || "")
    || Number(a.ID) - Number(b.ID));
}

export function reportPage(rows, page) {
  const pages = Math.max(1, Math.ceil(rows.length / REPORT_PAGE_SIZE));
  const current = Math.max(1, Math.min(pages, Number(page) || 1));
  const start = (current - 1) * REPORT_PAGE_SIZE;
  return { rows: rows.slice(start, start + REPORT_PAGE_SIZE), page: current, pages, start, total: rows.length };
}

export function splitReportLevel(value) {
  const text = String(value || "");
  const parts = text.match(/^(.*\D)(\d+)$/);
  return parts ? [parts[1], parts[2]] : [text, ""];
}

export function reportDate(value) {
  const parts = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!parts) return value || "";
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(parts[2]) - 1];
  return month ? `${Number(parts[1])}-${month}-${parts[3]}` : value;
}

export function renderReportTable(rows, escape) {
  const cell = (value, attrs = "") => `<td${attrs}>${escape(String(value ?? ""))}</td>`;
  const lines = (values) => values.map((value) => `<div class="report-cell-line">${escape(String(value ?? "")) || "&nbsp;"}</div>`).join("");
  const stacked = (values, attrs = "") => `<td${attrs}>${lines(values)}</td>`;
  const position = (value) => splitReportLevel(value).map((part) => cell(part)).join("");
  const header = `<thead><tr>
    <th rowspan="2">Student ID</th><th rowspan="2">Schl<br>Grade</th><th rowspan="2">DOB</th>
    <th rowspan="2">Enrolment<br>Date</th><th rowspan="2" colspan="2">Start<br>Point</th>
    <th rowspan="2" colspan="3">Student Name<br>(First, Last)</th><th colspan="6">Test</th>
    <th rowspan="2" colspan="2">Prev<br>Level</th><th rowspan="2" colspan="2">Current<br>Level</th>
    <th rowspan="2">Wks<br>Used</th><th rowspan="2">ST1</th><th rowspan="2">ST2</th><th rowspan="2" class="report-zun-heading">Zun Zun<div class="report-zun-grid"><span>ระดับ</span><span>ถึงหน้า</span><span>ใช้ (ชุด)</span></div></th>
    </tr><tr>${["Type", "Level", "Date", "Group", "Score", "Time"].map((title) => `<th>${title}</th>`).join("")}</tr></thead>`;
  const body = rows.map((row) => {
    const suffixes = ["", "1", "2"].filter((suffix) => row[`TestType${suffix}`]);
    const testColumns = ["TestType", "LevelTest", "DateTest", "Group", "Score", "Time"].map((field) =>
      stacked(suffixes.map((suffix) => field === "DateTest" ? reportDate(row[`${field}${suffix}`]) : row[`${field}${suffix}`]))).join("");
    const cdColumns = [1, 2].map((first) => stacked([first, first + 2, first + 4]
      .filter((slot) => row[`CD${slot}`])
      .map((slot) => `CD ${row[`CD${slot}`]} ${row[`Level${slot}`] ?? ""}`.trim()), ' class="report-cd"')).join("");
    const zun = ["ZI", "ZII"].filter((level) => Number(row[`Used${level}`]) > 0).map((level) => {
      const page = Number(row[`${level}WorksheetNo`]);
      return `<div class="report-cell-line report-zun-grid"><span>${level}</span><span>${Number.isInteger(page) && page > 0 ? page : "-"}</span><span>${escape(String(row[`Used${level}`]))}</span></div>`;
    }).join("");
    return `<tr class="student-start" data-enrollment-id="${escape(String(row.ID))}">
      ${stacked([row["รหัสคุมอง"] || row.StudentId || row.ID, row.ID], ' title="รหัสนักเรียน / Enrollment ID"')}
      ${cell(row.Grade)}${cell(reportDate(row["วันเกิด"]))}${cell(reportDate(row["วันที่สมัคร"]))}${position(row.StartLevel)}
      ${cell(`${row["ชื่อจริง"] || ""}   ${row["นามสกุล"] || ""}`.trim(), ' class="student-name"')}
      ${cdColumns}${testColumns}${position(row.PrevLevel)}${position(row.CurrentLevel)}
      ${cell(row.WksUsed ?? 0)}${cell(row.Status1)}${cell(row.Status2)}<td class="report-zun">${zun}</td></tr>`;
  }).join("");
  return `<table class="report-table" aria-label="Report B"><colgroup>${[98, 36, 78, 78, 30, 26, 175, 45, 45, 30, 34, 78, 34, 34, 34, 30, 28, 30, 28, 34, 30, 30, 130].map((width) => `<col style="width:${width}px">`).join("")}</colgroup>${header}<tbody>${body}</tbody></table>`;
}
