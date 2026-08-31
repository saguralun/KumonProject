// "Add Student" modal: field validation, name-duplicate checking, address
// hint dropdowns (province/district/subdistrict cascades), and the
// "copy address from an existing student" tool. Self-contained — unlike
// studentAddEnrollment.js, nothing here needs to call back into
// student-manager.js, so no circular import is needed in this direction.
import { els, state } from "./student-manager.js";
import {
    clearFieldError,
    clearFormErrors,
    escapeHtml,
    focusFirstInvalidField,
    isValidMobile,
    isValidZipcode,
    markFieldError,
    readForm,
    requestJson,
    selectInputText,
    setAddStudentMessage,
    setAutoFilled,
    setFormValue
} from "./studentFormUtil.js";
import { ageInYears, genderByName, prefixById } from "./studentMasters.js";

function getAddStudentChecks() {
    const form = els.addStudentForm;
    const values = readForm(form);
    const checks = [];
    const addCheck = ({ fieldName, fieldNames = null, label, message, ok }) => {
        checks.push({
            fieldName,
            fieldNames: fieldNames || [fieldName],
            label,
            message,
            ok: Boolean(ok)
        });
    };
    const age = values.birthDate ? ageInYears(values.birthDate) : null;

    addCheck({
        fieldName: "prefixId",
        label: "คำนำหน้า",
        message: "กรุณาเลือกคำนำหน้า",
        ok: Boolean(values.prefixId)
    });
    addCheck({
        fieldName: "firstName",
        label: "ชื่อ",
        message: "กรุณากรอกชื่อ",
        ok: Boolean(values.firstName)
    });
    addCheck({
        fieldName: "lastName",
        label: "นามสกุล",
        message: "กรุณากรอกนามสกุล",
        ok: Boolean(values.lastName)
    });
    addCheck({
        fieldName: "firstName",
        fieldNames: ["firstName", "lastName"],
        label: "ชื่อซ้ำ",
        message: state.addStudentDuplicate
            ? `มีเด็กชื่อนี้แล้ว: #${state.addStudentDuplicate.studentId} ${state.addStudentDuplicate.displayName}`
            : "ชื่อและนามสกุลต้องไม่ซ้ำพร้อมกัน",
        ok: Boolean(values.firstName && values.lastName && !state.addStudentDuplicate)
    });
    addCheck({
        fieldName: "nickname",
        label: "ชื่อเล่น",
        message: "กรุณากรอกชื่อเล่น",
        ok: Boolean(values.nickname)
    });
    addCheck({
        fieldName: "genderId",
        label: "เพศ",
        message: "กรุณาเลือกเพศ",
        ok: Boolean(values.genderId)
    });
    addCheck({
        fieldName: "birthDate",
        label: "วันเกิด",
        message: "กรุณากรอกวันเกิด",
        ok: Boolean(values.birthDate)
    });
    addCheck({
        fieldName: "birthDate",
        label: "วันเกิด",
        message: "อายุต้องมากกว่า 2 ปี",
        ok: !values.birthDate || (age !== null && age > 2)
    });
    addCheck({
        fieldName: "schoolGradeId",
        label: "ชั้น",
        message: "กรุณาเลือกชั้น",
        ok: Boolean(values.schoolGradeId)
    });
    addCheck({
        fieldName: "schoolName",
        label: "โรงเรียน",
        message: "กรุณากรอกโรงเรียน",
        ok: Boolean(values.schoolName)
    });
    addCheck({
        fieldName: "mobile",
        label: "เบอร์โทร",
        message: "กรุณากรอกเบอร์โทร",
        ok: Boolean(values.mobile)
    });
    addCheck({
        fieldName: "mobile",
        label: "เบอร์โทร",
        message: "เบอร์โทรต้องเป็น 10 หลัก เช่น 000-000-0000",
        ok: !values.mobile || isValidMobile(values.mobile)
    });
    addCheck({
        fieldName: "addressZipcode",
        label: "รหัสไปรษณีย์",
        message: "กรุณากรอกรหัสไปรษณีย์",
        ok: Boolean(values.addressZipcode)
    });
    addCheck({
        fieldName: "addressZipcode",
        label: "รหัสไปรษณีย์",
        message: "รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก",
        ok: !values.addressZipcode || isValidZipcode(values.addressZipcode)
    });
    addCheck({
        fieldName: "addressProvince",
        label: "จังหวัด",
        message: "กรุณากรอกจังหวัด",
        ok: Boolean(values.addressProvince)
    });
    addCheck({
        fieldName: "addressDistrict",
        label: "อำเภอ",
        message: "กรุณากรอกอำเภอ",
        ok: Boolean(values.addressDistrict)
    });
    addCheck({
        fieldName: "addressSubdistrict",
        label: "ตำบล",
        message: "กรุณากรอกตำบล",
        ok: Boolean(values.addressSubdistrict)
    });

    return checks;
}

export function showAddStudentCurrentCheck() {
    const form = els.addStudentForm;
    const checks = getAddStudentChecks();
    const firstInvalid = checks.find((check) => !check.ok);

    clearFormErrors(form);

    if (firstInvalid) {
        firstInvalid.fieldNames.forEach((fieldName) => markFieldError(form, fieldName));
        setAddStudentMessage(
            `<span>ต้องแก้</span><strong>${escapeHtml(firstInvalid.label)}</strong><em>${escapeHtml(firstInvalid.message)}</em>`,
            "error",
            { html: true }
        );
        return firstInvalid;
    }

    setAddStudentMessage(
        `<span>ผ่าน</span><strong>ข้อมูลครบ</strong><em>พร้อม Add Student</em>`,
        "neutral",
        { html: true }
    );
    return null;
}

export function validateAddStudentForm() {
    const firstInvalid = showAddStudentCurrentCheck();

    state.addStudentValidationActive = true;
    if (firstInvalid) {
        focusFirstInvalidField(els.addStudentForm.elements[firstInvalid.fieldName]);
        return false;
    }

    return true;
}

export function updateAddStudentGenderFromPrefix() {
    const form = els.addStudentForm;
    const prefix = prefixById(form.elements.prefixId.value);
    const prefixName = String(prefix?.name || "");
    const female = genderByName("หญิง");
    const male = genderByName("ชาย");

    if ((prefixName.includes("ด.ญ") || prefixName.includes("นาง") || prefixName.includes("น.ส")) && female) {
        setFormValue(form, "genderId", female.id);
        setAutoFilled(form, "genderId", true);
    } else if ((prefixName.includes("ด.ช") || prefixName.includes("นาย")) && male) {
        setFormValue(form, "genderId", male.id);
        setAutoFilled(form, "genderId", true);
    }
}

export async function checkAddStudentDuplicateNow() {
    const form = els.addStudentForm;
    const values = readForm(form);

    state.addStudentDuplicate = null;

    if (!values.firstName || !values.lastName) {
        if (state.addStudentValidationActive) {
            showAddStudentCurrentCheck();
        }
        return;
    }

    const params = new URLSearchParams({
        firstName: values.firstName,
        lastName: values.lastName
    });
    const data = await requestJson(`/api/students/duplicate?${params.toString()}`);

    state.addStudentDuplicate = data.duplicate || null;
    if (state.addStudentValidationActive) {
        showAddStudentCurrentCheck();
    }
}

export function queueAddStudentDuplicateCheck() {
    window.clearTimeout(state.addStudentDuplicateTimer);
    state.addStudentDuplicateTimer = window.setTimeout(() => {
        checkAddStudentDuplicateNow().catch((error) => setAddStudentMessage(error.message, "error"));
    }, 250);
}

function sortedUnique(values) {
    return [...new Set(values
        .filter(Boolean)
        .map((value) => String(value).trim())
        .filter((value) => value && value !== "-"))]
        .sort((a, b) => a.localeCompare(b, "th"));
}

function renderHintList(list, values) {
    list.innerHTML = sortedUnique(values)
        .map((value) => `<option value="${escapeHtml(value)}"></option>`)
        .join("");
}

function renderSelectOptions(field, values, { blankLabel = "-" } = {}) {
    const currentValue = field.value;
    const options = sortedUnique(values);

    field.innerHTML = `
        <option value="">${escapeHtml(blankLabel)}</option>
        ${options.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}
    `;

    if (currentValue && options.includes(currentValue)) {
        field.value = currentValue;
    }
}

function setSelectValueWithOption(form, name, value) {
    const field = form.elements[name];
    const text = String(value || "").trim();

    if (!field || !text) {
        setFormValue(form, name, "");
        return;
    }

    if (![...field.options].some((option) => option.value === text)) {
        field.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(text)}">${escapeHtml(text)}</option>`);
    }

    setFormValue(form, name, text);
}

function addStudentAddressRows(filters = {}) {
    return (state.masters?.studentHints?.addresses || []).filter((item) => {
        if (filters.zipcode && String(item.zipcode || "").trim() !== filters.zipcode) {
            return false;
        }
        if (filters.province && String(item.province || "").trim() !== filters.province) {
            return false;
        }
        if (filters.district && String(item.district || "").trim() !== filters.district) {
            return false;
        }
        return true;
    });
}

function ensureValueInOptions(form, fieldName, values) {
    const field = form.elements[fieldName];
    const allowed = new Set(sortedUnique(values));

    if (field.value && !allowed.has(field.value)) {
        field.value = "";
        setAutoFilled(form, fieldName, false);
    }
}

export function updateAddStudentAddressHints(changedField = null) {
    const form = els.addStudentForm;
    const zipcode = String(form.elements.addressZipcode.value || "").trim();
    let province = String(form.elements.addressProvince.value || "").trim();
    let district = String(form.elements.addressDistrict.value || "").trim();
    let autoProvince = null;

    if (changedField === "addressZipcode") {
        const zipRows = zipcode ? addStudentAddressRows({ zipcode }) : [];
        const provinces = sortedUnique(zipRows.map((item) => item.province));

        if (zipcode && provinces.length === 1) {
            autoProvince = provinces[0];
            province = autoProvince;
        }

        form.elements.addressDistrict.value = "";
        form.elements.addressSubdistrict.value = "";
        setAutoFilled(form, "addressDistrict", false);
        setAutoFilled(form, "addressSubdistrict", false);
        district = "";
    } else if (changedField === "addressProvince") {
        form.elements.addressDistrict.value = "";
        form.elements.addressSubdistrict.value = "";
        setAutoFilled(form, "addressProvince", false);
        setAutoFilled(form, "addressDistrict", false);
        setAutoFilled(form, "addressSubdistrict", false);
        district = "";
    } else if (changedField === "addressDistrict") {
        form.elements.addressSubdistrict.value = "";
        setAutoFilled(form, "addressDistrict", false);
        setAutoFilled(form, "addressSubdistrict", false);
    } else if (changedField === "addressSubdistrict") {
        setAutoFilled(form, "addressSubdistrict", false);
    }

    province = String(form.elements.addressProvince.value || "").trim();
    district = String(form.elements.addressDistrict.value || "").trim();

    const provinceRows = province ? addStudentAddressRows({ province }) : addStudentAddressRows();
    const districtRows = addStudentAddressRows({
        ...(zipcode ? { zipcode } : {}),
        ...(province ? { province } : {})
    });
    const subdistrictRows = addStudentAddressRows({
        ...(zipcode ? { zipcode } : {}),
        ...(province ? { province } : {}),
        ...(district ? { district } : {})
    });

    renderHintList(els.hintLists.zipcodes, provinceRows.map((item) => item.zipcode));
    renderSelectOptions(form.elements.addressProvince, zipcode
        ? addStudentAddressRows({ zipcode }).map((item) => item.province)
        : addStudentAddressRows().map((item) => item.province));
    renderSelectOptions(form.elements.addressDistrict, districtRows.map((item) => item.district));
    renderSelectOptions(form.elements.addressSubdistrict, subdistrictRows.map((item) => item.subdistrict));

    ensureValueInOptions(form, "addressProvince", zipcode
        ? addStudentAddressRows({ zipcode }).map((item) => item.province)
        : addStudentAddressRows().map((item) => item.province));
    ensureValueInOptions(form, "addressDistrict", districtRows.map((item) => item.district));
    ensureValueInOptions(form, "addressSubdistrict", subdistrictRows.map((item) => item.subdistrict));

    if (autoProvince) {
        setFormValue(form, "addressProvince", autoProvince);
        setAutoFilled(form, "addressProvince", true);
        clearFieldError(form.elements.addressProvince);
    }
}

export function resetCopyAddressTool() {
    state.copyAddressResults = [];
    els.copyAddressSearch.value = "";
    els.copyAddressSummary.textContent = "ฟังก์ชันเสริม: ค้นหานักเรียนเดิมเพื่อคัดลอกที่อยู่";
    els.copyAddressStudentSelect.innerHTML = `<option value="">-</option>`;
    els.copyAddressStudentSelect.disabled = true;
    els.copyAddressApplyButton.disabled = true;
}

function renderCopyAddressResults(rows = []) {
    state.copyAddressResults = rows;
    els.copyAddressSummary.textContent = rows.length
        ? `พบ ${rows.length} คน เลือกนักเรียนที่ต้องการคัดลอกที่อยู่`
        : "ไม่พบนักเรียนจากคำค้นนี้";
    els.copyAddressStudentSelect.innerHTML = `
        <option value="">-</option>
        ${rows.map((student) => `
            <option value="${escapeHtml(student.studentId)}">
                #${escapeHtml(student.studentId)} ${escapeHtml(student.displayName)}
            </option>
        `).join("")}
    `;
    els.copyAddressStudentSelect.disabled = rows.length === 0;
    els.copyAddressApplyButton.disabled = true;
}

export async function searchCopyAddressStudents() {
    const query = els.copyAddressSearch.value.trim();

    if (!query) {
        renderCopyAddressResults([]);
        els.copyAddressSummary.textContent = "กรุณากรอกชื่อหรือนามสกุลก่อนค้นหา";
        setAddStudentMessage(
            `<span>ต้องแก้</span><strong>คัดลอกที่อยู่</strong><em>กรุณากรอกชื่อหรือนามสกุลเพื่อค้นหา</em>`,
            "error",
            { html: true }
        );
        els.copyAddressSearch.focus();
        return;
    }

    els.copyAddressSearchButton.disabled = true;

    try {
        const params = new URLSearchParams({
            query,
            status: "all",
            limit: "20"
        });
        const data = await requestJson(`/api/students/search?${params.toString()}`);
        renderCopyAddressResults(data.rows || []);
        setAddStudentMessage(
            data.rows?.length
                ? `<span>ผ่าน</span><strong>คัดลอกที่อยู่</strong><em>เลือกนักเรียนที่ต้องการคัดลอกที่อยู่</em>`
                : `<span>ต้องแก้</span><strong>คัดลอกที่อยู่</strong><em>ไม่พบนักเรียนจากคำค้นนี้</em>`,
            data.rows?.length ? "neutral" : "error",
            { html: true }
        );
    } catch (error) {
        setAddStudentMessage(error.message, "error");
    } finally {
        els.copyAddressSearchButton.disabled = false;
        setTimeout(() => selectInputText(els.copyAddressSearch), 0);
    }
}

function applyCopiedAddress(student) {
    const form = els.addStudentForm;
    const fields = [
        "addressZipcode",
        "addressProvince",
        "addressDistrict",
        "addressSubdistrict",
        "addressNumber",
        "addressVillage",
        "addressAlley",
        "addressRoad",
        "remark"
    ];

    setFormValue(form, "addressZipcode", student.addressZipcode);
    updateAddStudentAddressHints("addressZipcode");
    setSelectValueWithOption(form, "addressProvince", student.addressProvince);
    updateAddStudentAddressHints("addressProvince");
    setSelectValueWithOption(form, "addressDistrict", student.addressDistrict);
    updateAddStudentAddressHints("addressDistrict");
    setSelectValueWithOption(form, "addressSubdistrict", student.addressSubdistrict);
    updateAddStudentAddressHints("addressSubdistrict");
    setFormValue(form, "addressNumber", student.addressNumber);
    setFormValue(form, "addressVillage", student.addressVillage);
    setFormValue(form, "addressAlley", student.addressAlley);
    setFormValue(form, "addressRoad", student.addressRoad);
    setFormValue(form, "remark", student.remark);

    fields.forEach((fieldName) => {
        setAutoFilled(form, fieldName, Boolean(form.elements[fieldName]?.value));
        clearFieldError(form.elements[fieldName]);
    });
}

export async function copyAddressFromSelectedStudent() {
    const studentId = els.copyAddressStudentSelect.value;

    if (!studentId) {
        return;
    }

    els.copyAddressApplyButton.disabled = true;

    try {
        const data = await requestJson(`/api/students/${encodeURIComponent(studentId)}`);
        applyCopiedAddress(data.student);
        setAddStudentMessage(
            `<span>ผ่าน</span><strong>คัดลอกที่อยู่</strong><em>คัดลอกจาก ${escapeHtml(data.student.displayName)} แล้ว</em>`,
            "neutral",
            { html: true }
        );
        if (state.addStudentValidationActive) {
            showAddStudentCurrentCheck();
        }
    } catch (error) {
        setAddStudentMessage(error.message, "error");
    } finally {
        els.copyAddressApplyButton.disabled = !els.copyAddressStudentSelect.value;
    }
}
