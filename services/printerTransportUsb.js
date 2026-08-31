// Sends raw bytes to a printer that's already set up as a Windows printer
// queue (Settings -> Printers & scanners), via the classic winspool.drv
// "RawPrinterHelper" pattern — see scripts/raw-print-escpos.ps1 for why
// (bypasses Chrome/window.print() entirely, which was unreliable for this
// printer/setup).
import { execFile } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";
import { httpError } from "./httpError.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_PRINT_SCRIPT = path.join(__dirname, "..", "scripts", "raw-print-escpos.ps1");

export async function sendViaUsb(buffer, printerName) {
    const base64Data = buffer.toString("base64");

    let stdout;

    try {
        ({ stdout } = await execFileAsync("powershell.exe", [
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy", "Bypass",
            "-File", RAW_PRINT_SCRIPT,
            "-PrinterName", printerName,
            "-Base64Data", base64Data
        ], { timeout: 15000, maxBuffer: 4 * 1024 * 1024 }));
    } catch (error) {
        throw httpError(502, `เรียกสคริปต์พิมพ์ (USB) ไม่สำเร็จ: ${error.message}`);
    }

    const trimmed = stdout.trim();

    if (trimmed !== "OK") {
        throw httpError(502, `พิมพ์ผ่าน USB ไม่สำเร็จ: ${trimmed || "ไม่ทราบสาเหตุ"}`);
    }
}
