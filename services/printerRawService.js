import { renderLinesToBitmap } from "./receiptBitmapRenderer.js";
import { sendViaLan } from "./printerTransportLan.js";
import { sendViaUsb } from "./printerTransportUsb.js";

// Switch to "lan" once the Xprinter is on Ethernet with a fixed IP (update
// LAN_PRINTER_HOST below first) — everything else in this file stays the
// same either way.
const PRINTER_TRANSPORT = "usb";

const USB_PRINTER_NAME = "Xprinter XP-80"; // must match the Windows printer queue name exactly
const LAN_PRINTER_HOST = "192.168.1.100"; // TODO: set to the printer's actual static IP once on LAN
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
        escposAlignCenter(),
        escposCharSize(2, 2),
        escposBold(true),
        escposAscii("RAW PRINT TEST"),
        escposCharSize(1, 1),
        escposBold(false),
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
    if (PRINTER_TRANSPORT === "lan") {
        await sendViaLan(buffer, LAN_PRINTER_HOST, LAN_PRINTER_PORT);
        return;
    }

    await sendViaUsb(buffer, USB_PRINTER_NAME);
}

export async function printRawAsciiTest() {
    await sendRawBytes(buildAsciiTestPayload());
    return { success: true };
}
