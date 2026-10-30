// Compatibility exports for already-running versions during the update that
// retires automatic schema upgrades. New application code does not call these.
// Keep them inert: no inspection, backup, DDL or database connection.
export { paymentDatabaseStatus } from './databaseStatusService.js';

export async function preparePaymentDatabase() {
    return { ready: true, applied: false, retired: true };
}
export const prepareApplicationDatabase = preparePaymentDatabase;
