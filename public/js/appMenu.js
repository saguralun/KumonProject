// One overlay menu for every workspace. Never persists an open menu across pages.
(function () {
  function init() {
    const page = document.querySelector('body > main, body > .migration-shell');
    const panel = page?.querySelector(':scope > aside');
    const workspace = page && [...page.children].find((element) => element.matches('section, .migration-workspace'));
    const header = workspace?.querySelector('.topbar, .header');
    const toggle = header?.querySelector('.app-menu-toggle');
    if (!panel || !toggle || page.dataset.menuReady === 'true') return;
    page.dataset.menuReady = 'true';

    function iconButton(icon, label) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'app-menu-icon-button';
      button.setAttribute('aria-label', label); button.title = label; button.dataset.tooltip = label;
      const image = document.createElement('img');
      image.src = `/icons/lucide/${icon}.svg`; image.alt = ''; image.width = image.height = 20;
      button.append(image); return button;
    }
    const heading = document.createElement('div'); heading.className = 'app-menu-heading';
    const title = document.createElement('strong'); title.textContent = 'เมนูหลัก';
    const closeButton = iconButton('x', 'ปิดเมนู'); closeButton.classList.add('app-menu-close');
    heading.append(title, closeButton); panel.prepend(heading);
    const backdrop = document.createElement('button'); backdrop.type = 'button'; backdrop.id = 'appMenuBackdrop'; page.append(backdrop);
    backdrop.className = 'app-menu-backdrop'; backdrop.setAttribute('aria-label', 'ปิดเมนู'); backdrop.tabIndex = -1;
    let opened = false, previousFocus;
    const focusable = () => [...panel.querySelectorAll('a[href],button,input,select,textarea,[tabindex="0"]')]
      .filter((element) => !element.disabled && !element.inert && element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden');
    function setOpen(value, restoreFocus = true) {
      if (opened === value) return;
      if (value) previousFocus = document.activeElement;
      opened = value;
      page.classList.toggle('app-menu-open', value);
      toggle.setAttribute('aria-expanded', String(value)); toggle.setAttribute('aria-label', value ? 'ปิดเมนู' : 'เปิดเมนู');
      panel.setAttribute('aria-hidden', String(!value)); panel.inert = !value; workspace.inert = value;
      if (value) closeButton.focus({ preventScroll: true });
      else {
        panel.querySelectorAll('.nav-flyout-open').forEach((flyout) => {
          flyout.classList.remove('nav-flyout-open'); flyout.querySelector('.nav-flyout-trigger')?.setAttribute('aria-expanded', 'false');
        });
        if (restoreFocus) (previousFocus?.isConnected ? previousFocus : toggle).focus({ preventScroll: true });
      }
      document.dispatchEvent(new CustomEvent('app:menu-change', { detail: { open: value } }));
    }
    toggle.setAttribute('aria-expanded', 'false'); panel.setAttribute('aria-hidden', 'true'); panel.inert = true;
    toggle.addEventListener('click', () => setOpen(!opened)); closeButton.addEventListener('click', () => setOpen(false)); backdrop.addEventListener('click', () => setOpen(false));
    panel.addEventListener('click', (event) => {
      if (event.target.closest('a[href]')) setOpen(false, false);
    });
    document.addEventListener('keydown', (event) => {
      if (!opened || document.querySelector('dialog[open]')) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); }
      if (event.key === 'Tab') {
        const elements = focusable(), first = elements[0], last = elements.at(-1);
        if (!first) { event.preventDefault(); closeButton.focus(); return; }
        if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    }, true);
    window.addEventListener('pagehide', () => setOpen(false, false));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
