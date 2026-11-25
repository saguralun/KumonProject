import { httpError } from "./httpError.js";

// Use local calendar fields: database dates must not shift with UTC conversion.
export function normalizeDate(value) {
    if (value instanceof Date) {
        const year = value.getFullYear();
        const month = String(value.getMonth() + 1).padStart(2, "0");
        const day = String(value.getDate()).padStart(2, "0");

        return `${year}-${month}-${day}`;
    }

    if (typeof value === "string") {
        return value.slice(0, 10);
    }

    return "";
}

// Stock responses retain their historical null/loose-value contract.
export function normalizeNullableDate(value) {
    if (value instanceof Date) return normalizeDate(value);
    return value ? String(value).slice(0, 10) : null;
}

export function assertIsoDate(value, label) {
    const dateText = normalizeDate(value);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
        throw httpError(400, `${label} ไม่ถูกต้อง`);
    }

    return dateText;
}
