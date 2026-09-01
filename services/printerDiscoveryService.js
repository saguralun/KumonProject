// Finds the receipt printer on the LAN automatically instead of relying on
// a hardcoded IP — so moving the printer/router (a different network, a
// different location entirely) never needs a code change. Works by
// scanning for a host with the raw/JetDirect print port (9100) open on
// the same /24 as this machine's own LAN address, then caching whichever
// IP answered so every later print is a fast direct check instead of a
// full rescan. Falls back to a fresh scan automatically if the cached IP
// stops answering (printer got a new IP, was swapped, etc.).
import fs from "fs";
import net from "net";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.join(__dirname, "..", "config", "printer-lan-cache.json");
const SCAN_PORT = 9100;
const FAST_CHECK_TIMEOUT_MS = 400;
const SCAN_CONNECT_TIMEOUT_MS = 300;
const SCAN_BATCH_SIZE = 100;

function checkPort(ip, port, timeoutMs) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let done = false;

        const finish = (open) => {
            if (done) return;
            done = true;
            socket.destroy();
            resolve(open);
        };

        socket.setTimeout(timeoutMs);
        socket.once("connect", () => finish(true));
        socket.once("timeout", () => finish(false));
        socket.once("error", () => finish(false));
        socket.connect(port, ip);
    });
}

function readCache() {
    try {
        const raw = fs.readFileSync(CACHE_FILE, "utf8");
        const parsed = JSON.parse(raw);

        return typeof parsed?.host === "string" ? parsed.host : null;
    } catch {
        return null;
    }
}

function writeCache(host) {
    try {
        fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
        fs.writeFileSync(CACHE_FILE, JSON.stringify({ host, savedAt: new Date().toISOString() }, null, 2));
    } catch {
        // Non-fatal — just means next print re-scans instead of using a
        // fast cached check. Not worth failing the print over.
    }
}

// This machine's own LAN-facing /24 — deliberately capped to /24 even on
// a wider DHCP pool (e.g. a /22), since that's where a printer given a
// "nearby" static IP like this one (192.168.68.200 next to the PC's
// 192.168.68.57) actually ends up in practice, and scanning a full /16
// would take far too long to be usable per-print.
function getLocalSubnet24() {
    const interfaces = os.networkInterfaces();

    for (const entries of Object.values(interfaces)) {
        for (const iface of entries || []) {
            if (iface.family === "IPv4" && !iface.internal) {
                const parts = iface.address.split(".");

                if (parts.length === 4) {
                    return parts.slice(0, 3).join(".");
                }
            }
        }
    }

    return null;
}

async function scanSubnetForPrinter(subnet24) {
    const targets = [];

    for (let host = 1; host <= 254; host += 1) {
        targets.push(`${subnet24}.${host}`);
    }

    for (let i = 0; i < targets.length; i += SCAN_BATCH_SIZE) {
        const batch = targets.slice(i, i + SCAN_BATCH_SIZE);
        const results = await Promise.all(
            batch.map(async (ip) => ((await checkPort(ip, SCAN_PORT, SCAN_CONNECT_TIMEOUT_MS)) ? ip : null))
        );
        const found = results.find(Boolean);

        if (found) {
            return found;
        }
    }

    return null;
}

// Returns the printer's LAN IP, or null if none could be found at all
// (caller should fall back to USB in that case).
export async function discoverPrinterHost() {
    const cached = readCache();

    if (cached && (await checkPort(cached, SCAN_PORT, FAST_CHECK_TIMEOUT_MS))) {
        return cached;
    }

    const subnet24 = getLocalSubnet24();

    if (!subnet24) {
        return null;
    }

    const found = await scanSubnetForPrinter(subnet24);

    if (found) {
        writeCache(found);
    }

    return found;
}
