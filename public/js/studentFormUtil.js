// Generic form/DOM helpers shared by every form on the Student page (status
// line, Add Student/Add Enrollment message banners, field formatting and
// validation, error-state toggling). Pure layer — this file calls out to
// nothing else in the app besides `els`, and every other student-manager.js
// module (studentMasters.js, studentAddEnrollment.js, studentAddStudent.js,
// student-manager.js itself) imports from here.
import { els } from "./student-manager.js";

// requestJson/escapeHtml/createStatusSetter come from httpUtil.js/
// htmlUtil.js/statusUtil.js — plain classic scripts loaded before this
// module graph (see student-manager.html), read here as ambient globals
// and re-exported so every file that already imports them from this
// module keeps working unchanged.
//
// setStatus can't just be `createStatusSetter(els.statusLine)` at module
// top level like every other page does it: this file imports `els` from
// student-manager.js, which itself imports setStatus from HERE first —
// a genuine circular import. At the point this module's top-level code
// runs, student-manager.js hasn't reached its own `export const els =
// {...}` yet, so `els` is still in its temporal dead zone and touching
// `els.statusLine` throws "Cannot access 'els' before initialization".
// Deferring the lookup into the returned function — only ever called
// later, after every module has finished loading — sidesteps that.
let cachedSetStatus = null;

export function setStatus(message, type = "neutral") {
    if (!cachedSetStatus) {
        cachedSetStatus = createStatusSetter(els.statusLine);
    }

    cachedSetStatus(message, type);
}

export function setAddEnrollmentMessage(message = "", type = "neutral", { html = false } = {}) {
    if (html) {
        els.addEnrollmentMessage.innerHTML = message;
    } else {
        els.addEnrollmentMessage.textContent = message;
    }
    els.addEnrollmentMessage.classList.toggle("hidden", !message);
    els.addEnrollmentMessage.classList.toggle("is-error", type === "error");
}

export function setAddStudentMessage(message = "", type = "neutral", { html = false } = {}) {
    if (html) {
        els.addStudentMessage.innerHTML = message;
    } else {
        els.addStudentMessage.textContent = message;
    }
    els.addStudentMessage.classList.toggle("hidden", !message);
    els.addStudentMessage.classList.toggle("is-error", type === "error");
}

export const escapeHtml = window.escapeHtml;

export function formatBoolean(value) {
    if (value === true) {
        return "จริง";
    }

    if (value === false) {
        return "ยัง";
    }

    return value ?? "";
}

export function formatDate(dateText) {
    if (!dateText) {
        return "";
    }

    const [year, month, day] = String(dateText).slice(0, 10).split("-");

    if (!year || !month || !day) {
        return dateText;
    }

    return `${day}/${month}/${Number(year) + 543}`;
}

function mobileDigits(value) {
    return String(value || "").replace(/\D/g, "").slice(0, 10);
}

function formatMobile(value) {
    const digits = mobileDigits(value);

    if (digits.length <= 3) {
        return digits;
    }

    if (digits.length <= 6) {
        return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    }

    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function isValidMobile(value) {
    return mobileDigits(value).length === 10 && formatMobile(value).length === 12;
}

export function formatMobileField(field) {
    field.value = formatMobile(field.value);
}

function zipcodeDigits(value) {
    return String(value || "").replace(/\D/g, "").slice(0, 5);
}

export function isValidZipcode(value) {
    return /^\d{5}$/.test(String(value || ""));
}

export function formatZipcodeField(field) {
    field.value = zipcodeDigits(field.value);
}

export const requestJson = window.requestJson;

export function optionHtml(rows, {
    value,
    label,
    includeBlank = true,
    blankLabel = "-"
}) {
    const blank = includeBlank ? `<option value="">${escapeHtml(blankLabel)}</option>` : "";

    return `${blank}${rows.map((row) => `
        <option value="${escapeHtml(value(row))}">${escapeHtml(label(row))}</option>
    `).join("")}`;
}

export function setFormValue(form, name, value) {
    const field = form.elements[name];

    if (field) {
        if (field.type === "checkbox") {
            field.checked = value === true || value === "true" || value === "on" || value === "1";
            return;
        }

        field.value = value ?? "";
    }
}

export function setAutoFilled(form, name, isAutoFilled) {
    const field = form.elements[name];

    if (field) {
        field.classList.toggle("auto-filled", Boolean(isAutoFilled));
    }
}

export function clearAutoFilled(form) {
    [...form.elements].forEach((field) => {
        field.classList?.remove("auto-filled");
        if (field.dataset) {
            delete field.dataset.autoHalfMonth;
        }
    });
}

export function clearFieldError(field) {
    field?.classList?.remove("field-error");
}

export function clearFormErrors(form) {
    [...form.elements].forEach(clearFieldError);
}

export function markFieldError(form, name) {
    const field = form.elements[name];

    if (field) {
        field.classList.add("field-error");
    }

    return field;
}

export function focusFirstInvalidField(field) {
    if (!field) {
        return;
    }

    field.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => field.focus({ preventScroll: true }), 120);
}

export function selectInputText(input) {
    if (!input) {
        return;
    }

    input.select();
}

export function bindSelectAllInput(input, onFocus = null) {
    if (!input) {
        return;
    }

    input.addEventListener("focus", () => {
        selectInputText(input);
        onFocus?.();
    });
    input.addEventListener("mousedown", (event) => {
        if (document.activeElement === input) {
            event.preventDefault();
            selectInputText(input);
        }
    });
    input.addEventListener("click", () => selectInputText(input));
}

export function readForm(form) {
    const output = {};

    [...form.elements].forEach((field) => {
        if (!field.name || field.type === "submit" || field.type === "button") {
            return;
        }

        output[field.name] = field.type === "checkbox"
            ? field.checked
            : String(field.value ?? "").trim();
    });

    return output;
}
