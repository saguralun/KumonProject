# Startup latency investigation — 2026-11-26

User report: another PC takes over one minute between double-clicking KumonDB and seeing the login screen. The remote PC was not accessed during this investigation.

## Confirmed on the current PC

- Isolated imports of the actual server dependency graph reached the boundary immediately before `app.listen` in 13,742 ms and 24,821 ms in two runs. These are observed samples, not a stable benchmark. Timing varies with filesystem cache and other machine activity.
- `server.js` imports all routes before listening. Export routes eagerly import ExcelJS; payment routes eagerly import the native bitmap receipt renderer. A package-only profile measured ExcelJS at 6,363 ms; a separate route profile measured payment imports at 1,993 ms. Shared dependencies, different cache state, and some concurrent profiling mean these figures must not be added together or treated as exclusive costs.
- A read-only Windows launcher probe measured `Get-NetTCPConnection` at 3,134 ms and process enumeration at 485 ms. These are local samples; remote timings are unknown.
- A local browser fixture served the real login HTML and scripts with synthetic APIs and intercepted external requests. With immediate font CSS, DOM content loaded in 1,070 ms; delaying only font CSS by 5,000 ms delayed DOM content loaded to 5,544 ms. First-byte time in the delayed case was only 90 ms. Thus the externally hosted blocking font stylesheet can delay login readiness even after the local server responds. This does not establish actual Google Fonts latency on the remote PC.
- The old launcher readiness request to `localhost` exceeded its two-second timeout on this PC while the IPv4 request succeeded. Name resolution itself took only 52 ms and returned IPv6 first. This is consistent with connection/fallback overhead, not proof that DNS lookup itself is slow. The separately implemented loopback readiness fix addresses false startup errors; increasing a deadline does not make startup faster.

## Startup order and limits

The server loads its module graph, starts listening, and then starts the integrated desktop. The desktop manager shares concurrent open requests; no second desktop launch or deliberate fixed one-minute sleep was found in this path. The login update check starts asynchronously. Startup database preparation is initiated after listening and is not awaited before requesting the desktop; it has not been established as the cause of this report.

These measurements establish substantial pre-listen work and a network-dependent login path. They do not identify the precise share of the remote PC's over-one-minute delay. Per-stage timing from that PC is still needed for attribution, including launcher, module loading, desktop creation, and login navigation.

## Suggested targeted follow-up

1. Load Excel export and native receipt rendering dependencies only when their actions are used, preserving their request behavior and testing export/printing with fixtures.
2. Make the login font stylesheet nonblocking or serve the existing fonts locally; preserve appearance and verify keyboard/login/update behavior under delayed and failed external requests.
3. Record startup stage durations automatically so remote reports can distinguish server startup from desktop/navigation latency.

## Isolation

Server profiling replaced production pool queries/connections and subprocess methods with throwing guards and replaced `app.listen` with a stop sentinel. Both samples reported zero database calls; no listener, application desktop, or startup task ran in these profiling processes. Browser tests used synthetic APIs and intercepted font requests. The running production application was not restarted. No student, payment, stock, KSIS, schema, backup, or print operation was performed.

Supporting diagnostic scripts and outputs remain under ignored `logs/`: `profile-server-bootstrap.mjs`, `profile-startup-imports.mjs`, `profile-launcher-readonly.ps1`, `profile-login-fonts.mjs`, `startup-local-probes-2026-11-26.json`, and `startup-login-font-profile.json`.
