function normalizeDateYear(input) {
    const value = String(input.value || "");
    const match = value.match(/^(\d{5,})-(\d{2})-(\d{2})$/);

    if (!match) {
        return;
    }

    input.value = `${match[1].slice(-4)}-${match[2]}-${match[3]}`;
}

export function bindFourDigitYearDateInputs(root = document) {
    root.querySelectorAll('input[type="date"]').forEach((input) => {
        if (!input.max) {
            input.max = "9999-12-31";
        }

        ["input", "change", "blur"].forEach((eventName) => {
            input.addEventListener(eventName, () => normalizeDateYear(input));
        });
    });
}
