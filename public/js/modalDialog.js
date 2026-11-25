// Keep focus inside a native modal while preserving each page's own save and
// cancel rules. Native top-layer behavior also blocks mouse/background focus.
export function createModalDialog(dialog, { initialFocus, returnFocus, onCancel } = {}) {
    let opener = null;
    const usable = element => element?.isConnected && !element.disabled
        && !element.closest('[inert]') && element.getClientRects().length > 0;
    const focusables = () => [...dialog.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')]
        .filter(element => element.tabIndex >= 0 && usable(element));

    function show() {
        if (!dialog.open) {
            opener = document.activeElement;
            dialog.classList.remove('hidden');
            dialog.showModal();
        }
        const target = initialFocus?.() || focusables()[0] || dialog;
        target.focus({ preventScroll: true });
    }

    function close({ restoreFocus = true } = {}) {
        const wasOpen = dialog.open;
        dialog.classList.add('hidden');
        if (wasOpen) dialog.close();
        if (wasOpen && restoreFocus) {
            const target = usable(opener) && !dialog.contains(opener) ? opener : returnFocus?.();
            if (usable(target)) target.focus({ preventScroll: true });
        }
    }

    function cancel() {
        if (onCancel) onCancel(); else close();
    }
    dialog.addEventListener('cancel', event => {
        event.preventDefault();
        cancel();
    });
    dialog.addEventListener('mousedown', event => {
        if (event.target !== dialog) return;
        // Closing during mousedown must not let the browser subsequently
        // focus the now-hidden dialog instead of the restored opener.
        event.preventDefault();
        cancel();
    });
    dialog.addEventListener('close', () => {
        // An old queued close event must not hide a dialog already reopened.
        if (!dialog.open) dialog.classList.add('hidden');
    });
    dialog.addEventListener('keydown', event => {
        if (event.key !== 'Tab') return;
        const items = focusables(), first = items[0], last = items.at(-1), active = document.activeElement;
        if (!first) { event.preventDefault(); dialog.focus(); }
        else if (event.shiftKey && (active === first || !items.includes(active))) {
            event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (active === last || !items.includes(active))) {
            event.preventDefault(); first.focus();
        }
    }, true);
    return { show, close };
}
