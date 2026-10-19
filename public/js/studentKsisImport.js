import { els, state } from "./student-manager.js";
import { escapeHtml, requestJson, setAddStudentMessage, setAutoFilled, clearFieldError } from "./studentFormUtil.js";
import { updateAddStudentAddressHints, checkAddStudentDuplicateNow } from "./studentAddStudent.js";
import { ksisPreviewFields } from "./ksisStudentMapping.js";

let fields = [];
let generation = 0;
let applied = false;

export function resetKsisImport() {
    generation++;
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
    fields = [];
    applied = false;
    els.ksisPreview.innerHTML = "";
    els.ksisPreviewButton.disabled = true;
    els.ksisApplyButton.disabled = true;
    els.ksisImportStatus.textContent = "กำลังอ่าน KSIS...";
    try {
        const data = await requestJson("/api/students/ksis/preview", { method: "POST", body: JSON.stringify({ url }) });
        if (requestId !== generation) return;
        if (data.requiresLogin) {
            els.ksisImportStatus.textContent = "กรุณาเข้าสู่ระบบในหน้าต่าง Chrome ของ KSIS ที่เปิดขึ้น แล้วกด Preview อีกครั้ง";
            return;
        }
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
        if (requestId === generation) els.ksisImportStatus.textContent = error.message;
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
    if (hasChanges && !window.confirm("นำข้อมูล KSIS ที่เลือกมาแทนค่าในฟอร์มใช่ไหม? ยังไม่บันทึกนักเรียน")) return;
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
        fields = [];
        els.ksisPreview.innerHTML = "";
        els.ksisImportStatus.textContent = "";
        els.ksisApplyButton.disabled = true;
        els.ksisPreviewButton.disabled = false;
    });
    els.ksisStudentUrl.addEventListener("keydown", (event) => {
        if (event.key === "Enter") { event.preventDefault(); if (!els.ksisPreviewButton.disabled) previewKsis(); }
    });
}
