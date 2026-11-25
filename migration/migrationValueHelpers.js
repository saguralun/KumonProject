// Pure value parsing and issue summaries shared by migration modules.
// Keep importer-specific date/default rules in their own modules.

export function clean(value) {
    if (value === undefined || value === null) {
        return "";
    }

    return String(value)
        .replace(/\uFEFF/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

export function nullable(value) {
    const text = clean(value);

    return text || null;
}

export function lookupKey(value) {
    return clean(value).toLowerCase();
}

export function masterKey(...parts) {
    return parts.map((part) => lookupKey(part)).join("|");
}

export function previewKey(...parts) {
    return masterKey(...parts);
}

export function pad2(value) {
    return String(value).padStart(2, "0");
}

export function isValidDate(year, month, day) {
    const date = new Date(Date.UTC(year, month - 1, day));

    return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
    );
}

export function parseDateToAd(value, label) {
    const text = clean(value);

    if (!text) {
        return {
            value: null,
            error: `${label} is required.`
        };
    }

    const match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/);

    if (!match) {
        return {
            value: null,
            error: `${label} must use dd/mm/yyyy: ${text}`
        };
    }

    const day = Number(match[1]);
    const month = Number(match[2]);
    let year = Number(match[3]);

    if (year < 100) {
        year += year >= 70 ? 1900 : 2000;
    }

    if (year > 2400) {
        year -= 543;
    }

    if (!isValidDate(year, month, day)) {
        return {
            value: null,
            error: `${label} is invalid: ${text}`
        };
    }

    return {
        value: `${year}-${pad2(month)}-${pad2(day)}`,
        error: null
    };
}

export function parsePositiveInteger(value, label) {
    const text = clean(value);

    if (!text) {
        return {
            value: null,
            error: `${label} is required.`
        };
    }

    if (!/^\d+$/.test(text)) {
        return {
            value: null,
            error: `${label} must be a positive integer: ${text}`
        };
    }

    const numberValue = Number(text);

    if (!Number.isSafeInteger(numberValue) || numberValue < 1) {
        return {
            value: null,
            error: `${label} must be a positive integer: ${text}`
        };
    }

    return {
        value: numberValue,
        error: null
    };
}

export function parseMonth(value, label) {
    const parsed = parsePositiveInteger(value, label);

    if (parsed.error) {
        return parsed;
    }

    if (parsed.value < 1 || parsed.value > 12) {
        return {
            value: parsed.value,
            error: `${label} must be 1-12: ${parsed.value}`
        };
    }

    return parsed;
}

export function parseYear(value, label) {
    const parsed = parsePositiveInteger(value, label);

    if (parsed.error) {
        return parsed;
    }

    if (parsed.value < 1900 || parsed.value > 2500) {
        return {
            value: parsed.value,
            error: `${label} is outside expected range: ${parsed.value}`
        };
    }

    return parsed;
}

export function parseBoolean(value, label) {
    const text = lookupKey(value);

    if (["true", "t", "yes", "y", "1"].includes(text)) {
        return {
            value: true,
            error: null
        };
    }

    if (["false", "f", "no", "n", "0"].includes(text)) {
        return {
            value: false,
            error: null
        };
    }

    return {
        value: null,
        error: `${label} must be TRUE or FALSE: ${clean(value) || "(blank)"}`
    };
}

export function parseLevelCode(value, candidateCodes, label = "Level") {
    const text = clean(value).toUpperCase();

    if (!text) {
        return {
            levelCode: null,
            error: `${label} is required.`
        };
    }

    for (const code of candidateCodes) {
        if (text === code) {
            return {
                levelCode: code,
                error: null
            };
        }

        const suffix = text.slice(code.length);

        if (text.startsWith(code) && /^\d+$/.test(suffix)) {
            return {
                levelCode: code,
                error: null
            };
        }
    }

    return {
        levelCode: null,
        error: `Cannot derive ${label.toLowerCase()} code from: ${text}`
    };
}

export function sortedLevelCodes(levels) {
    return levels
        .map((level) => level.level_code)
        .sort((a, b) => b.length - a.length || a.localeCompare(b));
}

export function issueList(issueMap) {
    return [...issueMap.values()]
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

export function issueCount(issueMap) {
    return [...issueMap.values()]
        .reduce((sum, issue) => sum + issue.count, 0);
}

export function countIssueMaps(issueMaps) {
    return Object.fromEntries(
        Object.entries(issueMaps).map(([key, value]) => [key, issueCount(value)])
    );
}

export function hasValidationErrors(previewResult) {
    return previewResult.validation.some((item) =>
        String(item.status || "").toUpperCase() === "ERROR"
    );
}

export function validationItem(label, errorCount, warningCount = 0) {
    if (errorCount > 0) {
        return {
            label,
            status: "ERROR",
            errors: errorCount
        };
    }

    if (warningCount > 0) {
        return {
            label,
            status: "WARNING",
            errors: 0,
            warnings: warningCount
        };
    }

    return {
        label,
        status: "READY",
        errors: 0
    };
}
