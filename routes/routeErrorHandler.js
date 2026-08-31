// Every route file had its own exact copy of this function, differing only
// in the fallback error message used when a thrown error has no .message.
// createSendError(defaultMessage) returns one bound to that file's message,
// so each route file keeps its own wording with zero behavior change.
export function createSendError(defaultMessage) {
    return function sendError(res, error) {
        const statusCode = error.statusCode || 500;

        if (statusCode >= 500) {
            console.error(error);
        }

        res.status(statusCode).json({
            success: false,
            error: error.message || defaultMessage
        });
    };
}
