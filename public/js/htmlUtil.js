// Shared across every page (loaded as a plain classic script, before each
// page's own script/module — module scripts can read this as an ambient
// global the same way they read `fetch`/`document`, no import needed).
// This one function body used to be copy-pasted into 11 different files —
// two of those copies (opening-schedule.js, users.js) were missing the
// single-quote escape the other nine had, an inconsistency fixed by
// unifying onto this one implementation.
function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
