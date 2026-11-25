// Shared across every page (loaded as a plain classic script, before each
// page's own script/module — module scripts can read this as an ambient
// global the same way they read `fetch`/`document`, no import needed).
// Pages can provide their existing error message through fallbackMessage.
async function requestJson(url, options = {}, fallbackMessage = "Request failed") {
    const headers = new Headers(options.headers);
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await fetch(url, {
        ...options,
        headers
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || data.success === false) {
        const error = new Error(data.error || fallbackMessage);
        error.statusCode = response.status;
        throw error;
    }

    return data;
}
