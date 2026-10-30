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
let restoring = false, backingUp = false;
const downloading = new Set();

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
              <a class="download-button" download="${escapeHtml(backup.filename)}" data-download-filename="${escapeHtml(backup.filename)}" href="/api/backup/download/${encodeURIComponent(backup.filename)}">⬇️ ดาวน์โหลด</a>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function finishDownload(filename) {
  downloading.delete(filename);
  for (const link of els.listWrap.querySelectorAll('[data-download-filename]')) {
    if (link.dataset.downloadFilename === filename) link.removeAttribute('aria-disabled');
  }
}

window.addEventListener('kumon:download-state', event => {
  const state = event.detail;
  if (!state || !downloading.has(state.filename)) return;
  if (state.status === 'saved') {
    finishDownload(state.filename);
    setExportMessage(`บันทึกไฟล์ ${state.filename} สำเร็จ • ${state.path}`, true);
  } else if (state.status === 'cancelled' || state.status === 'failed') {
    finishDownload(state.filename);
    setExportMessage(state.status === 'cancelled' ? 'ยกเลิกการดาวน์โหลดแล้ว' : `บันทึกไฟล์ไม่สำเร็จ: ${state.error}`);
  }
});

els.listWrap.addEventListener('click', async event => {
  const link = event.target.closest('[data-download-filename]');
  if (!link) return;
  event.preventDefault();
  const filename = link.dataset.downloadFilename;
  if (downloading.has(filename)) return;
  downloading.add(filename); link.setAttribute('aria-disabled', 'true');
  setExportMessage(`กำลังเตรียมดาวน์โหลด ${filename}...`);
  let waitingForDesktop = false;
  try {
    // Validate permission/file availability without loading a potentially large
    // database archive into renderer memory or navigating away on JSON errors.
    const response = await fetch(link.href, { method: 'HEAD', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!response.ok || response.redirected || /(?:text\/html|application\/json)/i.test(response.headers.get('content-type') || '')) {
      const message = response.status === 404 ? 'ไม่พบไฟล์สำรองนี้ กรุณาโหลดรายการใหม่'
        : [401, 403].includes(response.status) || response.redirected ? 'กรุณาเข้าสู่ระบบด้วยบัญชีที่มีสิทธิ์ดาวน์โหลดไฟล์สำรอง'
        : `ดาวน์โหลดไฟล์สำรองไม่สำเร็จ (${response.status})`;
      throw new Error(message);
    }
    waitingForDesktop = Boolean(window.kumonDesktop);
    setExportMessage(waitingForDesktop ? `เลือกที่บันทึกไฟล์ ${filename}` : `เริ่มดาวน์โหลด ${filename} แล้ว`, true);
    const anchor = document.createElement('a');
    anchor.href = link.href; anchor.download = filename;
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
  } catch (error) {
    waitingForDesktop = false; setExportMessage(error.name === 'TimeoutError' ? 'ตรวจไฟล์ดาวน์โหลดใช้เวลานานเกินไป กรุณาลองใหม่' : error.message);
  } finally {
    if (!waitingForDesktop) finishDownload(filename);
  }
});

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
  if (restoring || backingUp) return;
  backingUp = true; validateImportForm();
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
    backingUp = false; validateImportForm();
    els.runBackupButton.disabled = false;
    els.runBackupButton.textContent = "📤 Backup เดี๋ยวนี้";
  }
});

function validateImportForm() {
  const hasFile = els.importFile.files.length > 0;
  const textMatches = expectedDbName !== null && els.importConfirmText.value === expectedDbName;

  els.importSubmit.disabled = restoring || backingUp || !(hasFile && textMatches);
}

els.importFile.addEventListener("change", validateImportForm);
els.importConfirmText.addEventListener("input", validateImportForm);

els.importForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const file = els.importFile.files[0];

  if (restoring || backingUp || !file || expectedDbName === null || els.importConfirmText.value !== expectedDbName) {
    return;
  }

  const dbName = expectedDbName;
  const confirmed = await confirmAction(
    `ยืนยัน restore ทับข้อมูลปัจจุบันในฐาน "${expectedDbName}" ด้วยไฟล์ "${file.name}" ใช่ไหม?\n\n` +
    `ระบบจะสำรองข้อมูลปัจจุบันไว้ก่อนเสมอ แต่หลังจากนี้ข้อมูลที่เห็นอยู่ตอนนี้จะถูกแทนที่ทันที`
  );

  if (!confirmed || restoring || backingUp || expectedDbName !== dbName) {
    return;
  }

  els.importSubmit.disabled = true;
  restoring = true;
  els.importFile.disabled = els.importConfirmText.disabled = els.runBackupButton.disabled = true;
  els.importSubmit.textContent = "⏳ กำลัง restore...";
  setImportMessage("");

  try {
    const response = await fetch(
      `/api/backup/import?confirmDbName=${encodeURIComponent(dbName)}`,
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
    restoring = false;
    els.importFile.disabled = els.importConfirmText.disabled = els.runBackupButton.disabled = false;
    els.importSubmit.textContent = "🗑️ Restore ทับข้อมูลปัจจุบัน";
    validateImportForm();
  }
});

loadBackups();
