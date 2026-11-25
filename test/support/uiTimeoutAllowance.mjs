// Explicit allowance for cold Chrome/Electron startup on a busy Windows PC.
// Application code, API fixtures, assertions and Playwright action deadlines
// are unchanged. No recording or browser hooks. Inert without the opt-in.
import { createRequire, syncBuiltinESMExports } from 'node:module';

const multiplier = Number(process.env.TEST_UI_TIMEOUT_SCALE || 1);
if (!Number.isInteger(multiplier) || multiplier < 1 || multiplier > 4) throw new Error('Invalid UI timeout scale');
if (multiplier > 1 && process.argv.some(argument => argument.endsWith('.ui.test.js'))) {
    const testing = createRequire(import.meta.url)('node:test');
    const original = testing.test;
    function testWithStartupAllowance(name, options, callback) {
        if (options && typeof options === 'object' && typeof options.timeout === 'number') {
            return original(name, { ...options, timeout: options.timeout * multiplier }, callback);
        }
        return original(name, options, callback);
    }
    Object.assign(testWithStartupAllowance, original);
    testing.test = testWithStartupAllowance;
    syncBuiltinESMExports();
}
