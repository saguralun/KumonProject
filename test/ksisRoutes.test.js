import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { once } from "node:events";
import ksisRoutes from "../routes/ksisRoutes.js";

test("KSIS actions require Admin/Instructor and localhost; audit rejects invalid scope before reading data", async () => {
    const app = express(); app.use(express.json());
    app.use((req, _res, next) => {
        const role = req.get("x-test-role");
        if (role) req.session = { user: { role, userId: 1 } };
        Object.defineProperty(req.socket, "remoteAddress", { configurable: true, value: req.get("x-test-lan") ? "192.168.1.20" : "127.0.0.1" });
        next();
    });
    app.use("/api/ksis", ksisRoutes);
    const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
    try {
        const request = (role, lan = false) => fetch(`http://127.0.0.1:${server.address().port}/api/ksis/ws-audit`, {
            method: "POST", headers: { "Content-Type": "application/json", ...(role ? { "x-test-role": role } : {}), ...(lan ? { "x-test-lan": "1" } : {}) },
            body: JSON.stringify({ scope: "bad", subject: "ALL", month: 10, year: 2026 })
        });
        assert.equal((await request()).status, 401);
        for (const role of ["guest", "staff", "custom"]) assert.equal((await request(role)).status, 403);
        for (const role of ["admin", "instructor"]) {
            const response = await request(role); assert.equal(response.status, 400);
            assert.equal(response.headers.get("cache-control"), "no-store");
        }
        assert.equal((await request("admin", true)).status, 403);
        const openDesktop = (headers, body = '{}') => fetch(`http://127.0.0.1:${server.address().port}/api/ksis/desktop/open`, { method: 'POST', headers: { 'x-test-role': 'admin', ...headers }, body });
        assert.equal((await openDesktop({ 'Content-Type': 'text/plain' })).status, 415);
        for (const origin of ['https://evil.example', 'http://localhost:9999', 'null']) assert.equal((await openDesktop({ 'Content-Type': 'application/json', Origin: origin })).status, 403);
        assert.equal((await openDesktop({ 'Content-Type': 'application/json' })).status, 401);
        const at = (role, action, body, lan = false) => fetch(`http://127.0.0.1:${server.address().port}/api/ksis/at/${action}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-role': role, ...(lan ? { 'x-test-lan': '1' } : {}) }, body: JSON.stringify(body)
        });
        for (const role of ['guest', 'staff', 'custom']) assert.equal((await at(role, 'preview', { subject: 'ALL' })).status, 403);
        for (const role of ['admin', 'instructor']) {
            assert.equal((await at(role, 'preview', { subject: 'ALL' })).status, 400);
            assert.equal((await at(role, 'fill', { confirmSave: false })).status, 400);
            assert.equal((await at(role, 'fill', { confirmSave: true, previewId: 'stale' })).status, 409);
            assert.equal((await at(role, 'unknown', {})).status, 404);
        }
        assert.equal((await at('admin', 'preview', { subject: 'ME' }, true)).status, 403);
        assert.equal((await at('admin', 'inspect', { subject: 'EFL', kumonId: 'bad' })).status, 400);
        const atAudit = (role, lan = false) => fetch(`http://127.0.0.1:${server.address().port}/api/ksis/at-audit`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-role': role, ...(lan ? { 'x-test-lan': '1' } : {}) },
            body: JSON.stringify({ month: 10, year: 2026, subject: 'ALL', scope: 'current' })
        });
        for (const role of ['guest', 'staff']) assert.equal((await atAudit(role)).status, 403);
        assert.equal((await atAudit('admin', true)).status, 403);
        assert.equal((await atAudit('admin')).status, 400);
        const state = (role, lan = false) => fetch(`http://127.0.0.1:${server.address().port}/api/ksis/workspace`, { headers: { 'x-test-role': role, ...(lan ? { 'x-test-lan': '1' } : {}) } });
        for (const role of ['guest', 'staff']) assert.equal((await state(role)).status, 403);
        assert.equal((await state('admin', true)).status, 403);
        const response = await state('admin'); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
        const body = await response.json(); assert.equal(Number.isInteger(body.revision), true); assert.equal(typeof body.instanceId, 'string');
        const inspect = (role, lan = false) => fetch(`http://127.0.0.1:${server.address().port}/api/ksis/draft/inspect`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-role': role, ...(lan ? { 'x-test-lan': '1' } : {}) }, body: '{}'
        });
        for (const role of ['guest', 'staff']) assert.equal((await inspect(role)).status, 403);
        assert.equal((await inspect('admin', true)).status, 403);
        assert.equal((await inspect('admin')).status, 409);
    } finally { await new Promise((resolve) => server.close(resolve)); }
});
