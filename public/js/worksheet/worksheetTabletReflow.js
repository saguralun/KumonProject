// WS Input tablet layout: moves the Save/receive-CD button pair
// (.preview-actions) between its normal spot inside .preview-header
// (desktop/full-screen — .preview-panel with its record list is the
// right place for them there) and the top student-strip card, alongside
// WS/day + Subject, at <=1120px (.preview-panel is hidden entirely at
// that width per feedback — the record list isn't shown there, so
// there's nothing left to anchor the buttons to where they normally
// live).
//
// This is a real DOM move, not a duplicate: #saveButton/#receiveCd keep
// whatever click listeners worksheet.js already attached to them (moving
// a node doesn't detach its listeners), so there's exactly one Save
// button/one source of truth for its disabled state — no proxy button,
// no syncing logic. Pure CSS can't do this on its own: .student-strip
// and .preview-panel are separate sections, not nested in a common
// grid/flattenable ancestor, so there's no way to reposition an element
// from one into the other without actually moving it. deliberately
// self-contained (not part of the worksheet.js module graph) — this is
// a layout concern, not part of the WS-entry business logic.
(function () {
  const actions = document.querySelector(".preview-actions");
  const desktopParent = actions ? actions.parentElement : null;
  const tabletSlot = document.getElementById("stripActionsSlot");

  if (!actions || !desktopParent || !tabletSlot) {
    return;
  }

  const mql = window.matchMedia("(max-width: 1120px)");

  function reflow() {
    const target = mql.matches ? tabletSlot : desktopParent;

    if (actions.parentElement !== target) {
      target.appendChild(actions);
    }
  }

  reflow();
  mql.addEventListener("change", reflow);
})();
