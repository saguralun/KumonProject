import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { pathToFileURL } from "node:url";
import { waitForUpdatedServer } from "../public/js/updateRestart.js";

test("restart wait requires a different runtime, even when the old server still responds", async (t) => {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => {
        calls++;
        if (calls === 2) throw new TypeError("offline");
        return { ok: true, json: async () => ({ instanceId: calls < 3 ? "old" : "new" }) };
    });
    await waitForUpdatedServer("old", { intervalMs: 1, timeoutMs: 500 });
    assert.equal(calls, 3);
});

test("restart wait reports failure instead of treating the unchanged server as success", async (t) => {
    t.mock.method(globalThis, "fetch", async () => ({ ok: true, json: async () => ({ instanceId: "old" }) }));
    await assert.rejects(waitForUpdatedServer("old", { intervalMs: 1, timeoutMs: 20 }), /start-kumondb.bat/);
});

test("legacy server without a runtime ID must go offline before recovery counts", async (t) => {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => {
        calls++;
        return { ok: calls !== 2, json: async () => ({ instanceId: "new" }) };
    });
    await waitForUpdatedServer(null, { intervalMs: 1, timeoutMs: 500 });
    assert.equal(calls, 3);
});

test("Windows helper replaces a real isolated Node server and confirms readiness", {
    skip: process.platform !== "win32" || process.env.TEST_WINDOWS_RESTART !== "1",
    timeout: 25000
}, async () => {
    const project = await fs.mkdtemp(path.join(os.tmpdir(), "kumondb restart's test-"));
    await fs.mkdir(path.join(project, "launcher"));
    await fs.copyFile(path.resolve("launcher/restart-server.ps1"), path.join(project, "launcher", "restart-server.ps1"));
    await fs.copyFile(path.resolve("launcher/restart-hidden.vbs"), path.join(project, "launcher", "restart-hidden.vbs"));
    const fixture = `
        import http from 'node:http';
        import {getRuntimeStatus,scheduleAppRestart} from ${JSON.stringify(pathToFileURL(path.resolve("services/updateService.js")).href)};
        const server=http.createServer(async(req,res)=>{
            res.setHeader('Content-Type','application/json');
            if(req.url==='/restart') {
                try {
                    await scheduleAppRestart();
                    res.end(JSON.stringify({success:true,previousInstanceId:getRuntimeStatus().instanceId}));
                } catch(error) {res.statusCode=500;res.end(JSON.stringify({error:error.message}));}
            } else res.end(JSON.stringify(getRuntimeStatus()));
        });
        server.listen(Number(process.env.PORT)||0,'127.0.0.1',()=>{
            process.env.PORT=String(server.address().port);
            console.log(server.address().port);
        });
    `;
    await fs.writeFile(path.join(project, "server.js"), fixture);
    await fs.writeFile(path.join(project, "package.json"), '{"type":"module"}');
    const old = spawn(process.execPath, ["server.js"], {
        cwd: project, env: { ...process.env, PORT: "0" }, windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
    });
    let newPid;
    try {
        const [stdout] = await once(old.stdout, "data");
        const port = Number(String(stdout).trim());
        assert.ok(port > 0);
        const before = await (await fetch(`http://127.0.0.1:${port}/api/system/runtime`)).json();
        const response = await fetch(`http://127.0.0.1:${port}/restart`, { method: "POST" });
        const result = await response.json();
        const trace = await fs.readFile(path.join(project, "logs", `restart-helper-${old.pid}.log`), "utf8").catch(() => "");
        assert.equal(response.status, 200, `${JSON.stringify(result)}\n${trace}`);
        assert.equal(result.previousInstanceId, before.instanceId);
        const deadline = Date.now() + 12000;
        let log = "";
        while (Date.now() < deadline) {
            log = await fs.readFile(path.join(project, "logs", `restart-${old.pid}.log`), "utf8").catch(() => "");
            if (/SUCCESS|ERROR/.test(log)) break;
            await new Promise((resolve) => setTimeout(resolve, 200));
        }
        const pidMatch = log.match(/newPid=(\d+)/);
        if (pidMatch) newPid = Number(pidMatch[1]);
        assert.match(log, /READY/);
        assert.match(log, /SUCCESS/, log);
        const after = await (await fetch(`http://127.0.0.1:${port}/api/system/runtime`)).json();
        newPid = after.processId;
        assert.notEqual(after.instanceId, before.instanceId);
        assert.notEqual(after.processId, old.pid);
    } finally {
        old.kill();
        if (newPid) { try { process.kill(newPid); } catch {} }
        await new Promise((resolve) => setTimeout(resolve, 250));
        await fs.rm(project, { recursive: true, force: true });
    }
});
