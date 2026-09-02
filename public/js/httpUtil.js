// Shared across every page (loaded as a plain classic script, before each
// page's own script/module — module scripts can read this as an ambient
// global the same way they read `fetch`/`document`, no import needed).
// This one function body used to be copy-pasted into 12 different files.
async function requestJson(url, options = {}, fallbackMessage = "Request failed") {
    const response = await fetch(url, {
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {})
        },
        ...options
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || data.success === false) {
        throw new Error(data.error || fallbackMessage);
    }

    return data;
}
