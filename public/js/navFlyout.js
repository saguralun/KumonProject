// Pointer events avoid opening menus when navigation renders under a stationary cursor.
(function () {
  function init() {
    const groups = [];
    document.querySelectorAll('.nav-flyout').forEach((flyout, index) => {
      const trigger = flyout.querySelector('.nav-flyout-trigger');
      const menu = flyout.querySelector('.nav-flyout-menu');
      if (!trigger || !menu) return;
      const panel = flyout.closest('.app-menu-panel');
      menu.id ||= `appMenuGroup${index}`;
      trigger.setAttribute('aria-controls', menu.id);
      let pinned = false, hovered = false, closeTimer;
      function position() {
        if (!panel || !flyout.classList.contains('nav-flyout-open')) return;
        const anchor = trigger.getBoundingClientRect(), panelRect = panel.getBoundingClientRect();
        if (anchor.bottom <= panelRect.top || anchor.top >= panelRect.bottom) { close(); return; }
        // Fixed positioning escapes panel scrolling while preserving its focus trap.
        const width = Math.min(240, innerWidth - 24), right = panelRect.right + 8;
        menu.style.width = `${width}px`;
        menu.style.left = `${right + width <= innerWidth - 12 ? right : Math.max(12, innerWidth - width - 12)}px`;
        menu.style.top = `${Math.max(12, Math.min(anchor.top, innerHeight - menu.getBoundingClientRect().height - 12))}px`;
      }
      function close() {
        clearTimeout(closeTimer); pinned = hovered = false;
        flyout.classList.remove('nav-flyout-open'); trigger.setAttribute('aria-expanded', 'false');
      }
      function open() {
        clearTimeout(closeTimer);
        groups.forEach(group => { if (group.close !== close) group.close(); });
        flyout.classList.add('nav-flyout-open'); trigger.setAttribute('aria-expanded', 'true'); position();
      }
      groups.push({ close });
      close();
      flyout.addEventListener('mouseenter', () => {
        if (!matchMedia('(hover: hover)').matches) return;
        hovered = true; open();
      });
      flyout.addEventListener("mouseleave", () => {
        hovered = false;
        // Keep the flyout open while the pointer crosses the gap beside the panel.
        closeTimer = setTimeout(() => { if (!pinned && !flyout.contains(document.activeElement)) close(); }, 180);
      });
      trigger.addEventListener('click', (event) => {
        const next = event.detail > 0 && hovered && !pinned ? true : !flyout.classList.contains('nav-flyout-open');
        if (next) { pinned = true; open(); } else close();
      });
      trigger.addEventListener('keydown', (event) => {
        if (['ArrowDown', 'ArrowRight'].includes(event.key)) {
          event.preventDefault(); pinned = true; open();
          [...menu.querySelectorAll('a[href]')].find(link => link.getClientRects().length && getComputedStyle(link).visibility !== 'hidden')?.focus();
        }
      });
      flyout.addEventListener('keydown', event => {
        if (event.key === 'ArrowLeft') { event.preventDefault(); close(); trigger.focus(); }
      });
      flyout.addEventListener('focusout', event => { if (!flyout.contains(event.relatedTarget) && !hovered) close(); });
      panel?.addEventListener('scroll', position, { passive: true });
      window.addEventListener('resize', position);
      document.addEventListener('app:menu-change', event => { if (!event.detail.open) close(); });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
