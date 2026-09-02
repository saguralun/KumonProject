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
//
// One thing it DOES have to watch for: several pages (student-manager.css
// at <=820px, and others may add their own) fall back to a stacked mobile
// layout below some width of their own choosing, where the sidebar stops
// being a narrow side column and becomes a full-width section on top of
// the workspace instead. The drawer concept — collapse the narrow rail to
// widen the workspace next to it — doesn't apply there (there's no "next
// to it"), and worse, the handle's fixed position would float on top of
// whatever the sidebar's own content now is. Rather than hardcode every
// page's own breakpoint here (fragile, and each page picks its own), this
// detects it directly: if the sidebar's rendered width is a large share
// of the viewport, it's stacked, not a side rail, so the handle hides
// itself and any collapsed state is set aside (not cleared — just not
// applied) until the layout is a side-by-side one again.
(function () {
  const STORAGE_KEY = "appSidebarCollapsed";
  const STACKED_WIDTH_RATIO = 0.5;

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

    function isStacked() {
      const width = sidebar.getBoundingClientRect().width;
      return width > 0 && width > window.innerWidth * STACKED_WIDTH_RATIO;
    }

    function applyState(collapsed) {
      page.classList.toggle("rail-collapsed", collapsed);
      toggle.setAttribute("aria-expanded", String(!collapsed));
    }

    function refresh() {
      const stacked = isStacked();
      page.classList.toggle("drawer-unavailable", stacked);
      applyState(!stacked && localStorage.getItem(STORAGE_KEY) === "true");
    }

    refresh();
    // ResizeObserver on the sidebar itself (not window "resize") is the
    // robust signal here: it fires whenever the sidebar's own box
    // actually changes size for ANY reason — a window/viewport resize
    // crossing one of its media query breakpoints, an orientation
    // change, even a font/zoom change — without needing to know which
    // event type caused it. window "resize" is kept too as a cheap
    // fallback for engines without ResizeObserver.
    if (typeof ResizeObserver === "function") {
      new ResizeObserver(refresh).observe(sidebar);
    } else {
      window.addEventListener("resize", refresh);
    }

    toggle.addEventListener("click", () => {
      if (page.classList.contains("drawer-unavailable")) return;
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
