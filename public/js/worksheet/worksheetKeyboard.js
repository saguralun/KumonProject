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
