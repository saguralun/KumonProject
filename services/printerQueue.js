// One physical printer receives complete jobs in order, even when operators
// continue taking payments while earlier requests are still sending bytes.
export function createPrinterQueue(send) {
    let tail = Promise.resolve();
    return payload => {
        const job = tail.then(() => send(payload));
        // Preserve each caller's error without poisoning subsequent jobs.
        tail = job.catch(() => {});
        return job;
    };
}
