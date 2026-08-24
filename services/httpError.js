// Shared helper for building errors that carry an HTTP status code.
// Routes read `error.statusCode` to decide the response status.
export function httpError(statusCode, message) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}
