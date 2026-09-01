import { discoverPrinterHost } from "./printerDiscoveryService.js";
import { renderLinesToBitmap } from "./receiptBitmapRenderer.js";
import { sendViaLan } from "./printerTransportLan.js";
import { sendViaUsb } from "./printerTransportUsb.js";

// "auto" (default) scans the LAN for the printer every time it's needed
// (fast — uses a cached IP after the first successful print, see
// printerDiscoveryService.js) and falls back to USB automatically if
// nothing answers on the network at all. This means moving the printer or
// the whole till PC to a different location/router never needs a code
// change — plug in and go. Force "usb" here only to skip auto-detection
// entirely, e.g. for troubleshooting the USB path specifically (there's no
// forced "lan" mode since discovery already IS the LAN path — it just also
// knows how to fail over).
const PRINTER_TRANSPORT = "auto";

const USB_PRINTER_NAME = "Xprinter XP-80"; // must match the Windows printer queue name exactly
const LAN_PRINTER_PORT = 9100; // standard raw/JetDirect-style port for thermal/POS printers

const ESC = 0x1b;
const GS = 0x1d;

function escposInit() {
    return Buffer.from([ESC, 0x40]); // ESC @ — reset to defaults
}

function escposAlignCenter() {
    return Buffer.from([ESC, 0x61, 0x01]); // ESC a 1
}

function escposAlignLeft() {
    return Buffer.from([ESC, 0x61, 0x00]); // ESC a 0
}

function escposBold(on) {
    return Buffer.from([ESC, 0x45, on ? 0x01 : 0x00]); // ESC E n
}

// GS ! n — character size: high nibble = height multiplier-1, low nibble =
// width multiplier-1 (0 = normal, 1 = double). n=0x11 is double width+height.
function escposCharSize(widthMultiplier, heightMultiplier) {
    const n = ((widthMultiplier - 1) << 4) | (heightMultiplier - 1);

    return Buffer.from([GS, 0x21, n]);
}

function escposAscii(text) {
    return Buffer.from(`${text}\n`, "ascii");
}

function escposFeed(lines = 3) {
    return Buffer.from(Array(lines).fill(0x0a));
}

function escposCut() {
    return Buffer.from([GS, 0x56, 0x00]); // GS V 0 — full cut
}

export function buildAsciiTestPayload() {
    const now = new Date();

    // Thai text is rendered as a bitmap and printed as a picture — this
    // printer's font ROM has no Thai glyphs at all (confirmed 2026-08-31:
    // every ESC t candidate table just printed mis-decoded Chinese), so
    // native ESC/POS Thai text isn't possible on this unit. See
    // receiptBitmapRenderer.js.
    const thaiBitmap = renderLinesToBitmap([
        { text: "ทดสอบพิมพ์ภาษาไทย", fontSize: 30, bold: true, align: "center" },
        { text: "กขคง จจฉชซ ญฎฏฐ", fontSize: 26, align: "center" },
        { text: "ถ้าอ่านออกและวางกลางหน้ากระดาษ", fontSize: 22, align: "center" },
        { text: "แปลว่าพร้อมใช้งานแล้ว", fontSize: 22, align: "center" }
    ]);

    return Buffer.concat([
        escposInit(),
        // Normal (non-bold) weight printed too faint to read reliably on
        // this printer/paper — barely visible next to the bold heading.
        // Bold is the one weight confirmed to come out dark and clear, so
        // it stays on for the whole body instead of just the heading.
        escposBold(true),
        escposAlignCenter(),
        escposCharSize(2, 2),
        escposAscii("RAW PRINT TEST"),
        escposCharSize(1, 1),
        escposAscii("------------------------"),
        escposAlignLeft(),
        escposAscii(`Time: ${now.toISOString()}`),
        escposAscii("If you can read this"),
        escposAscii("clearly, font size is OK."),
        escposFeed(2),
        thaiBitmap,
        escposFeed(4),
        escposCut()
    ]);
}

async function sendRawBytes(buffer) {
    if (PRINTER_TRANSPORT === "usb") {
        await sendViaUsb(buffer, USB_PRINTER_NAME);
        return;
    }

    // "auto": try to find the printer on the LAN, fall back to USB if
    // nothing answers (unplugged from the network, moved, etc.) — USB
    // still needs the Windows printer queue set up as before.
    const host = await discoverPrinterHost();

    if (host) {
        await sendViaLan(buffer, host, LAN_PRINTER_PORT);
        return;
    }

    await sendViaUsb(buffer, USB_PRINTER_NAME);
}

export async function printRawAsciiTest() {
    await sendRawBytes(buildAsciiTestPayload());
    return { success: true };
}
