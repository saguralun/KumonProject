const els = {
  destinationSubtitle: document.getElementById("destinationSubtitle"),
  statusLine: document.getElementById("statusLine"),
  runBackupButton: document.getElementById("runBackupButton"),
  exportMessage: document.getElementById("exportMessage"),
  listWrap: document.getElementById("backupListWrap"),
  importForm: document.getElementById("importForm"),
  importFile: document.getElementById("importFile"),
  importConfirmText: document.getElementById("importConfirmText"),
  importSubmit: document.getElementById("importSubmit"),
  importMessage: document.getElementById("importMessage"),
  dbNameHint: document.getElementById("dbNameHint")
};

const setStatus = createStatusSetter(els.statusLine);

// Set once the first /api/backup/list response comes back — the import
// confirm field is checked against this on every keystroke.
let expectedDbName = null;

function setExportMessage(text, isSuccess = false) {
  if (!text) {
    els.exportMessage.classList.add("hidden");
    return;
  }

  els.exportMessage.textContent = text;
  els.exportMessage.classList.remove("hidden");
  els.exportMessage.classList.toggle("is-success", isSuccess);
}

function setImportMessage(text, isSuccess = false) {
  if (!text) {
    els.importMessage.classList.add("hidden");
    return;
  }

  els.importMessage.textContent = text;
  els.importMessage.classList.remove("hidden");
  els.importMessage.classList.toggle("is-success", isSuccess);
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(value) {
  return new Date(value).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}

function renderBackupList(backups) {
  if (!backups.length) {
    els.listWrap.innerHTML = `<div class="empty-state">ยังไม่มีไฟล์ backup — กด "Backup เดี๋ยวนี้" เพื่อสร้างไฟล์แรก</div>`;
    return;
  }

  els.listWrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>ไฟล์</th>
          <th>ขนาด</th>
          <th>สร้างเมื่อ</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${backups.map((backup) => `
          <tr>
            <td>${escapeHtml(backup.filename)}</td>
            <td>${formatBytes(backup.sizeBytes)}</td>
            <td>${formatDate(backup.createdAt)}</td>
            <td>
              <a class="download-button" href="/api/backup/download/${encodeURIComponent(backup.filename)}">⬇️ ดาวน์โหลด</a>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

async function loadBackups() {
  try {
    const data = await requestJson("/api/backup/list");

    expectedDbName = data.dbName;
    els.dbNameHint.textContent = data.dbName;
    els.destinationSubtitle.textContent = `ปลายทาง: ${data.backupDir} • เก็บย้อนหลัง ${backupRetentionHint(data.backups.length)}`;
    renderBackupList(data.backups);
    validateImportForm();
  } catch (error) {
    els.listWrap.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    els.destinationSubtitle.textContent = "โหลดข้อมูลไม่สำเร็จ";
  }
}

// Purely descriptive — the actual retention (12 files) lives in
// scripts/backup-database.ps1, this just avoids the count silently
// implying "this is all there ever was" when it's really "this is all
// that's kept".
function backupRetentionHint(count) {
  return `${count} ไฟล์ (เก็บล่าสุด 12 ไฟล์อัตโนมัติ)`;
}

els.runBackupButton.addEventListener("click", async () => {
  els.runBackupButton.disabled = true;
  els.runBackupButton.textContent = "⏳ กำลัง backup...";
  setExportMessage("");

  try {
    const data = await requestJson("/api/backup/run", { method: "POST" });

    setExportMessage(`สร้างไฟล์ ${data.backup.filename} สำเร็จ`, true);
    setStatus("Backup สำเร็จ");
    await loadBackups();
  } catch (error) {
    setExportMessage(error.message);
    setStatus(error.message, "error");
  } finally {
    els.runBackupButton.disabled = false;
    els.runBackupButton.textContent = "📤 Backup เดี๋ยวนี้";
  }
});

function validateImportForm() {
  const hasFile = els.importFile.files.length > 0;
  const textMatches = expectedDbName !== null && els.importConfirmText.value === expectedDbName;

  els.importSubmit.disabled = !(hasFile && textMatches);
}

els.importFile.addEventListener("change", validateImportForm);
els.importConfirmText.addEventListener("input", validateImportForm);

els.importForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const file = els.importFile.files[0];

  if (!file) {
    return;
  }

  const confirmed = window.confirm(
    `ยืนยัน restore ทับข้อมูลปัจจุบันในฐาน "${expectedDbName}" ด้วยไฟล์ "${file.name}" ใช่ไหม?\n\n` +
    `ระบบจะสำรองข้อมูลปัจจุบันไว้ก่อนเสมอ แต่หลังจากนี้ข้อมูลที่เห็นอยู่ตอนนี้จะถูกแทนที่ทันที`
  );

  if (!confirmed) {
    return;
  }

  els.importSubmit.disabled = true;
  els.importSubmit.textContent = "⏳ กำลัง restore...";
  setImportMessage("");

  try {
    const response = await fetch(
      `/api/backup/import?confirmDbName=${encodeURIComponent(expectedDbName)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: file
      }
    );
    const data = await response.json().catch(() => ({}));

    if (!response.ok || data.success === false) {
      throw new Error(data.error || "Restore ไม่สำเร็จ");
    }

    setImportMessage(
      `Restore สำเร็จ — ข้อมูลก่อนหน้านี้ถูกสำรองไว้ที่ไฟล์ "${data.preImportBackup.filename}" แล้ว`,
      true
    );
    setStatus("Restore สำเร็จ");
    els.importForm.reset();
    await loadBackups();
  } catch (error) {
    setImportMessage(error.message);
    setStatus(error.message, "error");
  } finally {
    els.importSubmit.textContent = "🗑️ Restore ทับข้อมูลปัจจุบัน";
    validateImportForm();
  }
});

loadBackups();
