// Opt-in observations for synthetic UI tests only. Never imported by the app.
// It observes clicks and extends enclosing test deadlines; assertions, requests,
// account permissions and fixture responses remain unchanged.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { chromium, _electron } from 'playwright-core';

const traceDirectory = process.env.KUMON_REVIEW_TRACE_DIR;
// Normal tests and imports are inert unless this explicit opt-in is present.
if (traceDirectory) {
    const root = path.resolve('logs');
    const directory = path.resolve(traceDirectory);
    const relative = path.relative(root, directory);
    if (!relative.startsWith('review-') || relative.includes(path.sep) || path.isAbsolute(relative)) {
        throw new Error('Review traces must stay in a named logs/review-* directory');
    }
    fs.mkdirSync(directory, { recursive: true });
    if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('Linked review directory refused');
    const output = path.join(directory, `controls-${process.pid}.jsonl`);
    const testFile = process.argv.find(argument => argument.endsWith('.ui.test.js')) || '';
    const record = event => fs.appendFileSync(output, JSON.stringify({ testFile: path.basename(testFile), ...event }) + '\n');

    const require = createRequire(import.meta.url);
    const testing = require('node:test');
    const originalTest = testing.test;
    const multiplier = Number(process.env.KUMON_REVIEW_TIMEOUT_SCALE || 3);
    if (!Number.isFinite(multiplier) || multiplier < 1 || multiplier > 4) throw new Error('Invalid review timeout scale');
    function reviewTest(name, options, callback) {
        if (options && typeof options === 'object' && typeof options.timeout === 'number') {
            return originalTest(name, { ...options, timeout: options.timeout * multiplier }, callback);
        }
        return originalTest(name, options, callback);
    }
    Object.assign(reviewTest, originalTest);
    testing.test = reviewTest;
    syncBuiltinESMExports();

    function observeControls() {
        if (window.__kumonReviewObserved) return;
        Object.defineProperty(window, '__kumonReviewObserved', { value: true });
        document.addEventListener('click', event => {
            const target = event.target instanceof Element ? event.target.closest('button,input[type=button],input[type=submit],a') : null;
            if (!target || !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) return;
            const emit = window.__kumonReviewEmit;
            if (typeof emit !== 'function') return;
            const payload = {
                kind: 'click', page: location.pathname, tag: target.tagName.toLowerCase(),
                id: target.id, type: target.getAttribute('type') || '',
                label: (target.getAttribute('aria-label') || target.getAttribute('title') || target.innerText || target.value || '').trim().slice(0, 100),
                dataKeys: target.getAttributeNames().filter(name => name.startsWith('data-')).sort(),
                disabled: Boolean(target.disabled), trusted: event.isTrusted
            };
            Promise.resolve(emit(payload)).catch(() => {});
        }, { capture: true, passive: true });
    }

    const contexts = new WeakMap();
    async function observeContext(context) {
        if (contexts.has(context)) return contexts.get(context);
        const ready = (async () => {
            await context.exposeBinding('__kumonReviewEmit', (_source, event) => record(event));
            await context.addInitScript(observeControls);
            for (const page of context.pages()) {
                await page.evaluate(observeControls).catch(() => {});
            }
        })();
        contexts.set(context, ready);
        return ready;
    }

    function observeBrowser(browser) {
        const newContext = browser.newContext.bind(browser);
        browser.newContext = async (...args) => {
            const context = await newContext(...args);
            await observeContext(context);
            return context;
        };
        const newPage = browser.newPage.bind(browser);
        browser.newPage = async (...args) => {
            const page = await newPage(...args);
            await observeContext(page.context());
            return page;
        };
        return browser;
    }

    const launch = chromium.launch.bind(chromium);
    chromium.launch = async (...args) => observeBrowser(await launch(...args));
    const persistent = chromium.launchPersistentContext.bind(chromium);
    chromium.launchPersistentContext = async (...args) => {
        const context = await persistent(...args);
        await observeContext(context);
        return context;
    };
    const launchElectron = _electron.launch.bind(_electron);
    _electron.launch = async (...args) => {
        const app = await launchElectron(...args);
        await observeContext(app.context());
        return app;
    };
}
