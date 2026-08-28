import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// Browsers have no API to ask "is a printer connected" — that check has to
// happen server-side, on the machine the printer is actually plugged into
// (which is also the machine running this server, per the LAN setup).
// Windows' own printer status isn't perfect for every USB thermal printer
// model/driver (a disconnected-but-not-detected printer can still report
// "not offline"), but WorkOffline is the closest real signal available.
export async function getPrinterStatus() {
    if (process.platform !== "win32") {
        return {
            supported: false,
            connected: null,
            printerName: null,
            detail: "ตรวจสอบเครื่องพิมพ์ได้เฉพาะบน Windows"
        };
    }

    try {
        const { stdout } = await execFileAsync("powershell.exe", [
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy", "Bypass",
            "-Command",
            "Get-CimInstance -ClassName Win32_Printer | Select-Object Name, Default, WorkOffline, PrinterStatus | ConvertTo-Json -Compress"
        ], { timeout: 8000 });

        const trimmed = stdout.trim();

        if (!trimmed) {
            return {
                supported: true,
                connected: false,
                printerName: null,
                detail: "ไม่พบเครื่องพิมพ์ในเครื่องนี้เลย ยังไม่ได้ติดตั้ง driver หรือเปล่า?"
            };
        }

        const parsed = JSON.parse(trimmed);
        const printers = Array.isArray(parsed) ? parsed : [parsed];

        if (!printers.length) {
            return {
                supported: true,
                connected: false,
                printerName: null,
                detail: "ไม่พบเครื่องพิมพ์ในเครื่องนี้เลย ยังไม่ได้ติดตั้ง driver หรือเปล่า?"
            };
        }

        const defaultPrinter = printers.find((printer) => printer.Default) || printers[0];
        const isOffline = defaultPrinter.WorkOffline === true;

        return {
            supported: true,
            connected: !isOffline,
            printerName: defaultPrinter.Name || null,
            isDefaultPrinterSet: printers.some((printer) => printer.Default),
            detail: isOffline
                ? `เครื่องพิมพ์ "${defaultPrinter.Name}" ออฟไลน์อยู่ ลองเช็คสาย/เปิดเครื่อง`
                : `พร้อมใช้งาน: ${defaultPrinter.Name}`
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
