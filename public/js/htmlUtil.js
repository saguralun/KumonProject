// Shared across every page (loaded as a plain classic script, before each
// page's own script/module — module scripts can read this as an ambient
// global the same way they read `fetch`/`document`, no import needed).
// Keep escaping consistent for normal pages and the Migration Center.
function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
