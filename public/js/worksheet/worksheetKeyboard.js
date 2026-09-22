export function bindWorksheetKeyboard(root, callbacks) {
    root.addEventListener("keydown", (event) => {
        const worksheetInput = event.target.closest("[data-ws-input]");

        if (worksheetInput) {
            if (event.key === "ArrowUp") {
                event.preventDefault();
                callbacks.stepWorksheet(
                    worksheetInput.dataset.kind,
                    Number(worksheetInput.dataset.index),
                    1
                );
                return;
            }

            if (event.key === "ArrowDown") {
                event.preventDefault();
                callbacks.stepWorksheet(
                    worksheetInput.dataset.kind,
                    Number(worksheetInput.dataset.index),
                    -1
                );
                return;
            }

            if (event.key === "Enter") {
                event.preventDefault();
                callbacks.advanceWorksheet(
                    worksheetInput.dataset.kind,
                    Number(worksheetInput.dataset.index)
                );
                return;
            }

            // Zun worksheet numbers never include 0 (they start at 1), and
            // Zun is the only one of these selects with a blank "-" option
            // (Main WS is required, never blank) — so typing 0 is free to
            // mean "clear this back to -" instead of doing nothing, which
            // is what the browser's default option-typeahead would do
            // (no option's text starts with "0", so it wouldn't match).
            if (event.key === "0" && worksheetInput.dataset.kind === "zun") {
                event.preventDefault();
                worksheetInput.value = "";
                worksheetInput.dispatchEvent(new Event("change", { bubbles: true }));
                return;
            }

            return;
        }

        if (event.target.id === "receiveDate") {
            if (event.key === "ArrowLeft") {
                event.preventDefault();
                callbacks.shiftDate(-1);
            }

            if (event.key === "ArrowRight") {
                event.preventDefault();
                callbacks.shiftDate(1);
            }
        }
    });
}
