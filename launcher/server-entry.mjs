// A small entry point can record module loading before importing the server's
// static dependency graph. Direct `node server.js` remains supported.
import { reportStartupStage } from '../services/startupProgressService.js';

reportStartupStage('modules');
// Observe fatal startup errors without swallowing them or changing Node's exit.
process.on('uncaughtExceptionMonitor', () => reportStartupStage('error'));
try {
    await import('../server.js');
} catch (error) {
    reportStartupStage('error');
    throw error;
}
