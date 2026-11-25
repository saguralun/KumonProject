# Synthetic user-review audits

เครื่องมือสำหรับการรีวิว 10 บทบาทวันที่ 2026-11-24 ไม่ถูกเรียกโดยโปรแกรมหลัก
และไม่ใช่ขั้นตอนอัปเดตหรือเตรียมฐานข้อมูล ใช้จาก root ของโปรเจกต์ด้วย Node 24
เครื่องตรวจรอบนี้ใช้ Node 24; บาง script ต้องมี `node:module.registerHooks`

## หลักฐานเฉพาะจุด

```powershell
node scripts/audits/authSessionReview.mjs
node scripts/audits/stockRetryReview.mjs
node scripts/audits/atRecoveryReview.mjs
node scripts/audits/paymentPrintReview.mjs
node scripts/audits/worksheetReview.mjs
node scripts/audits/worksheetLayoutReview.mjs
```

สาม script แรกใช้ service จริงกับ dependency/SQL/session doubles ที่ปิดทางถึง
ฐานข้อมูลจริงก่อนโหลด config ส่วนสาม script หลังเปิดเว็บจำลองด้วย profile
ชั่วคราว ต้องใช้ Chrome; `worksheetReview.mjs --embedded` ตรวจ Electron ได้
ทุก script ใช้ข้อมูลปลอม และไม่รับเงิน พิมพ์ หรือกรอก KSIS จริง

ผลเขียนลง `test/reviews/2026-11-24/` ฟังก์ชัน export บางตัวคืนผลอย่างเดียว
ส่วน direct CLI จะเขียนไฟล์ตามที่ระบุใน source

ผล `reproduced` หรือ checks ผ่านใน audit บางข้อหมายถึง **จำลองปัญหาเดิมได้**
ไม่ได้หมายถึงระบบทำงานถูกต้องแล้ว การแก้โปรแกรมควรมี regression test ที่
คาดหวังพฤติกรรมถูกต้องแยกต่างหาก; unknown SQL หรือขอบเขตที่เปลี่ยนต้องหยุด
เพื่อทบทวน fixture ไม่ปล่อยให้ตกไปใช้ connection จริง

หลังแก้ประเด็นใบเสร็จ/DO/reset/WS/AT ในวันที่ 2026-11-24 สคริปต์เหล่านี้ยังเก็บ
ความคาดหวังของรุ่นที่มีปัญหาไว้เป็นหลักฐานเดิม จึงอาจล้มเหลวเมื่อใช้กับโค้ดใหม่
อย่าใช้ผล audit เก่าเป็นเกณฑ์ผ่านของรุ่นที่แก้แล้ว ให้ใช้ regression tests
`paymentPrintConsistency`, `stockReceiveRetry`, `authPasswordReset`,
`authCreateAdminCli`, `worksheetAuditRecovery`, `ksisAtRecovery` และชุดฐานข้อมูล
ชั่วคราวตาม `test/README.md` แทน ไม่เขียนทับ JSON หลักฐานรีวิวเดิม

## การสังเกต click ใน UI workflows

ใช้ `test/support/reviewInstrumentation.mjs` แบบ opt-in เท่านั้น ถ้าไม่มี
`KUMON_REVIEW_TRACE_DIR` จะไม่ติดตั้งตัวสังเกตหรือเปลี่ยนเวลาของ test
เมื่อเปิดใช้งานจะบันทึก click เฉพาะ localhost/loopback ไม่บันทึกค่าที่กรอกใน
ฟอร์มหรือ cookie และไม่เปลี่ยน assertion, API responses หรือสิทธิ์ใน fixture

```powershell
$reviewDir = Join-Path (Get-Location) ('logs/review-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $reviewDir | Out-Null
$env:KUMON_REVIEW_TRACE_DIR = $reviewDir
$env:KUMON_REVIEW_TIMEOUT_SCALE = '3'
$env:TEST_BROWSER_UI = '1'
$files = Get-ChildItem test -Filter '*.ui.test.js' | Sort-Object Name | ForEach-Object FullName
node --import ./test/support/reviewInstrumentation.mjs --test --test-concurrency=1 $files
```

รวบรวมผลด้วย export `collectControlCoverage({traceDirectory, inventoryPath,
outputDirectory})` จาก `collectControlCoverage.mjs` ค่า inventory มาจาก
`buttonInventory.ui.test.js` ใน system temp ของโปรเซสที่รัน หากรันข้ามบริบท
Windows ให้ส่ง path ชัดเจนผ่าน `KUMON_REVIEW_INVENTORY` เพราะ temp อาจต่างกัน

Direct CLI ของ collector อ่าน trace path จาก `logs/persona-review-directory.txt`
และเขียน `control-coverage.json`/`.md` ในโฟลเดอร์รายงาน ตัว collector แยก
การจับคู่ด้วย ID/ข้อความ, ปุ่ม dynamic, links และข้อที่ยังไม่พบ click
การไม่พบ click ไม่ใช่ข้อสรุปว่าปุ่มเสีย และ event เดียวไม่รับรองทุก postcondition
