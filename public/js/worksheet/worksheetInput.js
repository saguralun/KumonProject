export function normalizeWorksheetNo(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }

    const numberValue = Number(value);

    if (!Number.isInteger(numberValue) || numberValue < 1) {
        return null;
    }

    return numberValue;
}

export function addDays(dateText, days) {
    if (!dateText) {
        return "";
    }

    const [year, month, day] = dateText.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    date.setDate(date.getDate() + days);
    const nextYear = date.getFullYear();
    const nextMonth = String(date.getMonth() + 1).padStart(2, "0");
    const nextDay = String(date.getDate()).padStart(2, "0");

    return `${nextYear}-${nextMonth}-${nextDay}`;
}

export function formatDateDisplay(dateText) {
    if (!dateText) {
        return "";
    }

    const match = String(dateText).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (!match) {
        return String(dateText);
    }

    const year = Number(match[1]) + 543;

    return `${match[3]}/${match[2]}/${year}`;
}

export function selectedPattern(patterns, patternCode) {
    return patterns.find((pattern) => pattern.code === patternCode)
        || patterns.find((pattern) => pattern.code === "daily10")
        || patterns[0]
        || null;
}

export function worksheetInputCount(pattern) {
    return pattern?.code === "daily20" ? 2 : 1;
}

export function moveWorksheetNo(currentValue, options, direction) {
    const worksheetNos = options.map((option) => option.worksheetNo);

    if (worksheetNos.length === 0) {
        return "";
    }

    const currentNo = normalizeWorksheetNo(currentValue);
    let index = worksheetNos.indexOf(currentNo);

    if (index === -1) {
        index = direction > 0 ? 0 : worksheetNos.length - 1;
    } else {
        index = Math.max(0, Math.min(worksheetNos.length - 1, index + direction));
    }

    return String(worksheetNos[index]);
}

export function isValidWorksheetNo(value, options) {
    const worksheetNo = normalizeWorksheetNo(value);

    return options.some((option) => option.worksheetNo === worksheetNo);
}

function worksheetBaseNo(startNo) {
    return Math.floor((startNo - 1) / 10) * 10;
}

function actualNoFromSuffix(startNo, suffix) {
    return worksheetBaseNo(startNo) + suffix;
}

function buildGroupPreview({
    receiveDate,
    pattern,
    kind,
    levelCode,
    options,
    worksheetNos,
    required
}) {
    const records = [];
    const validOptions = new Set(options.map((option) => option.worksheetNo));
    const normalizedNos = Array.isArray(worksheetNos)
        ? worksheetNos.map(normalizeWorksheetNo)
        : [];

    if (!pattern) {
        return records;
    }

    if (pattern.code === "daily20") {
        const selectedNos = normalizedNos.slice(0, 2);

        if (required && selectedNos.filter(Boolean).length < 2) {
            return records;
        }

        selectedNos.forEach((worksheetNo) => {
            if (!worksheetNo || !validOptions.has(worksheetNo)) {
                return;
            }

            records.push({
                kind,
                levelCode,
                worksheetNo,
                packetWorksheetNo: worksheetNo,
                worksheetLabel: `${levelCode}${worksheetNo}`,
                worksheetDate: receiveDate,
                cpws: true
            });
        });

        return records;
    }

    const startNo = normalizedNos[0];

    if (!startNo || !validOptions.has(startNo)) {
        return records;
    }

    pattern.suffixes.forEach((suffix, index) => {
        const worksheetNo = actualNoFromSuffix(startNo, suffix);

        records.push({
            kind,
            levelCode,
            worksheetNo,
            packetWorksheetNo: startNo,
            worksheetLabel: `${levelCode}${worksheetNo}`,
            worksheetDate: addDays(receiveDate, pattern.dayOffsets[index]),
            cpws: index === 0
        });
    });

    return records;
}

export function buildPreviewRecords({
    context,
    pattern,
    receiveDate,
    mainWorksheetNos,
    zunWorksheetNos
}) {
    if (!context || !pattern || !receiveDate) {
        return [];
    }

    const enrollment = context.enrollment;
    const forceKumonConnect = enrollment.isKumonConnect === true;
    const mainRecords = buildGroupPreview({
        receiveDate,
        pattern,
        kind: "WS",
        levelCode: enrollment.currentLevelCode,
        options: context.worksheetOptions.main,
        worksheetNos: mainWorksheetNos,
        required: true
    });
    const zunRecords = enrollment.currentZunLevelMasterId
        ? buildGroupPreview({
            receiveDate,
            pattern,
            kind: "ZUN",
            levelCode: enrollment.currentZunLevelCode,
            options: context.worksheetOptions.zun,
            worksheetNos: zunWorksheetNos,
            required: false
        })
        : [];

    return [...mainRecords, ...zunRecords].map((record) => forceKumonConnect
        ? {
            ...record,
            cpws: false,
            isKumonConnect: true
        }
        : record
    ).sort((a, b) => (
        a.worksheetDate === b.worksheetDate
            ? a.kind.localeCompare(b.kind)
            : a.worksheetDate.localeCompare(b.worksheetDate)
    ));
}

export function requiredMainReady(pattern, mainWorksheetNos) {
    const count = worksheetInputCount(pattern);

    return mainWorksheetNos.slice(0, count).filter((value) => (
        normalizeWorksheetNo(value)
    )).length === count;
}

// From htmlUtil.js — a plain classic script loaded before this module
// graph (see worksheet.html), read here as an ambient global and
// re-exported so every file that already imports it from here keeps
// working unchanged.
export const escapeHtml = window.escapeHtml;
