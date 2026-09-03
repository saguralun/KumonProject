// Shared across every page — drives the sidebar nav's flyout submenus
// (งานประจำ/จัดการ/คลัง/ระบบ) open/closed via real mouseenter/mouseleave
// instead of CSS `:hover`.
//
// Why: `:hover` is purely positional — it applies the instant the page
// renders if the cursor already happens to be resting over the element,
// with no concept of "did the pointer actually just cross in". That's
// exactly what happens after clicking a link inside a flyout: the new
// page loads with the SAME sidebar layout, the cursor is still sitting at
// the same screen position (now over whichever trigger renders there on
// this page), and its flyout pops open on its own — looking like a
// random floating menu the user never asked for, right after navigating.
// A real mouseenter event has no such retroactive case: it only fires on
// a genuine boundary-crossing pointer move, so it can't fire just because
// the page happened to load under the cursor.
//
// Pairs with app-scale.css's `.nav-flyout.nav-flyout-open .nav-flyout-*`
// rules (which replaced the old `.nav-flyout:hover .nav-flyout-*` ones —
// see the comment there). `.nav-flyout::after` (the small bridge covering
// the visual gap between trigger and menu) still works unchanged here:
// it's a descendant of `.nav-flyout`, so moving the pointer over it still
// keeps `.nav-flyout` "entered" for mouseenter/mouseleave the same way it
// did for :hover.
(function () {
  function init() {
    document.querySelectorAll(".nav-flyout").forEach((flyout) => {
      flyout.addEventListener("mouseenter", () => {
        flyout.classList.add("nav-flyout-open");
      });
      flyout.addEventListener("mouseleave", () => {
        flyout.classList.remove("nav-flyout-open");
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
