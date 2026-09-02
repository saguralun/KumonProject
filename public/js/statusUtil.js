// Shared across every page (loaded as a plain classic script, before each
// page's own script/module). Unlike requestJson/escapeHtml this can't just
// be one global function — every page has its own #statusLine element —
// so this is a small factory instead: each page calls
// `const setStatus = createStatusSetter(els.statusLine);` once, keeping
// every existing `setStatus(message, "error")` call site unchanged.
function createStatusSetter(statusLineEl) {
    return function setStatus(message, type = "neutral") {
        statusLineEl.textContent = message;
        statusLineEl.classList.toggle("is-error", type === "error");
    };
}
