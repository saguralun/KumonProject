import { els, state } from "./student-manager.js";
import { escapeHtml, requestJson, setAddStudentMessage, setAutoFilled, clearFieldError } from "./studentFormUtil.js";
import { updateAddStudentAddressHints, checkAddStudentDuplicateNow } from "./studentAddStudent.js";
import { ksisPreviewFields } from "./ksisStudentMapping.js";

let fields = [];
let generation = 0;
let applied = false;
let activePreview = null;
let layoutTimer = null;

function updateStudentView() {
    if (!window.kumonDesktop?.setKsisBounds) return;
    const pane = document.getElementById('ksisStudentPane');
    const slot = document.getElementById('ksisStudentSlot');
    const rect = slot.getBoundingClientRect();
    const parent = els.addStudentModal.querySelector('.student-modal-dialog').getBoundingClientRect();
    const top = Math.max(rect.top, parent.top, 0), bottom = Math.min(rect.bottom, parent.bottom, innerHeight);
    window.kumonDesktop.setKsisBounds({ x: rect.x, y: top, width: rect.width, height: Math.max(0, bottom - top),
        visible: Boolean(activePreview && !pane.classList.contains('hidden') && !els.addStudentModal.classList.contains('hidden')
            && !document.querySelector('dialog[open]') && document.visibilityState === 'visible') });
}

function showStudentView(show) {
    document.getElementById('ksisStudentPane').classList.toggle('hidden', !show);
    els.addStudentModal.querySelector('.student-modal-dialog').classList.toggle('ksis-preview-open', show);
    clearInterval(layoutTimer);
    if (show) layoutTimer = setInterval(updateStudentView, 400);
    updateStudentView();
}

function stopPreview(notifyServer = true) {
    const id = activePreview;
    activePreview = null;
    showStudentView(false);
    if (id && notifyServer) void fetch('/api/students/ksis/preview', { method: 'POST', keepalive: true,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel', previewId: id }) }).catch(() => {});
}

export function resetKsisImport() {
    generation++;
    stopPreview();
    fields = [];
    applied = false;
    els.ksisStudentUrl.value = "";
    els.ksisPreview.innerHTML = "";
    els.ksisImportStatus.textContent = "";
    els.ksisApplyButton.disabled = true;
    els.ksisPreviewButton.disabled = false;
}

async function previewKsis() {
    const url = els.ksisStudentUrl.value.trim();
    if (!url) { els.ksisImportStatus.textContent = "กรุณาใส่ลิงก์นักเรียน KSIS"; return; }
    const requestId = ++generation;
    stopPreview();
    const previewId = crypto.randomUUID();
    activePreview = previewId;
    fields = [];
    applied = false;
    els.ksisPreview.innerHTML = "";
    els.ksisPreviewButton.disabled = true;
    els.ksisApplyButton.disabled = true;
    els.ksisImportStatus.textContent = "กำลังอ่าน KSIS...";
    showStudentView(Boolean(window.kumonDesktop));
    try {
        const deadline = Date.now() + 5 * 60000;
        let action = 'start', data;
        while (requestId === generation && activePreview === previewId) {
            data = await requestJson('/api/students/ksis/preview', { method: 'POST', signal: AbortSignal.timeout(30000), body: JSON.stringify({ url, action, previewId }) });
            if (requestId !== generation || activePreview !== previewId) return;
            updateStudentView();
            if (data.student) break;
            if (data.previewId !== previewId || !['login', 'reading'].includes(data.phase)) throw new Error('ตัวแอปยังไม่รองรับ Preview อัตโนมัติ กรุณาปิดเปิด KumonDB หลังอัปเดต แล้วลองใหม่');
            els.ksisImportStatus.textContent = data.requiresLogin || data.phase === 'login'
                ? 'กรุณาเข้าสู่ระบบ KSIS ด้านขวา โปรแกรมจะอ่านข้อมูลต่อให้อัตโนมัติ'
                : 'กำลังรอหน้าข้อมูลนักเรียน KSIS โหลด...';
            if (Date.now() >= deadline) throw new Error('หมดเวลารอ KSIS กรุณากด Preview ใหม่');
            action = 'poll';
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        if (requestId !== generation || activePreview !== previewId) return;
        stopPreview(false);
        fields = ksisPreviewFields(data.student, state.masters);
        els.ksisPreview.innerHTML = `<table><thead><tr><th>เลือก</th><th>ข้อมูล</th><th>ค่าจาก KSIS</th></tr></thead><tbody>
            ${fields.map((row, index) => `<tr><td><input type="${row.radio ? "radio" : "checkbox"}" ${row.radio ? 'name="ksisEmailChoice"' : ""} data-ksis-field="${index}"
                aria-label="${escapeHtml(row.label)}" ${row.field && row.value !== "" ? row.selected === false ? "" : "checked" : "disabled"}></td>
                <th scope="row">${escapeHtml(row.label)}</th><td>${escapeHtml(row.display || row.value || "—")}</td></tr>`).join("")}
            </tbody></table>`;
        els.ksisApplyButton.disabled = false;
        els.ksisImportStatus.textContent = fields.some((row) => row.field === "prefixId" && row.value)
            ? "ตรวจข้อมูลก่อนนำลงฟอร์ม • ชื่อเล่นยังไม่ได้ระบุ"
            : "ตรวจข้อมูลก่อนนำลงฟอร์ม • ต้องเลือกคำนำหน้าเอง";
    } catch (error) {
        if (requestId === generation) { stopPreview(); els.ksisImportStatus.textContent = error.name === 'TimeoutError' ? 'อ่าน KSIS ใช้เวลานานเกินไป กรุณาลอง Preview ใหม่' : error.message; }
    } finally {
        if (requestId === generation) els.ksisPreviewButton.disabled = false;
    }
}

async function applyKsis() {
    const selected = [...els.ksisPreview.querySelectorAll("[data-ksis-field]:checked")]
        .map((checkbox) => fields[Number(checkbox.dataset.ksisField)]).filter((row) => row?.field);
    if (!selected.length) return;
    const form = els.addStudentForm;
    const hasChanges = selected.some((row) => form.elements[row.field]?.value && String(form.elements[row.field].value) !== String(row.value));
    if (hasChanges && !await confirmAction("นำข้อมูล KSIS ที่เลือกมาแทนค่าในฟอร์มใช่ไหม? ยังไม่บันทึกนักเรียน")) return;
    const requestId = generation;
    for (const row of selected) {
        const field = form.elements[row.field];
        if (field.tagName === "SELECT" && ![...field.options].some((option) => option.value === String(row.value))) field.add(new Option(row.value, row.value));
        field.value = String(row.value);
        if (row.field === "addressZipcode" || row.field === "addressProvince" || row.field === "addressDistrict") updateAddStudentAddressHints(row.field);
        setAutoFilled(form, row.field, true);
        clearFieldError(field);
    }
    // Cascading address hints can replace earlier select options; keep the reviewed KSIS values.
    for (const row of selected.filter((row) => ["addressProvince", "addressDistrict", "addressSubdistrict"].includes(row.field))) {
        const field = form.elements[row.field];
        if (![...field.options].some((option) => option.value === String(row.value))) field.add(new Option(row.value, row.value));
        field.value = String(row.value);
        setAutoFilled(form, row.field, true);
    }
    if (!applied && selected.some((row) => row.field === "firstName" || row.field === "lastName")
        && !selected.some((row) => row.field === "prefixId")) form.elements.prefixId.value = "";
    applied = true;
    els.ksisApplyButton.disabled = true;
    try {
        await checkAddStudentDuplicateNow();
        if (requestId !== generation) return;
        if (state.addStudentDuplicate) {
            setAddStudentMessage(`พบนักเรียนชื่อนี้แล้ว: #${state.addStudentDuplicate.studentId} ${state.addStudentDuplicate.displayName}`, "error");
        } else {
            setAddStudentMessage(form.elements.prefixId.value
                ? "นำข้อมูลลงฟอร์มแล้ว กรุณาตรวจข้อมูลก่อนบันทึก"
                : "นำข้อมูลลงฟอร์มแล้ว กรุณาเลือกคำนำหน้าและตรวจข้อมูลก่อนบันทึก");
        }
    } catch (error) { setAddStudentMessage(error.message, "error"); }
    finally { if (requestId === generation) els.ksisApplyButton.disabled = false; }
}

export function bindKsisImport() {
    els.ksisPreviewButton.addEventListener("click", previewKsis);
    els.ksisApplyButton.addEventListener("click", applyKsis);
    els.ksisStudentUrl.addEventListener("input", () => {
        generation++;
        stopPreview();
        fields = [];
        els.ksisPreview.innerHTML = "";
        els.ksisImportStatus.textContent = "";
        els.ksisApplyButton.disabled = true;
        els.ksisPreviewButton.disabled = false;
    });
    els.ksisStudentUrl.addEventListener("keydown", (event) => {
        if (event.key === "Enter") { event.preventDefault(); if (!els.ksisPreviewButton.disabled) previewKsis(); }
    });
    document.getElementById('ksisStudentStop').addEventListener('click', () => {
        generation++; stopPreview(); els.ksisPreviewButton.disabled = false;
        els.ksisImportStatus.textContent = 'ยกเลิก Preview แล้ว ยังไม่ได้บันทึกนักเรียน';
    });
    new ResizeObserver(updateStudentView).observe(document.getElementById('ksisStudentSlot'));
    window.addEventListener('resize', updateStudentView);
    document.addEventListener('scroll', updateStudentView, true);
    document.addEventListener('app:dialog-change', updateStudentView);
    document.addEventListener('visibilitychange', updateStudentView);
    window.addEventListener('pagehide', () => { generation++; stopPreview(); });
}
