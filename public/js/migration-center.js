// Migration previews and explicitly confirmed imports share one engine.
const previewState = {

    activeModule: null,

    student: null,

    enrollment: null,

    enrollment_status: null,

    billing: null,

    worksheet: null,

    attendance: null

};

let previewSelectionRevision = 0;
const previewRequests = new Map(), importingModules = new Set();
function beginPreviewRequest(moduleId) {
    const version = (previewRequests.get(moduleId) || 0) + 1;
    previewRequests.set(moduleId, version);
    return { moduleId, version, selection: ++previewSelectionRevision };
}
function applyPreviewResponse(request, data) {
    if (previewRequests.get(request.moduleId) !== request.version) return;
    showPreview(data, undefined, { activate: request.selection === previewSelectionRevision || previewState.activeModule === request.moduleId });
}

async function runDatabaseSetup() {

    const confirmed = await confirmAction(
        "จะรัน 001 -> 002 -> 003 ใหม่ทั้งหมด — ข้อมูลทั้งหมดในฐานข้อมูลปัจจุบันจะถูกลบถาวร แก้กลับไม่ได้\n\nยืนยันว่าจะดำเนินการต่อ?"
    );

    if (!confirmed) {
        return;
    }

    const button = document.getElementById("databaseSetupButton");
    const result = document.getElementById("databaseSetupResult");

    button.disabled = true;
    button.textContent = "⏳ Running...";

    result.className = "result show";
    result.textContent = "กำลังรัน 001 -> 002 -> 003 ...";

    try {

        const response = await fetch(
            "/api/migration/database/setup",
            { method: "POST" }
        );

        const data = await response.json();

        const stepLines = (data.steps || [])
            .map((step) => `${step.status === "OK" ? "✅" : "❌"} ${step.file || ""} ${step.message || ""}`.trim())
            .join("\n");

        if (!response.ok) {
            throw new Error(data.message || "Database setup failed");
        }

        result.className = "result show ready";
        result.textContent = `${data.message}\n\n${stepLines}`;

    } catch (error) {

        console.error(error);

        result.className = "result show error";
        result.textContent = `เกิดข้อผิดพลาด: ${error.message}`;

    } finally {

        button.disabled = false;
        button.textContent = "🗄️ Reinstall Database (001 → 002 → 003)";

    }

}

/* =========================================================
   Generic Migration Preview Engine
========================================================= */

const GENERIC_MIGRATION_MODULES = [
    {
        id: "student",
        title: "Student",
        shortTitle: "ST",
        description: "Basic student master data",
        previewReady: true,
        importReady: true,
        cardStats: ["New", "Skipped", "Errors"]
    },
    {
        id: "enrollment",
        title: "Enrollment",
        shortTitle: "EN",
        description: "Student subject enrollment records",
        previewReady: true,
        importReady: true,
        cardStats: ["New", "Skipped", "Errors"]
    },
    {
        id: "history",
        title: "History",
        shortTitle: "HI",
        description: "Enrollment and status history",
        previewReady: true,
        importReady: true,
        cardStats: ["New", "Skipped", "Errors"]
    },
    {
        id: "billing",
        title: "Billing",
        shortTitle: "BI",
        description: "Billing and billing detail records",
        previewReady: true,
        importReady: true,
        importNewLabel: "New Details",
        cardStats: ["New Details", "Skipped", "Errors"]
    },
    {
        id: "at",
        title: "AT",
        shortTitle: "AT",
        description: "Achievement test usage records",
        previewReady: true,
        importReady: true,
        cardStats: ["New", "Skipped", "Errors"]
    },
    {
        id: "dt",
        title: "DT",
        shortTitle: "DT",
        description: "Diagnostic test usage records",
        previewReady: true,
        importReady: true,
        cardStats: ["New", "Skipped", "Errors"]
    },
    {
        id: "ws",
        title: "WS",
        shortTitle: "WS",
        description: "Worksheet usage records",
        previewReady: true,
        importReady: true,
        serverPaginated: true,
        cardStats: ["New", "Skipped", "Errors"]
    },
    {
        id: "worksheet-receive",
        title: "Worksheet Receive",
        shortTitle: "RC",
        description: "Worksheet DO and receive records",
        previewReady: true,
        importReady: true,
        importNewLabel: "New Details",
        cardStats: ["New Details", "Skipped", "Errors"]
    },
    {
        id: "cd",
        title: "CD",
        shortTitle: "CD",
        description: "CD usage records",
        previewReady: true,
        importReady: true,
        cardStats: ["New", "Skipped", "Errors"]
    },
    {
        id: "stock",
        title: "Stock",
        shortTitle: "SK",
        description: "Worksheet stock quantity (WS only for now)",
        previewReady: true,
        importReady: true,
        importNewLabel: "Updated",
        cardStats: ["Updated", "Unchanged", "Skipped", "Errors"]
    }
];

const GENERIC_MODULE_MAP = new Map(
    GENERIC_MIGRATION_MODULES.map((moduleConfig) => [
        moduleConfig.id,
        moduleConfig
    ])
);

const GENERIC_DEFAULT_PAGE_SIZE = 50;
const GENERIC_PAGE_SIZE_OPTIONS = [20, 50, 100];

previewState.pageByModule = previewState.pageByModule || {};
previewState.pageSizeByModule = previewState.pageSizeByModule || {};
previewState.tablePageByModule = previewState.tablePageByModule || {};
previewState.tablePageSizeByModule = previewState.tablePageSizeByModule || {};
previewState.importedByModule = previewState.importedByModule || {};
previewState.rowFilterByModule = previewState.rowFilterByModule || {};

GENERIC_MIGRATION_MODULES.forEach((moduleConfig) => {
    if (!(moduleConfig.id in previewState)) {
        previewState[moduleConfig.id] = null;
    }
});

function initializeGenericMigrationCenter() {
    renderMigrationModuleCards();
    renderPreviewTabs();
    updatePreviewTabs("student");
    updateOverallStatus();
}

function updateOverallStatus() {
    const detail = document.getElementById("overallDetail");
    const status = document.getElementById("overallStatus");
    const progressBar = document.getElementById("progressBar");

    if (detail) {
        detail.textContent =
            "Migration preview shows New rows only; skipped and warnings stay in the summary.";
    }

    if (status) {
        status.textContent = "PREVIEW READY";
        status.className = "status warning";
    }

    if (progressBar) {
        const readyCount = GENERIC_MIGRATION_MODULES
            .filter((moduleConfig) => moduleConfig.previewReady)
            .length;

        progressBar.style.width =
            `${(readyCount / GENERIC_MIGRATION_MODULES.length) * 100}%`;
    }
}

function renderMigrationModuleCards() {
    const grid = document.querySelector("main.grid");

    if (!grid) {
        return;
    }

    grid.innerHTML = GENERIC_MIGRATION_MODULES
        .map(renderMigrationModuleCard)
        .join("");
}

function renderMigrationModuleCard(moduleConfig) {
    const statusText = moduleConfig.previewReady
        ? "PREVIEW READY"
        : "NOT STARTED";
    const cardClass = moduleConfig.previewReady
        ? "card active"
        : "card disabled";

    return `
        <section
            class="${cardClass}"
            data-migration-card="${moduleConfig.id}"
        >
            <div class="card-head">
                <div class="card-title">
                    <div class="icon">
                        ${escapeHtml(moduleConfig.shortTitle)}
                    </div>
                    <div>
                        <div class="name">
                            ${escapeHtml(moduleConfig.title)}
                        </div>
                        <div class="desc">
                            ${escapeHtml(moduleConfig.description)}
                        </div>
                    </div>
                </div>

                <span
                    class="status ${statusClass(statusText)}"
                    data-module-status="${moduleConfig.id}"
                >
                    ${escapeHtml(statusText)}
                </span>
            </div>

            <div
                class="stats"
                data-module-stats="${moduleConfig.id}"
            >
                ${renderCardStats(moduleConfig)}
            </div>

            <div class="actions">
                <button
                    id="${moduleConfig.id}PreviewButton"
                    class="${moduleConfig.previewReady ? "primary" : "secondary"}"
                    onclick="previewModule('${moduleConfig.id}')"
                >
                    ${moduleConfig.previewReady ? "Preview" : "Show Placeholder"}
                </button>

                ${renderImportButton(moduleConfig)}
            </div>
        </section>
    `;
}

function renderImportButton(moduleConfig) {
    if (!moduleConfig.importReady) {
        return `
            <button
                class="secondary"
                disabled
            >
                Migration
            </button>
        `;
    }

    return `
        <button
            id="${moduleConfig.id}ImportButton"
            class="danger"
            onclick="importModule('${moduleConfig.id}')"
            disabled
        >
            Import
        </button>
    `;
}

function renderCardStats(moduleConfig, data = null) {
    const summary = Array.isArray(data?.summary)
        ? data.summary
        : [];
    const hasImportSummary =
        summary.some((item) => item.label === "Inserted") &&
        summary.some((item) => item.label === "Skipped");
    const cardStats = hasImportSummary
        ? ["Inserted", "Skipped", "Errors"]
        : moduleConfig.cardStats;

    const statItems = cardStats.map((label) => {
        const match = summary.find((item) => item.label === label);

        return {
            label,
            value: match ? match.value : null
        };
    });

    return statItems
        .map((item) => `
            <div class="stat">
                <div class="stat-label">
                    ${escapeHtml(item.label)}
                </div>
                <div class="stat-value">
                    ${formatDisplayValue(item.value)}
                </div>
            </div>
        `)
        .join("");
}

function renderPreviewTabs() {
    const tabs = document.getElementById("previewTabs");

    if (!tabs) {
        return;
    }

    tabs.innerHTML = GENERIC_MIGRATION_MODULES
        .map((moduleConfig) => `
            <button
                class="preview-tab"
                data-module="${moduleConfig.id}"
                onclick="selectPreview('${moduleConfig.id}')"
            >
                ${escapeHtml(moduleConfig.title)}
            </button>
        `)
        .join("");
}

function showPreview(moduleOrData, maybeData, { activate = true } = {}) {
    const rawData = maybeData || moduleOrData;
    const moduleId = maybeData
        ? moduleOrData
        : rawData.module;
    const moduleConfig =
        GENERIC_MODULE_MAP.get(moduleId) ||
        GENERIC_MODULE_MAP.get(rawData.module);

    if (!moduleConfig) {
        return;
    }

    const data = normalizePreviewData(rawData, moduleConfig);

    previewState[moduleConfig.id] = data;
    ensureDefaultRowFilter(data);
    previewState.pageByModule[moduleConfig.id] =
        getInitialPage(data, moduleConfig.id);
    previewState.pageSizeByModule[moduleConfig.id] =
        getInitialPageSize(data, moduleConfig.id);
    initializePreviewTableState(data);

    if (activate) {
        previewState.activeModule = moduleConfig.id;
        renderPreview(data);
        updatePreviewTabs(moduleConfig.id);
    }
    updateModuleCard(moduleConfig.id, data);
}

function selectPreview(moduleId) {
    const moduleConfig = GENERIC_MODULE_MAP.get(moduleId);

    if (!moduleConfig) {
        return;
    }
    previewSelectionRevision++;

    let data = previewState[moduleId];

    if (!data) {
        data = buildClientPlaceholder(moduleConfig);
        previewState[moduleId] = data;
    }

    previewState.activeModule = moduleId;
    renderPreview(data);
    updatePreviewTabs(moduleId);
}

function updatePreviewTabs(activeModule) {
    document
        .querySelectorAll(".preview-tab")
        .forEach((button) => {
            button.classList.toggle(
                "active",
                button.dataset.module === activeModule
            );
        });
}

function renderPreview(data) {
    const content = document.getElementById("previewContent");
    const description = document.getElementById("previewDescription");
    const status = document.getElementById("previewStatus");

    if (!content || !description || !status) {
        return;
    }

    description.textContent = `${data.title} - Preview Result`;
    status.textContent = data.status || "READY";
    status.className = `status ${statusClass(data.status)}`;

    const hasTables = hasPreviewTables(data);
    const visibleRows = hasTables ? [] : getVisiblePreviewRows(data);
    const pagination = hasTables ? null : getPagination(data, visibleRows);
    const pageRows = hasTables
        ? []
        : visibleRows.slice(
            pagination.startIndex,
            pagination.endIndex
        );

    content.innerHTML = `
        <div class="preview-summary">
            ${renderPreviewSummary(data.summary)}
        </div>

        <div class="preview-validation">
            ${renderPreviewValidation(data.validation)}
        </div>

        ${
            hasTables
                ? renderPreviewTables(data)
                : `
                    <div class="preview-table-caption">
                        <div class="preview-table-title">
                            <span>New Preview Rows</span>
                        </div>
                        <span class="preview-note">
                            ${renderShowingText(pagination)}
                        </span>
                    </div>

                    ${renderPreviewTable(data.columns, pageRows, data)}
                    ${renderPaginationControls(data.module, pagination)}
                `
        }
    `;
}

function isServerPaginatedPreview(data) {
    return Boolean(
        data?.serverPaginated ||
        GENERIC_MODULE_MAP.get(data?.module)?.serverPaginated
    );
}

function hasPreviewTables(data) {
    return Array.isArray(data.tables) && data.tables.length > 0;
}

function initializePreviewTableState(data) {
    if (!hasPreviewTables(data)) {
        return;
    }

    data.tables.forEach((table) => {
        const key = previewTableStateKey(data.module, table.id);

        previewState.tablePageByModule[key] =
            getInitialTablePage(data.module, table);
        previewState.tablePageSizeByModule[key] =
            getInitialTablePageSize(data.module, table);
    });
}

function renderPreviewTables(data) {
    return data.tables
        .map((table) => {
            const pagination = getTablePagination(data.module, table);
            const pageRows = table.rows.slice(
                pagination.startIndex,
                pagination.endIndex
            );

            return `
                <section class="preview-table-section">
                    <div class="preview-table-caption">
                        <div class="preview-table-title">
                            <span>${escapeHtml(table.title)}</span>
                        </div>
                        <span class="preview-note">
                            ${renderShowingText(pagination)}
                        </span>
                    </div>

                    ${renderPreviewTable(table.columns, pageRows, table)}
                    ${renderTablePaginationControls(data.module, table.id, pagination)}
                </section>
            `;
        })
        .join("");
}

function renderPreviewSummary(summary) {
    if (!Array.isArray(summary) || summary.length === 0) {
        return previewStat("Records", null);
    }

    return summary
        .map((item) => previewStat(item.label, item.value))
        .join("");
}

function supportsPreviewRowFilter(data) {
    if (!["student", "enrollment"].includes(data.module)) {
        return false;
    }

    return data.rows.some((row) =>
        row.import_action !== undefined ||
        row.action !== undefined
    );
}

function ensureDefaultRowFilter(data) {
    if (!supportsPreviewRowFilter(data)) {
        return;
    }

    if (!previewState.rowFilterByModule[data.module]) {
        previewState.rowFilterByModule[data.module] = "new";
    }
}

function getPreviewRowFilter(data) {
    ensureDefaultRowFilter(data);

    return previewState.rowFilterByModule[data.module] || "all";
}

function getRowAction(row) {
    return String(row.import_action || row.action || "").toUpperCase();
}

function rowMatchesPreviewFilter(row, filterMode) {
    if (filterMode !== "new") {
        return true;
    }

    return getRowAction(row) === "INSERT";
}

function getVisiblePreviewRows(data) {
    if (!supportsPreviewRowFilter(data)) {
        return data.rows;
    }

    const filterMode = getPreviewRowFilter(data);

    return data.rows.filter((row) =>
        rowMatchesPreviewFilter(row, filterMode)
    );
}

function renderPreviewValidation(validation) {
    if (!Array.isArray(validation) || validation.length === 0) {
        return previewCheck({
            label: "Validation",
            status: "NOT STARTED"
        });
    }

    return validation
        .map((item) => previewCheck(item))
        .join("");
}

function renderPreviewTable(columns, rows, data = null) {
    if (!Array.isArray(columns) || columns.length === 0) {
        return `
            <div class="preview-empty">
                <div class="preview-empty-title">
                    No preview columns yet
                </div>
                <div class="preview-empty-detail">
                    This module is ready for a future adapter.
                </div>
            </div>
        `;
    }

    if (!Array.isArray(rows) || rows.length === 0) {
        const detail = data && data.rows.length > 0
            ? "No rows match the current filter."
            : "The preview returned zero rows.";

        return `
            <div class="preview-empty">
                <div class="preview-empty-title">
                    No preview rows
                </div>
                <div class="preview-empty-detail">
                    ${escapeHtml(detail)}
                </div>
            </div>
        `;
    }

    return `
        <div class="preview-table-wrapper">
            <table class="preview-table">
                <thead>
                    <tr>
                        ${
                            columns
                                .map((column) => `
                                    <th>
                                        ${escapeHtml(column.label)}
                                    </th>
                                `)
                                .join("")
                        }
                    </tr>
                </thead>
                <tbody>
                    ${
                        rows
                            .map((row) => `
                                <tr>
                                    ${
                                        columns
                                            .map((column) => `
                                                <td>
                                                    ${formatCellValue(row, column)}
                                                </td>
                                            `)
                                            .join("")
                                    }
                                </tr>
                            `)
                            .join("")
                    }
                </tbody>
            </table>
        </div>
    `;
}

function renderPaginationControls(moduleId, pagination) {
    const sizeOptions = pagination.pageSizeOptions.length > 0
        ? pagination.pageSizeOptions
        : GENERIC_PAGE_SIZE_OPTIONS;

    if (pagination.totalRows === 0) {
        return "";
    }

    return `
        <div class="preview-pagination">
            <div class="pagination-size">
                <span class="pagination-size-label">
                    Rows per page
                </span>
                ${
                    sizeOptions
                        .map((size) => `
                            <button
                                class="page-button ${size === pagination.pageSize ? "active" : ""}"
                                onclick="setPreviewPageSize('${moduleId}', ${size})"
                            >
                                ${size}
                            </button>
                        `)
                        .join("")
                }
            </div>

            <div class="pagination-controls">
                <button
                    class="page-button"
                    onclick="setPreviewPage('${moduleId}', ${pagination.page - 1})"
                    ${pagination.page <= 1 ? "disabled" : ""}
                >
                    Prev
                </button>

                ${
                    paginationPageItems(pagination.page, pagination.totalPages)
                        .map((pageItem) => {
                            if (pageItem === "...") {
                                return `<span class="page-ellipsis">...</span>`;
                            }

                            return `
                                <button
                                    class="page-button ${pageItem === pagination.page ? "active" : ""}"
                                    onclick="setPreviewPage('${moduleId}', ${pageItem})"
                                >
                                    ${pageItem}
                                </button>
                            `;
                        })
                        .join("")
                }

                <button
                    class="page-button"
                    onclick="setPreviewPage('${moduleId}', ${pagination.page + 1})"
                    ${pagination.page >= pagination.totalPages ? "disabled" : ""}
                >
                    Next
                </button>
            </div>
        </div>
    `;
}

function renderTablePaginationControls(moduleId, tableId, pagination) {
    const sizeOptions = pagination.pageSizeOptions.length > 0
        ? pagination.pageSizeOptions
        : GENERIC_PAGE_SIZE_OPTIONS;

    if (pagination.totalRows === 0) {
        return "";
    }

    return `
        <div class="preview-pagination">
            <div class="pagination-size">
                <span class="pagination-size-label">
                    Rows per page
                </span>
                ${
                    sizeOptions
                        .map((size) => `
                            <button
                                class="page-button ${size === pagination.pageSize ? "active" : ""}"
                                onclick="setPreviewTablePageSize('${moduleId}', '${tableId}', ${size})"
                            >
                                ${size}
                            </button>
                        `)
                        .join("")
                }
            </div>

            <div class="pagination-controls">
                <button
                    class="page-button"
                    onclick="setPreviewTablePage('${moduleId}', '${tableId}', ${pagination.page - 1})"
                    ${pagination.page <= 1 ? "disabled" : ""}
                >
                    Prev
                </button>

                ${
                    paginationPageItems(pagination.page, pagination.totalPages)
                        .map((pageItem) => {
                            if (pageItem === "...") {
                                return `<span class="page-ellipsis">...</span>`;
                            }

                            return `
                                <button
                                    class="page-button ${pageItem === pagination.page ? "active" : ""}"
                                    onclick="setPreviewTablePage('${moduleId}', '${tableId}', ${pageItem})"
                                >
                                    ${pageItem}
                                </button>
                            `;
                        })
                        .join("")
                }

                <button
                    class="page-button"
                    onclick="setPreviewTablePage('${moduleId}', '${tableId}', ${pagination.page + 1})"
                    ${pagination.page >= pagination.totalPages ? "disabled" : ""}
                >
                    Next
                </button>
            </div>
        </div>
    `;
}

function setPreviewPage(moduleId, page) {
    const data = previewState[moduleId];

    if (!data) {
        return;
    }

    const pagination = getPagination(data, getVisiblePreviewRows(data));
    const nextPage = clamp(
        Number(page),
        1,
        pagination.totalPages || 1
    );
    previewState.pageByModule[moduleId] = nextPage;

    if (isServerPaginatedPreview(data)) {
        refreshServerPaginatedPreview(
            moduleId,
            nextPage,
            pagination.pageSize
        );
        return;
    }

    renderPreview(data);
}

function setPreviewTablePage(moduleId, tableId, page) {
    const data = previewState[moduleId];
    const table = data?.tables?.find((item) => item.id === tableId);

    if (!data || !table) {
        return;
    }

    const pagination = getTablePagination(moduleId, table);
    previewState.tablePageByModule[previewTableStateKey(moduleId, tableId)] = clamp(
        Number(page),
        1,
        pagination.totalPages || 1
    );

    renderPreview(data);
}

function setPreviewPageSize(moduleId, pageSize) {
    const data = previewState[moduleId];

    if (!data) {
        return;
    }

    previewState.pageSizeByModule[moduleId] =
        normalizePageSize(pageSize, data.pagination?.pageSizeOptions);
    previewState.pageByModule[moduleId] = 1;

    if (isServerPaginatedPreview(data)) {
        refreshServerPaginatedPreview(
            moduleId,
            1,
            previewState.pageSizeByModule[moduleId]
        );
        return;
    }

    renderPreview(data);
}

function setPreviewTablePageSize(moduleId, tableId, pageSize) {
    const data = previewState[moduleId];
    const table = data?.tables?.find((item) => item.id === tableId);

    if (!data || !table) {
        return;
    }

    const key = previewTableStateKey(moduleId, tableId);

    previewState.tablePageSizeByModule[key] =
        normalizePageSize(pageSize, table.pagination?.pageSizeOptions);
    previewState.tablePageByModule[key] = 1;

    renderPreview(data);
}

async function previewModule(moduleId) {
    const moduleConfig = GENERIC_MODULE_MAP.get(moduleId);
    const button = document.getElementById(`${moduleId}PreviewButton`);

    if (!moduleConfig || !button || button.disabled || importingModules.has(moduleId)) {
        return;
    }
    const request = beginPreviewRequest(moduleId);

    button.disabled = true;
    button.textContent = "Previewing...";

    try {
        previewState.pageByModule[moduleId] = 1;
        const response = await fetchPreviewResponse(
            moduleId,
            1,
            previewState.pageSizeByModule[moduleId]
        );
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || "Preview failed");
        }

        applyPreviewResponse(request, data);
    } catch (error) {
        console.error(error);
        applyPreviewResponse(request, {
            module: moduleId,
            title: moduleConfig.title,
            status: "ERROR",
            summary: [
                { label: "Records", value: null },
                { label: "Errors", value: 1 }
            ],
            validation: [
                {
                    label: "Preview Request",
                    status: "ERROR",
                    errors: 1,
                    message: error.message
                }
            ],
            columns: [],
            rows: [],
            pagination: emptyPagination()
        });
    } finally {
        button.disabled = false;
        button.textContent = moduleConfig.previewReady
            ? "Preview Again"
            : "Show Placeholder";
        updateImportButton(moduleId);
    }
}

async function refreshServerPaginatedPreview(moduleId, page, pageSize) {
    const moduleConfig = GENERIC_MODULE_MAP.get(moduleId);

    if (!moduleConfig || importingModules.has(moduleId)) {
        return;
    }
    const request = beginPreviewRequest(moduleId);

    try {
        const response = await fetchPreviewResponse(moduleId, page, pageSize);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || "Preview failed");
        }

        applyPreviewResponse(request, data);
    } catch (error) {
        console.error(error);
        applyPreviewResponse(request, {
            module: moduleId,
            title: moduleConfig.title,
            status: "ERROR",
            summary: [
                { label: "Records", value: null },
                { label: "Errors", value: 1 }
            ],
            validation: [
                {
                    label: "Preview Request",
                    status: "ERROR",
                    errors: 1,
                    message: error.message
                }
            ],
            columns: [],
            rows: [],
            serverPaginated: true,
            pagination: emptyPagination()
        });
    }
}

function fetchPreviewResponse(moduleId, page, pageSize) {
    const moduleConfig = GENERIC_MODULE_MAP.get(moduleId);
    let url = `/api/migration/${moduleId}/preview`;

    if (moduleConfig?.serverPaginated) {
        const params = new URLSearchParams();

        params.set("page", String(page || 1));
        params.set(
            "pageSize",
            String(pageSize || GENERIC_DEFAULT_PAGE_SIZE)
        );
        url = `${url}?${params.toString()}`;
    }

    return fetch(url, {
        method: "POST"
    });
}

async function importModule(moduleId) {
    const moduleConfig = GENERIC_MODULE_MAP.get(moduleId);
    const importButton = document.getElementById(`${moduleId}ImportButton`);
    const previewButton = document.getElementById(`${moduleId}PreviewButton`);

    if (!moduleConfig || !moduleConfig.importReady || !importButton || importingModules.has(moduleId)) {
        return;
    }

    if (!canImportModule(moduleId)) {
        await showAppMessage(importRequirementText(moduleId));
        updateImportButton(moduleId);
        return;
    }

    if (!await confirmAction(importConfirmationText(moduleId))) {
        return;
    }
    if (importingModules.has(moduleId) || !canImportModule(moduleId)) return;
    importingModules.add(moduleId);
    const request = beginPreviewRequest(moduleId);

    importButton.disabled = true;
    importButton.textContent = "Importing...";

    if (previewButton) {
        previewButton.disabled = true;
    }

    try {
        const response = await fetch(
            `/api/migration/${moduleId}/import`,
            {
                method: "POST"
            }
        );
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || "Import failed");
        }

        applyPreviewResponse(request, data);

        if (String(data.status || "").toUpperCase() !== "ERROR") {
            previewState.importedByModule[moduleId] = true;
        }
    } catch (error) {
        console.error(error);
        applyPreviewResponse(request, {
            module: moduleId,
            title: `${moduleConfig.title} Import`,
            status: "ERROR",
            summary: [
                { label: "Inserted", value: 0 },
                { label: "Skipped", value: 0 },
                { label: "Errors", value: 1 }
            ],
            validation: [
                {
                    label: "Import Request",
                    status: "ERROR",
                    errors: 1,
                    message: error.message
                }
            ],
            columns: [],
            rows: [],
            pagination: emptyPagination()
        });
    } finally {
        importingModules.delete(moduleId);
        if (previewButton) {
            previewButton.disabled = false;
        }

        importButton.textContent = "Import";
        updateAllImportButtons();
    }
}

function updateAllImportButtons() {
    GENERIC_MIGRATION_MODULES.forEach((moduleConfig) =>
        updateImportButton(moduleConfig.id)
    );
}

function updateImportButton(moduleId) {
    const button = document.getElementById(`${moduleId}ImportButton`);

    if (!button) {
        return;
    }

    button.disabled = !canImportModule(moduleId);
    button.title = button.disabled
        ? importRequirementText(moduleId)
        : "";
}

function canImportModule(moduleId) {
    const moduleConfig = GENERIC_MODULE_MAP.get(moduleId);
    const data = previewState[moduleId];

    if (!moduleConfig?.importReady || !data || importingModules.has(moduleId)) {
        return false;
    }

    if (hasBlockingPreviewError(data)) {
        return false;
    }

    if (importNewCount(moduleConfig, data) <= 0) {
        return false;
    }

    if (moduleId === "enrollment" && !previewState.importedByModule.student) {
        return false;
    }

    return true;
}

function hasBlockingPreviewError(data) {
    const status = String(data.status || "").toUpperCase();

    if (status === "ERROR" || status === "FAILED") {
        return true;
    }

    return Array.isArray(data.validation) && data.validation.some((item) =>
        String(item.status || "").toUpperCase() === "ERROR"
    );
}

function importRequirementText(moduleId) {
    const data = previewState[moduleId];

    const moduleConfig = GENERIC_MODULE_MAP.get(moduleId);

    if (data && importNewCount(moduleConfig, data) <= 0) {
        return "ไม่มี New rows สำหรับ Import";
    }

    if (moduleId === "enrollment" && !previewState.importedByModule.student) {
        return "Import Student ให้สำเร็จก่อน แล้วค่อย Import Enrollment";
    }

    return "ต้อง Preview module นี้ให้ผ่าน validation ก่อน Import";
}

function summaryValue(data, label) {
    const item = Array.isArray(data?.summary)
        ? data.summary.find((summaryItem) => summaryItem.label === label)
        : null;

    return Number(item?.value || 0);
}

function importNewCount(moduleConfig, data) {
    return summaryValue(data, moduleConfig?.importNewLabel || "New");
}

function importConfirmationText(moduleId) {
    if (moduleId === "student") {
        return "ยืนยัน Import Student จริงหรือไม่? ระบบจะเพิ่มเฉพาะนักเรียนที่ยังไม่มี และข้ามชื่อเดิมที่เจอด้วย first_name + last_name";
    }

    if (moduleId === "enrollment") {
        return "ยืนยัน Import Enrollment จริงหรือไม่? ระบบจะเพิ่มเฉพาะ enrollment ที่ยังไม่มี และข้าม student_id + subject_id ที่มีอยู่แล้ว";
    }

    if (moduleId === "worksheet-receive") {
        return "ยืนยัน Import Worksheet Receive จริงหรือไม่? ระบบจะเพิ่มเฉพาะ DO/detail ที่ยังไม่มี และข้าม Type ที่ไม่ใช่ WS";
    }

    if (moduleId === "billing") {
        return "ยืนยัน Import Billing จริงหรือไม่? ระบบจะเพิ่มเฉพาะ receipt/detail ที่ยังไม่มี";
    }

    if (moduleId === "ws") {
        return "ยืนยัน Import WS จริงหรือไม่? ไฟล์นี้มีขนาดใหญ่ ระบบจะเพิ่มเฉพาะ worksheet_used ที่ยังไม่มี";
    }

    return "ยืนยัน Import จริงหรือไม่?";
}

function previewStudent() {
    previewModule("student");
}

function updateModuleCard(moduleId, data) {
    const moduleConfig = GENERIC_MODULE_MAP.get(moduleId);
    const card = document.querySelector(
        `[data-migration-card="${moduleId}"]`
    );

    if (!moduleConfig || !card) {
        return;
    }

    const status = card.querySelector(
        `[data-module-status="${moduleId}"]`
    );
    const stats = card.querySelector(
        `[data-module-stats="${moduleId}"]`
    );

    card.classList.toggle("active", data.status !== "NOT STARTED");
    card.classList.toggle("disabled", data.status === "NOT STARTED");

    if (status) {
        status.textContent = data.status || "READY";
        status.className = `status ${statusClass(data.status)}`;
    }

    if (stats) {
        stats.innerHTML = renderCardStats(moduleConfig, data);
    }

    updateImportButton(moduleId);
}

function normalizePreviewData(data, moduleConfig) {
    const rows = Array.isArray(data.rows)
        ? data.rows
        : Array.isArray(data.previewRows)
            ? data.previewRows
            : [];
    const summary = Array.isArray(data.summary)
        ? data.summary
        : legacySummary(data);
    const validation = Array.isArray(data.validation)
        ? data.validation
        : legacyValidation(data);
    const columns = Array.isArray(data.columns)
        ? data.columns
        : legacyColumns(moduleConfig.id);
    const tables = Array.isArray(data.tables)
        ? data.tables.map((table) => normalizePreviewTable(table))
        : [];

    const pagination = {
        ...emptyPagination(),
        ...(data.pagination || {})
    };

    if (!data.serverPaginated && !moduleConfig.serverPaginated) {
        pagination.totalRows = rows.length;
    }

    return {
        module: data.module || moduleConfig.id,
        title: data.title || moduleConfig.title,
        status: data.status || "READY",
        serverPaginated: Boolean(data.serverPaginated || moduleConfig.serverPaginated),
        summary,
        validation,
        columns,
        rows,
        tables,
        pagination
    };
}

function normalizePreviewTable(table) {
    const rows = Array.isArray(table.rows)
        ? table.rows
        : [];
    const columns = Array.isArray(table.columns)
        ? table.columns
        : [];

    return {
        id: table.id || "preview_table",
        title: table.title || "Preview Rows",
        columns,
        rows,
        pagination: {
            ...emptyPagination(),
            ...(table.pagination || {}),
            totalRows: rows.length
        }
    };
}

function legacySummary(data) {
    if (data.csvRecords !== undefined) {
        return [
            { label: "CSV Records", value: data.csvRecords },
            { label: "Unique", value: data.uniqueStudents },
            { label: "Duplicate", value: data.duplicateCount },
            { label: "Blocked", value: data.blockedRows },
            { label: "Missing Name", value: data.missingNameCount }
        ];
    }

    return [
        { label: "Records", value: null },
        { label: "New", value: null },
        { label: "Skipped", value: null },
        { label: "Errors", value: null },
        { label: "Warnings", value: null }
    ];
}

function legacyValidation(data) {
    const errors = data.lookupErrors || {};

    if (Object.keys(errors).length === 0) {
        return [
            {
                label: "Preview Adapter",
                status: data.status || "NOT STARTED",
                errors: null
            }
        ];
    }

    return [
        { label: "Prefix Master", status: errors.prefix ? "ERROR" : "READY", errors: errors.prefix || 0 },
        { label: "Gender Master", status: errors.gender ? "ERROR" : "READY", errors: errors.gender || 0 },
        { label: "School Grade Master", status: errors.schoolGrade ? "ERROR" : "READY", errors: errors.schoolGrade || 0 },
        { label: "Birth Date", status: errors.birthDate ? "ERROR" : "READY", errors: errors.birthDate || 0 }
    ];
}

function legacyColumns(moduleId) {
    if (moduleId !== "student") {
        return [];
    }

    return [
        { key: "row_number", label: "#" },
        { key: "prefix_id", label: "Prefix" },
        { key: "first_name", label: "First Name" },
        { key: "last_name", label: "Last Name" },
        { key: "nickname", label: "Nickname" },
        { key: "gender_id", label: "Gender" },
        { key: "birth_date", label: "Birth Date" },
        { key: "school_grade_id", label: "Grade" },
        { key: "school_name", label: "School" },
        { key: "mobile", label: "Mobile" },
        { key: "email", label: "Email" },
        { key: "address_number", label: "Address No." },
        { key: "address_village", label: "Village" },
        { key: "address_alley", label: "Alley" },
        { key: "address_road", label: "Road" },
        { key: "address_subdistrict", label: "Subdistrict" },
        { key: "address_district", label: "District" },
        { key: "address_province", label: "Province" },
        { key: "address_zipcode", label: "Zipcode" },
        { key: "remark", label: "Remark" },
        { key: "created_at", label: "Created At", defaultValue: "DB default" },
        { key: "updated_at", label: "Updated At", defaultValue: "DB default" }
    ];
}

function buildClientPlaceholder(moduleConfig) {
    const status = moduleConfig.previewReady
        ? "PREVIEW READY"
        : "NOT STARTED";

    return {
        module: moduleConfig.id,
        title: moduleConfig.title,
        status,
        summary: [
            { label: "Records", value: null },
            { label: "New", value: null },
            { label: "Skipped", value: null },
            { label: "Errors", value: null },
            { label: "Warnings", value: null }
        ],
        validation: [
            {
                label: "Preview Adapter",
                status,
                errors: null
            }
        ],
        columns: [],
        rows: [],
        pagination: emptyPagination()
    };
}

function emptyPagination() {
    return {
        page: 1,
        pageSize: GENERIC_DEFAULT_PAGE_SIZE,
        pageSizeOptions: GENERIC_PAGE_SIZE_OPTIONS,
        totalRows: 0,
        totalPages: 0,
        startRow: 0,
        endRow: 0
    };
}

function getPagination(data, rows = data.rows) {
    if (isServerPaginatedPreview(data)) {
        const totalRows = Number(data.pagination?.totalRows || rows.length);
        const pageSize = normalizePageSize(
            data.pagination?.pageSize ||
            previewState.pageSizeByModule[data.module] ||
            GENERIC_DEFAULT_PAGE_SIZE,
            data.pagination?.pageSizeOptions
        );
        const totalPages = Math.ceil(totalRows / pageSize);
        const page = totalPages === 0
            ? 1
            : clamp(
                Number(data.pagination?.page || previewState.pageByModule[data.module] || 1),
                1,
                totalPages
            );

        previewState.pageByModule[data.module] = page;
        previewState.pageSizeByModule[data.module] = pageSize;

        return {
            page,
            pageSize,
            pageSizeOptions: data.pagination?.pageSizeOptions || GENERIC_PAGE_SIZE_OPTIONS,
            totalRows,
            allRows: totalRows,
            totalPages,
            startIndex: 0,
            endIndex: rows.length,
            startRow: data.pagination?.startRow || (totalRows === 0 ? 0 : (page - 1) * pageSize + 1),
            endRow: data.pagination?.endRow || Math.min(page * pageSize, totalRows)
        };
    }

    const totalRows = rows.length;
    const allRows = data.rows.length;
    const pageSize = getInitialPageSize(data, data.module);
    const totalPages = Math.ceil(totalRows / pageSize);
    const page = totalPages === 0
        ? 1
        : clamp(getInitialPage(data, data.module), 1, totalPages);
    const startIndex = totalRows === 0
        ? 0
        : (page - 1) * pageSize;
    const endIndex = Math.min(startIndex + pageSize, totalRows);

    previewState.pageByModule[data.module] = page;
    previewState.pageSizeByModule[data.module] = pageSize;

    return {
        page,
        pageSize,
        pageSizeOptions: data.pagination?.pageSizeOptions || GENERIC_PAGE_SIZE_OPTIONS,
        totalRows,
        allRows,
        totalPages,
        startIndex,
        endIndex,
        startRow: totalRows === 0 ? 0 : startIndex + 1,
        endRow: endIndex
    };
}

function getTablePagination(moduleId, table) {
    const totalRows = table.rows.length;
    const allRows = table.rows.length;
    const pageSize = getInitialTablePageSize(moduleId, table);
    const totalPages = Math.ceil(totalRows / pageSize);
    const page = totalPages === 0
        ? 1
        : clamp(getInitialTablePage(moduleId, table), 1, totalPages);
    const startIndex = totalRows === 0
        ? 0
        : (page - 1) * pageSize;
    const endIndex = Math.min(startIndex + pageSize, totalRows);
    const key = previewTableStateKey(moduleId, table.id);

    previewState.tablePageByModule[key] = page;
    previewState.tablePageSizeByModule[key] = pageSize;

    return {
        page,
        pageSize,
        pageSizeOptions: table.pagination?.pageSizeOptions || GENERIC_PAGE_SIZE_OPTIONS,
        totalRows,
        allRows,
        totalPages,
        startIndex,
        endIndex,
        startRow: totalRows === 0 ? 0 : startIndex + 1,
        endRow: endIndex
    };
}

function getInitialPage(data, moduleId) {
    return Number(
        previewState.pageByModule[moduleId] ||
        data.pagination?.page ||
        1
    );
}

function getInitialPageSize(data, moduleId) {
    return normalizePageSize(
        previewState.pageSizeByModule[moduleId] ||
        data.pagination?.pageSize ||
        GENERIC_DEFAULT_PAGE_SIZE,
        data.pagination?.pageSizeOptions
    );
}

function previewTableStateKey(moduleId, tableId) {
    return `${moduleId}:${tableId}`;
}

function getInitialTablePage(moduleId, table) {
    return Number(
        previewState.tablePageByModule[previewTableStateKey(moduleId, table.id)] ||
        table.pagination?.page ||
        1
    );
}

function getInitialTablePageSize(moduleId, table) {
    return normalizePageSize(
        previewState.tablePageSizeByModule[previewTableStateKey(moduleId, table.id)] ||
        table.pagination?.pageSize ||
        GENERIC_DEFAULT_PAGE_SIZE,
        table.pagination?.pageSizeOptions
    );
}

function normalizePageSize(pageSize, options = GENERIC_PAGE_SIZE_OPTIONS) {
    const allowedOptions = Array.isArray(options) && options.length > 0
        ? options
        : GENERIC_PAGE_SIZE_OPTIONS;
    const size = Number(pageSize);

    return allowedOptions.includes(size)
        ? size
        : GENERIC_DEFAULT_PAGE_SIZE;
}

function renderShowingText(pagination) {
    if (pagination.totalRows === 0) {
        return pagination.allRows > 0
            ? `Showing 0 of ${pagination.allRows.toLocaleString("en-US")} rows`
            : "Showing 0 rows";
    }

    const text = `Showing ${pagination.startRow.toLocaleString("en-US")}-${pagination.endRow.toLocaleString("en-US")} of ${pagination.totalRows.toLocaleString("en-US")} rows`;

    if (pagination.allRows && pagination.allRows !== pagination.totalRows) {
        return `${text} (${pagination.allRows.toLocaleString("en-US")} total)`;
    }

    return text;
}

function paginationPageItems(page, totalPages) {
    if (totalPages <= 7) {
        return Array.from(
            { length: totalPages },
            (_, index) => index + 1
        );
    }

    const pages = new Set([
        1,
        totalPages,
        page - 2,
        page - 1,
        page,
        page + 1,
        page + 2
    ]);
    const sortedPages = [...pages]
        .filter((item) => item >= 1 && item <= totalPages)
        .sort((a, b) => a - b);
    const output = [];

    sortedPages.forEach((item, index) => {
        if (index > 0 && item - sortedPages[index - 1] > 1) {
            output.push("...");
        }

        output.push(item);
    });

    return output;
}

function previewStat(label, value) {
    return `
        <div class="preview-stat">
            <div class="preview-stat-label">
                ${escapeHtml(label)}
            </div>
            <div class="preview-stat-value">
                ${formatDisplayValue(value)}
            </div>
        </div>
    `;
}

function previewCheck(itemOrLabel, maybeCount) {
    const item = typeof itemOrLabel === "object"
        ? itemOrLabel
        : {
            label: itemOrLabel,
            status: Number(maybeCount) === 0 ? "READY" : "ERROR",
            errors: maybeCount
        };
    const status = String(item.status || "READY").toUpperCase();
    const className = validationClass(status);
    const detail = item.message
        ? `
            <span class="preview-check-detail">
                ${escapeHtml(item.message)}
            </span>
        `
        : "";

    return `
        <div
            class="preview-check"
            title="${escapeHtml(item.message || "")}"
        >
            <span class="preview-check-name">
                ${escapeHtml(item.label)}
            </span>
            <span class="${className}">
                ${escapeHtml(validationText(item))}
            </span>
            ${detail}
        </div>
    `;
}

function validationText(item) {
    const status = String(item.status || "READY").toUpperCase();

    if (status === "NOT STARTED" || status === "PREVIEW READY") {
        return status;
    }

    if (status === "READY") {
        return `${Number(item.errors || 0).toLocaleString("en-US")} errors`;
    }

    if (status === "WARNING") {
        const warnings = item.warnings ?? item.errors ?? 0;

        return `${Number(warnings).toLocaleString("en-US")} warnings`;
    }

    if (item.errors === null || item.errors === undefined) {
        return status;
    }

    return `${Number(item.errors).toLocaleString("en-US")} errors`;
}

function validationClass(status) {
    if (status === "READY") {
        return "preview-check-ok";
    }

    if (status === "ERROR") {
        return "preview-check-error";
    }

    if (status === "WARNING") {
        return "preview-check-warning";
    }

    return "preview-check-todo";
}

function statusClass(status) {
    const normalized = String(status || "").toUpperCase();

    if (normalized === "ERROR" || normalized === "FAILED") {
        return "error";
    }

    if (normalized === "WARNING" || normalized === "PREVIEW READY") {
        return "warning";
    }

    if (normalized === "NOT STARTED" || normalized === "WAITING") {
        return "todo";
    }

    return "ready";
}

function formatDisplayValue(value) {
    if (value === null || value === undefined || value === "") {
        return "&mdash;";
    }

    if (typeof value === "number" && Number.isFinite(value)) {
        return value.toLocaleString("en-US");
    }

    return escapeHtml(value);
}

function formatCellValue(row, column) {
    const value = row[column.key];

    if (
        (value === null || value === undefined || value === "") &&
        column.defaultValue !== undefined
    ) {
        return escapeHtml(column.defaultValue);
    }

    return formatDisplayValue(value);
}

function clamp(value, min, max) {
    const numberValue = Number.isFinite(value)
        ? value
        : min;

    return Math.min(
        Math.max(numberValue, min),
        max
    );
}

function escapeHtml(value) {
    if (value === null || value === undefined) {
        return "";
    }

    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

window.previewModule = previewModule;
window.importModule = importModule;
window.previewStudent = previewStudent;
window.selectPreview = selectPreview;
window.setPreviewPage = setPreviewPage;
window.setPreviewPageSize = setPreviewPageSize;
window.setPreviewTablePage = setPreviewTablePage;
window.setPreviewTablePageSize = setPreviewTablePageSize;

if (document.readyState === "loading") {
    document.addEventListener(
        "DOMContentLoaded",
        initializeGenericMigrationCenter
    );
} else {
    initializeGenericMigrationCenter();
}
