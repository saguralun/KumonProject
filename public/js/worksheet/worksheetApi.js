async function requestJson(url, options = {}) {
    const response = await fetch(url, {
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {})
        },
        ...options
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || data.success === false) {
        throw new Error(data.error || "Request failed");
    }

    return data;
}

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

    async getHistory(enrollmentId, limit = 20) {
        const params = new URLSearchParams({
            limit: String(limit)
        });

        return requestJson(
            `/api/worksheet/enrollments/${encodeURIComponent(enrollmentId)}/history?${params.toString()}`
        );
    },

    async saveEntries(payload) {
        return requestJson("/api/worksheet/entries", {
            method: "POST",
            body: JSON.stringify(payload)
        });
    }
};
