// Shared DOM text selection, independent of page state.
export function selectInputText(input) {
    if (!input) {
        return;
    }

    input.select();
}

export function bindSelectAllInput(input, onFocus = null) {
    if (!input) {
        return;
    }

    input.addEventListener("focus", () => {
        selectInputText(input);
        onFocus?.();
    });
    input.addEventListener("mousedown", (event) => {
        if (document.activeElement === input) {
            event.preventDefault();
            selectInputText(input);
        }
    });
    input.addEventListener("click", () => selectInputText(input));
}
