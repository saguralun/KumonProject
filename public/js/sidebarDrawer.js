// Shared sidebar-drawer toggle — a thin dark edge-handle that collapses
// the page's sidebar so the workspace can use the full screen width.
// This is the one central implementation for every page: it locates the
// page's <main class="*-page"> root and its sidebar (<aside>, always the
// main's direct child, whatever its own class name is — subject-rail,
// payment-sidebar, student-sidebar, ...) generically, so a page only
// needs to include this script to get the drawer; no per-page markup or
// wiring is required. A page with no <aside> (login.html) is a silent
// no-op. Collapsed/expanded state persists in localStorage and is shared
// across every page, so it stays consistent as you navigate around.
//
// Pairs with the CSS in app-scale.css: .rail-collapse-toggle (the handle
// itself, positioned/animated there) and the .<page>-page.rail-collapsed
// rules (which hide the matched sidebar and let the page's grid go full
// width). This file only ever toggles the `rail-collapsed` class — it
// has no opinion on layout.
(function () {
  const STORAGE_KEY = "appSidebarCollapsed";

  function init() {
    const page = document.querySelector("body > main");
    if (!page) return;

    const sidebar = page.querySelector(":scope > aside");
    if (!sidebar) return;

    let toggle = page.querySelector(":scope > .rail-collapse-toggle");
    if (!toggle) {
      toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "rail-collapse-toggle";
      toggle.setAttribute("aria-label", "Toggle sidebar");
      page.insertBefore(toggle, page.firstChild);
    }

    function applyState(collapsed) {
      page.classList.toggle("rail-collapsed", collapsed);
      toggle.setAttribute("aria-expanded", String(!collapsed));
    }

    applyState(localStorage.getItem(STORAGE_KEY) === "true");

    toggle.addEventListener("click", () => {
      const collapsed = !page.classList.contains("rail-collapsed");
      applyState(collapsed);
      localStorage.setItem(STORAGE_KEY, String(collapsed));
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
