import { execFile } from "child_process";
import { promisify } from "util";
import { discoverPrinterHost } from "./printerDiscoveryService.js";
import { USB_PRINTER_NAME } from "./printerRawService.js";

const execFileAsync = promisify(execFile);

// Mirrors printerRawService.js's own auto-detection (LAN first, USB
// fallback) — this used to just ask Windows "what's the default printer
// and is it offline", but that check went stale the moment actual
// printing moved to raw ESC/POS over LAN/USB, bypassing the Windows print
// queue entirely for the LAN path. Checking the same way printing
// actually happens is what keeps this badge honest.
export async function getPrinterStatus() {
    if (process.platform !== "win32") {
        return {
            supported: false,
            connected: null,
            printerName: null,
            detail: "ตรวจสอบเครื่องพิมพ์ได้เฉพาะบน Windows"
        };
    }

    const lanHost = await discoverPrinterHost();

    if (lanHost) {
        return {
            supported: true,
            connected: true,
            printerName: `Xprinter XP-80 (LAN ${lanHost})`,
            detail: `พร้อมใช้งานผ่านเครือข่าย: ${lanHost}`
        };
    }

    return checkUsbPrinterStatus();
}

async function checkUsbPrinterStatus() {
    try {
        const { stdout } = await execFileAsync("powershell.exe", [
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy", "Bypass",
            "-Command",
            `Get-CimInstance -ClassName Win32_Printer -Filter "Name='${USB_PRINTER_NAME.replace(/'/g, "''")}'" | Select-Object Name, WorkOffline, PrinterStatus | ConvertTo-Json -Compress`
        ], { timeout: 8000 });

        const trimmed = stdout.trim();

        if (!trimmed) {
            return {
                supported: true,
                connected: false,
                printerName: null,
                detail: `ไม่พบเครื่องพิมพ์ทั้งทาง LAN และ USB — เช็คว่าเสียบสาย USB "${USB_PRINTER_NAME}" อยู่ไหม หรือต่อ LAN ไว้หรือเปล่า`
            };
        }

        const printer = JSON.parse(trimmed);
        const isOffline = printer.WorkOffline === true;

        return {
            supported: true,
            connected: !isOffline,
            printerName: printer.Name || null,
            detail: isOffline
                ? `เครื่องพิมพ์ "${printer.Name}" ออฟไลน์อยู่ (USB) ลองเช็คสาย/เปิดเครื่อง`
                : `พร้อมใช้งานผ่าน USB: ${printer.Name}`
        };
    } catch (error) {
        return {
            supported: true,
            connected: false,
            printerName: null,
            detail: `ตรวจสอบไม่สำเร็จ: ${error.message}`
        };
    }
}
