import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';

function restartFixture(service) {
    let status = 'READY oldPid=fixture', wake, completion, onFailure;
    return {
        steps: {
            runGit: async args => ({ stdout: args.includes('--abbrev-ref') ? 'main\n' : args[0] === 'pull' ? 'fixture pull' : 'a'.repeat(40) }),
            recoverFiles: async () => ({ files: [] }),
            install: async () => {},
            restart: async options => {
                onFailure = options.onFailure;
                ({ completion } = await service.scheduleAppRestart(options, {
                    // No filesystem writes, subprocesses, Git mutations or restart.
                    launch: async () => ({ child: { exitCode: 0 }, readStatus: async () => status }),
                    wait: async (_ms, background) => {
                        assert.equal(background, true);
                        await new Promise(resolve => { wake = resolve; });
                    }
                }));
            }
        },
        async report(value) {
            assert.ok(wake, 'Monitor must have started after READY');
            status = value;
            const resume = wake; wake = null; resume();
            await nextTurn();
        },
        done: () => completion,
        repeatFailure: () => onFailure()
    };
}

test('ERROR after READY releases Update only for its own failed attempt', async () => {
    const service = await import('../services/updateService.js?ready-error-retry');
    const first = restartFixture(service);
    assert.equal((await service.applyUpdate(first.steps)).restartScheduled, true);
    await assert.rejects(service.applyUpdate(first.steps), error => error.statusCode === 409);
    // The wscript shim already exited successfully; the actual PowerShell helper
    // reports the failure later, while this original server remains alive.
    await first.report('READY oldPid=fixture\nERROR Original server changed before restart; nothing was stopped');
    await first.done();
    const second = restartFixture(service);
    assert.equal((await service.applyUpdate(second.steps)).restartScheduled, true);
    first.repeatFailure();
    await assert.rejects(service.applyUpdate(second.steps), error => error.statusCode === 409);
    await second.report('READY\nERROR fixture refused stop');
    await second.done();
});

test('Unchanged/missing status and SUCCESS do not authorize another updater', async () => {
    const service = await import('../services/updateService.js?ready-unknown-status');
    const fixture = restartFixture(service);
    await service.applyUpdate(fixture.steps);
    for (const status of ['', 'READY oldPid=fixture']) {
        await fixture.report(status);
        await assert.rejects(service.applyUpdate(fixture.steps), error => error.statusCode === 409);
    }
    await fixture.report('READY\nSTARTED newPid=fixture\nSUCCESS instance=fixture-new');
    await fixture.done();
    await assert.rejects(service.applyUpdate(fixture.steps), error => error.statusCode === 409);
});

test('Pre-READY failure rejects the update and allows retry without any schema work', async () => {
    const service = await import('../services/updateService.js?before-ready-error');
    const fixture = restartFixture(service);
    const failed = { ...fixture.steps, restart: options => service.scheduleAppRestart(options, {
        launch: async () => ({ child: { exitCode: 1 }, readStatus: async () => 'ERROR fixture bootstrap failure' }),
        wait: () => assert.fail('An explicit error must fail immediately')
    }) };
    await assert.rejects(service.applyUpdate(failed), error => error.statusCode === 500);
    assert.equal((await service.applyUpdate(fixture.steps)).success, true);
    await fixture.report('READY\nERROR fixture cancelled');
    await fixture.done();
});

test('An unresponsive helper is bounded and never reported as scheduled', async () => {
    const { scheduleAppRestart } = await import('../services/updateService.js?ready-timeout');
    let reads = 0;
    await assert.rejects(scheduleAppRestart({}, {
        launch: async () => ({ child: { exitCode: 0 }, readStatus: async () => { reads++; return ''; } }),
        wait: async () => {}
    }), error => error.statusCode === 500);
    assert.equal(reads, 100);
});
