// From httpUtil.js — a plain classic script loaded before this module
// graph (see worksheet.html), read here as an ambient global.

export const worksheetApi = {
    async searchEnrollments({
        query,
        mode,
        subject,
        limit = 20
    }) {
        const params = new URLSearchParams({
            query: query || "",
            mode: mode || "id",
            subject: subject || "ALL",
            limit: String(limit)
        });

        return requestJson(`/api/worksheet/search?${params.toString()}`);
    },

    async getEnrollmentContext(enrollmentId, historyLimit = 20) {
        const params = new URLSearchParams({
            historyLimit: String(historyLimit)
        });

        return requestJson(
            `/api/worksheet/enrollments/${encodeURIComponent(enrollmentId)}/context?${params.toString()}`
        );
    },

    async getHistory(enrollmentId, limit = 30, {
        billingDate
    } = {}) {
        const params = new URLSearchParams({
            limit: String(limit)
        });

        if (billingDate) {
            params.set("billingDate", billingDate);
        }

        return requestJson(
            `/api/worksheet/enrollments/${encodeURIComponent(enrollmentId)}/history?${params.toString()}`
        );
    },

    async getWorksheetSummary(enrollmentId, {
        billingDate,
        billingMonth,
        billingYear
    } = {}) {
        const params = new URLSearchParams();

        if (billingDate) {
            params.set("billingDate", billingDate);
        }

        if (billingMonth) {
            params.set("billingMonth", String(billingMonth));
        }

        if (billingYear) {
            params.set("billingYear", String(billingYear));
        }

        return requestJson(
            `/api/worksheet/enrollments/${encodeURIComponent(enrollmentId)}/worksheet-summary?${params.toString()}`
        );
    },

    async getIncompleteWorksheets() {
        return requestJson("/api/worksheet/incomplete-ws");
    },

    async saveEntries(payload) {
        return requestJson("/api/worksheet/entries", {
            method: "POST",
            body: JSON.stringify(payload)
        });
    },

    async saveAtCompletion(payload) {
        return requestJson("/api/worksheet/at-completion", {
            method: "POST",
            body: JSON.stringify(payload)
        });
    },

    async completeZunLevel(payload) {
        return requestJson("/api/worksheet/zun-completion", {
            method: "POST",
            body: JSON.stringify(payload)
        });
    },

    async completeWorksheetLevel(payload) {
        return requestJson("/api/worksheet/level-completion", {
            method: "POST",
            body: JSON.stringify(payload)
        });
    },

    async receiveCd(payload) {
        return requestJson("/api/worksheet/cd/receive", {
            method: "POST",
            body: JSON.stringify(payload)
        });
    },

    async deleteEntry({
        enrollmentId,
        worksheetUsedId
    }) {
        return requestJson(
            `/api/worksheet/entries/${encodeURIComponent(worksheetUsedId)}`,
            {
                method: "DELETE",
                body: JSON.stringify({ enrollmentId })
            }
        );
    }
};
