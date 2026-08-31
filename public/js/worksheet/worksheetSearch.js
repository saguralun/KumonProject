// Student search + selection. loadEnrollmentContext is imported from the
// main worksheet.js — that's a circular import (worksheet.js's bindEvents
// also imports from this file), which is fine here because both directions
// are only ever called from inside event handlers, never at module-load
// time, so by the time either runs, every module involved has already
// finished initializing.
import { els, setStatus, state } from "./worksheetState.js";
import { escapeHtml } from "./worksheetInput.js";
import { worksheetApi } from "./worksheetApi.js";
import { loadEnrollmentContext } from "./worksheet.js";

export function renderSearchResults() {
    const rows = state.searchResults;

    if (!rows.length) {
        els.searchResults.innerHTML = `<div class="empty-state">ไม่พบเด็ก</div>`;
        els.searchResults.classList.remove("hidden");
        return;
    }

    els.searchResults.innerHTML = rows.map((row, index) => `
        <button
            type="button"
            class="result-item ${index === state.activeResultIndex ? "is-active" : ""}"
            data-index="${index}"
            role="option"
        >
            <span class="result-id">#${escapeHtml(row.enrollmentId)}</span>
            <span class="result-name">${escapeHtml(row.studentName)}</span>
            <span class="result-subject">${escapeHtml(row.subjectCode)} ${escapeHtml(row.currentLevelCode)}</span>
        </button>
    `).join("");
    els.searchResults.classList.remove("hidden");
}

export async function runSearch() {
    const requestId = state.searchRequestId + 1;
    state.searchRequestId = requestId;

    try {
        const data = await worksheetApi.searchEnrollments({
            query: els.studentSearch.value,
            mode: state.searchMode,
            subject: state.subjectFilter,
            limit: 30
        });

        if (requestId !== state.searchRequestId) {
            return;
        }

        state.searchResults = data.rows || [];
        state.activeResultIndex = state.searchResults.length ? 0 : -1;
        renderSearchResults();
    } catch (error) {
        setStatus(error.message, "error");
    }
}

export function queueSearch() {
    window.clearTimeout(state.searchTimer);
    state.searchTimer = window.setTimeout(runSearch, 140);
}

export function selectStudentSearchText() {
    window.requestAnimationFrame(() => {
        if (document.activeElement === els.studentSearch) {
            els.studentSearch.select();
        }
    });
}

export async function selectSearchResult(index) {
    const row = state.searchResults[index];

    if (!row) {
        return;
    }

    els.studentSearch.value = `#${row.enrollmentId} ${row.studentName}`;
    els.searchResults.classList.add("hidden");
    await loadEnrollmentContext(row.enrollmentId);
}

export function setSubjectFilter(subject) {
    state.subjectFilter = subject;
    els.subjectButtons.querySelectorAll(".subject-button").forEach((button) => {
        button.classList.toggle("active", button.dataset.subject === subject);
    });
    queueSearch();
    els.studentSearch.focus();
    selectStudentSearchText();
}

export function setSearchMode(mode) {
    state.searchMode = mode;
    els.searchMode.querySelectorAll(".mode-button").forEach((button) => {
        button.classList.toggle("active", button.dataset.mode === mode);
    });
    els.studentSearch.placeholder = mode === "id"
        ? "Enrollment ID"
        : "ชื่อเด็ก";
    els.studentSearch.select();
    queueSearch();
}

export function populateStudentStrip(context) {
    const enrollment = context.enrollment;

    els.studentStrip.classList.remove("is-empty");
    els.studentName.innerHTML = `
        <span>${escapeHtml(enrollment.studentName)}</span>
        ${enrollment.isKumonConnect ? `<span class="student-name-badge">KC</span>` : ""}
    `;
    els.studentMeta.textContent = [
        `ID ${enrollment.enrollmentId}`,
        enrollment.subjectCode,
        `Current ${enrollment.currentLevelCode}`,
        enrollment.currentZunLevelCode ? `Zun ${enrollment.currentZunLevelCode}` : "No Zun",
        enrollment.statusName
    ].filter(Boolean).join(" • ");
    els.studentSubjectSelect.disabled = false;
    els.studentSubjectSelect.innerHTML = context.studentEnrollments.map((item) => `
        <option value="${escapeHtml(item.enrollmentId)}" ${item.enrollmentId === enrollment.enrollmentId ? "selected" : ""}>
            ${escapeHtml(item.subjectCode)} - ${escapeHtml(item.currentLevelCode)}
            ${item.currentZunLevelCode ? ` / Zun ${escapeHtml(item.currentZunLevelCode)}` : ""}
        </option>
    `).join("");
}
