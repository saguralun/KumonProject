# Control observations

เฉพาะข้อมูลจำลอง: การพบ click ไม่เท่ากับยืนยันทุกผลลัพธ์ และปุ่มที่ไม่พบ click ยังไม่ถือว่าเสีย

| หน้า | ปุ่มใน HTML | พบ action ที่จับคู่ได้ | ยังจับคู่ไม่ได้ |
| --- | ---: | ---: | ---: |
| backup.html | 7 | 4 | 3 |
| forecast.html | 13 | 10 | 3 |
| index.html | 5 | 2 | 3 |
| ksis.html | 34 | 27 | 7 |
| login.html | 5 | 2 | 3 |
| opening-schedule.html | 7 | 4 | 3 |
| payment.html | 21 | 8 | 13 |
| progress-chart.html | 8 | 5 | 3 |
| report.html | 12 | 8 | 4 |
| statistics.html | 5 | 2 | 3 |
| stock-cut.html | 8 | 5 | 3 |
| stock-receive.html | 10 | 7 | 3 |
| stock.html | 6 | 3 | 3 |
| student-manager.html | 40 | 20 | 20 |
| users.html | 7 | 4 | 3 |
| worksheet.html | 24 | 15 | 9 |
| migration.html | 6 | 3 | 3 |

## ปุ่มที่ยังไม่มีหลักฐาน action ตรงจากรอบนี้

- backup.html: (ไม่มี ID) — งานประจำ
- backup.html: (ไม่มี ID) — คลัง
- backup.html: (ไม่มี ID) — ระบบ
- forecast.html: (ไม่มี ID) — งานประจำ
- forecast.html: (ไม่มี ID) — คลัง
- forecast.html: (ไม่มี ID) — ระบบ
- index.html: (ไม่มี ID) — งานประจำ
- index.html: (ไม่มี ID) — คลัง
- index.html: (ไม่มี ID) — ระบบ
- ksis.html: (ไม่มี ID) — งานประจำ
- ksis.html: (ไม่มี ID) — คลัง
- ksis.html: (ไม่มี ID) — ระบบ
- ksis.html: `ksisDraftAcknowledge` — ตรวจและจัดการข้อมูลบน KSIS แล้ว
- ksis.html: `ksisAtOpen` — เปิดหน้า AT
- ksis.html: `ksisAtAcknowledge` — จัดการข้อมูล AT ค้างแล้ว
- ksis.html: `ksisOpenReportB` — Report B
- login.html: (ไม่มี ID) — เข้าสู่ระบบ
- login.html: (ไม่มี ID) — Guest
- login.html: `guestSubmit` — เข้าสู่ระบบแบบ Guest
- opening-schedule.html: (ไม่มี ID) — งานประจำ
- opening-schedule.html: (ไม่มี ID) — คลัง
- opening-schedule.html: (ไม่มี ID) — ระบบ
- payment.html: (ไม่มี ID) — งานประจำ
- payment.html: (ไม่มี ID) — คลัง
- payment.html: (ไม่มี ID) — ระบบ
- payment.html: `printerStatusBadge` — กดเพื่อเช็คใหม่
- payment.html: `printTestButton` — กำลังเช็คเครื่องพิมพ์...
- payment.html: (ไม่มี ID) — ทั้งหมด 0
- payment.html: (ไม่มี ID) — จ่ายแล้ว 0
- payment.html: (ไม่มี ID) — จ่ายบางส่วน 0
- payment.html: (ไม่มี ID) — ยังไม่จ่าย 0
- payment.html: `moneyVisibilityToggle` — 👁️ แสดงยอด
- payment.html: `printUnpaidButton` — 🖨️ Print unpaid
- payment.html: `exportUnpaidButton` — ⬇️ Export CSV
- payment.html: `refreshButton` — 🔄 Refresh
- progress-chart.html: (ไม่มี ID) — งานประจำ
- progress-chart.html: (ไม่มี ID) — คลัง
- progress-chart.html: (ไม่มี ID) — ระบบ
- report.html: (ไม่มี ID) — งานประจำ
- report.html: (ไม่มี ID) — คลัง
- report.html: (ไม่มี ID) — ระบบ
- report.html: `previousPage` — หน้าก่อนหน้า
- statistics.html: (ไม่มี ID) — งานประจำ
- statistics.html: (ไม่มี ID) — คลัง
- statistics.html: (ไม่มี ID) — ระบบ
- stock-cut.html: (ไม่มี ID) — งานประจำ
- stock-cut.html: (ไม่มี ID) — คลัง
- stock-cut.html: (ไม่มี ID) — ระบบ
- stock-receive.html: (ไม่มี ID) — งานประจำ
- stock-receive.html: (ไม่มี ID) — คลัง
- stock-receive.html: (ไม่มี ID) — ระบบ
- stock.html: (ไม่มี ID) — งานประจำ
- stock.html: (ไม่มี ID) — คลัง
- stock.html: (ไม่มี ID) — ระบบ
- student-manager.html: (ไม่มี ID) — งานประจำ
- student-manager.html: (ไม่มี ID) — คลัง
- student-manager.html: (ไม่มี ID) — ระบบ
- student-manager.html: `enrollmentOtButton` — OT
- student-manager.html: `enrollmentCompleterButton` — 🏁 Complete
- student-manager.html: `wsGraphButton` — 📈 WS Graph
- student-manager.html: (ไม่มี ID) — WS
- student-manager.html: (ไม่มี ID) — AT
- student-manager.html: (ไม่มี ID) — DT
- student-manager.html: `addStudentCancel` — Close
- student-manager.html: `copyAddressSearchButton` — 🔎 ค้นหา
- student-manager.html: `copyAddressApplyButton` — 📋 คัดลอกที่อยู่
- student-manager.html: `addStudentClose` — Cancel
- student-manager.html: `addEnrollmentCancel` — Close
- student-manager.html: `addEnrollmentClose` — Cancel
- student-manager.html: `wsGraphClose` — Close
- student-manager.html: (ไม่มี ID) — 3 เดือน
- student-manager.html: (ไม่มี ID) — 6 เดือน
- student-manager.html: (ไม่มี ID) — 12 เดือน
- student-manager.html: (ไม่มี ID) — ทั้งหมด
- users.html: (ไม่มี ID) — งานประจำ
- users.html: (ไม่มี ID) — คลัง
- users.html: (ไม่มี ID) — ระบบ
- worksheet.html: (ไม่มี ID) — งานประจำ
- worksheet.html: (ไม่มี ID) — คลัง
- worksheet.html: (ไม่มี ID) — ระบบ
- worksheet.html: `datePrev` — Previous day
- worksheet.html: `dateNext` — Next day
- worksheet.html: `atCancel` — Close
- worksheet.html: (ไม่มี ID) — ผ่าน
- worksheet.html: `atEditLatest` — แก้รอบล่าสุด
- worksheet.html: `incompleteWsClose` — Close
- migration.html: (ไม่มี ID) — งานประจำ
- migration.html: (ไม่มี ID) — คลัง
- migration.html: (ไม่มี ID) — ระบบ

รายละเอียด event, ข้อจำกัด และผลแต่ละรอบอยู่ใน control-coverage.json
