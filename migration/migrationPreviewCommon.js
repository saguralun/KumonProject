export const DEFAULT_PAGE_SIZE = 50;
export const PAGE_SIZE_OPTIONS = [20, 50, 100];

export function buildPagination(rows) {
    return {
        page: 1,
        pageSize: DEFAULT_PAGE_SIZE,
        pageSizeOptions: PAGE_SIZE_OPTIONS,
        totalRows: rows.length,
        totalPages: Math.ceil(rows.length / DEFAULT_PAGE_SIZE),
        startRow: rows.length > 0 ? 1 : 0,
        endRow: Math.min(DEFAULT_PAGE_SIZE, rows.length)
    };
}

export function buildNewOnlySummary({
    records,
    newRows,
    skipped,
    errors,
    warnings,
    details = []
}) {
    return [
        { label: "Records", value: records },
        { label: "New", value: newRows },
        { label: "Skipped", value: skipped },
        { label: "Errors", value: errors },
        { label: "Warnings", value: warnings },
        ...details
    ];
}

export function statusFromIssueCounts(errorCount, warningCount) {
    if (errorCount > 0) {
        return "ERROR";
    }

    if (warningCount > 0) {
        return "WARNING";
    }

    return "READY";
}
