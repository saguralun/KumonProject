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

export const USB_PRINTER_NAME = "Xprinter XP-80"; // must match the Windows printer queue name exactly
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

// Right-aligns `value` against `label` by padding with spaces to a fixed
// column width — this printer's default font is 12-dot-wide (Font A) at
// the 576-dot bitmap resolution used elsewhere in this file, giving 48
// columns; not measured against the actual physical printout yet, so
// treat as a reasonable starting point rather than a confirmed exact fit.
const RECEIPT_LINE_WIDTH = 48;

function escposRow(label, value, width = RECEIPT_LINE_WIDTH) {
    const left = String(label);
    const right = String(value);
    const padding = Math.max(1, width - left.length - right.length);

    return escposAscii(left + " ".repeat(padding) + right);
}

function escposDashLine(width = RECEIPT_LINE_WIDTH) {
    return escposAscii("-".repeat(width));
}

// Server-side twin of formatMoney() in payment.js — same rounding/format,
// but "THB" instead of "บาท" since this whole receipt stays ASCII except
// the student's name (see hasThai/renderLinesToBitmap below).
function formatMoneyAscii(value) {
    const formatted = Number(value || 0).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });

    return `${formatted} THB`;
}

function hasThai(text) {
    return /[฀-๿]/.test(String(text || ""));
}

// Server-side twin of splitNickname() in payment.js — pulls the trailing
// " (nickname)" off receipt.studentName, which arrives as one combined
// string from the shared formatStudentName() backend helper.
function splitNickname(fullName) {
    const match = String(fullName || "").match(/^(.*?)(\s*\([^)]*\))\s*$/);

    if (!match) {
        return { name: fullName, nickname: "" };
    }

    return { name: match[1].trim(), nickname: match[2].trim() };
}

const MONTH_NAMES_EN = [
    "", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
];

function monthNameEn(month) {
    return MONTH_NAMES_EN[Number(month)] || month;
}

// Server-side twins of formatDateDisplay()/formatTimeDisplay() in
// payment.js — Buddhist-era year, but still plain ASCII digits, so no
// bitmap needed for these despite the calendar being Thai-specific.
function formatDateDisplay(dateText) {
    const value = String(dateText || "").slice(0, 10);
    const [year, month, day] = value.split("-");

    if (!year || !month || !day) {
        return value || "-";
    }

    return `${day}/${month}/${Number(year) + 543}`;
}

function formatTimeDisplay(dateTimeText) {
    const date = new Date(dateTimeText);

    if (Number.isNaN(date.getTime())) {
        return "";
    }

    // Local time, not UTC — matches the frontend's toLocaleTimeString(),
    // and this server runs on the same till PC/timezone as the browser.
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");

    return `${hours}:${minutes}`;
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

// Mirrors renderReceipt() in public/js/payment.js line for line — keep
// the two in sync if the on-screen receipt layout changes. Everything
// stays plain ASCII except the student's own name/nickname (rendered as a
// bitmap — this printer's font ROM has no Thai glyphs at all, see
// buildAsciiTestPayload's comment), which is why money is printed as
// "1,700.00 THB" here instead of "...บาท" like the on-screen version.
export function buildReceiptPayload(receipt) {
    const { name: studentNamePart, nickname: studentNicknamePart } = splitNickname(receipt.studentName);
    const details = receipt.receiptDetails || [];

    // "Student:" stays its own ASCII line (printer's native font). Name +
    // nickname together are one centered bitmap line when they fit —
    // renderLinesToBitmap only wraps onto a second line for the rare name
    // too long to fit at this size (the longest actual combination in the
    // database, student 1257 at 64 characters, needs 2 lines here).
    const nameLine = `${studentNamePart}${studentNicknamePart ? ` ${studentNicknamePart}` : ""}`;
    const nameLines = hasThai(nameLine)
        ? [renderLinesToBitmap([{ text: nameLine, fontSize: 26, align: "center" }])]
        : [escposAlignCenter(), escposAscii(nameLine), escposAlignLeft()];

    const itemLines = details.flatMap((detail) => {
        const levelText = `#${detail.enrollmentId} - level ${detail.currentLevelCode}`
            + (detail.currentZunLevelCode ? ` - Zun ${detail.currentZunLevelCode}` : "");

        return [
            escposAscii(`${detail.subjectCode} (${levelText})`),
            escposRow("Tuition", formatMoneyAscii(detail.tuitionFee)),
            ...(Number(detail.additionalFee) > 0
                ? [escposRow("Additional", formatMoneyAscii(detail.additionalFee))]
                : []),
            ...(Number(detail.registrationFee) > 0
                ? [escposRow("Registration", formatMoneyAscii(detail.registrationFee))]
                : []),
            ...(Number(detail.discountAmount) > 0
                ? [escposRow("Discount", `-${formatMoneyAscii(detail.discountAmount)}`)]
                : []),
            escposRow("Subtotal", formatMoneyAscii(detail.netAmount)),
            escposFeed(1)
        ];
    });

    return Buffer.concat([
        escposInit(),
        // Normal (non-bold) weight prints too faint to read reliably on
        // this printer/paper (same finding as the ASCII test payload) —
        // bold stays on for the entire receipt instead of just the
        // heading.
        escposBold(true),
        escposAlignCenter(),
        escposCharSize(2, 2),
        escposAscii("KUMON"),
        escposCharSize(1, 1),
        escposAscii(receipt.center?.centerName || "KumonDB"),
        escposAscii("Receipt"),
        escposAlignLeft(),
        escposDashLine(),
        escposRow("Book/No", `${receipt.receiptBook}/${receipt.receiptNo}`),
        escposRow(
            "Date",
            formatDateDisplay(receipt.billingDate) + (receipt.billingTime ? ` ${formatTimeDisplay(receipt.billingTime)}` : "")
        ),
        escposAscii("Student:"),
        ...nameLines,
        escposAscii(`Student ID: ${receipt.studentId}`),
        escposAscii(`Tuition: ${monthNameEn(receipt.billingMonth)} ${receipt.billingYear}`),
        escposAscii(`Payment: ${receipt.paymentMethodName}`),
        escposDashLine(),
        ...itemLines,
        escposDashLine(),
        escposRow("Total", formatMoneyAscii(receipt.totalAmount)),
        escposRow("Discount", formatMoneyAscii(receipt.discountAmount)),
        escposCharSize(1, 2),
        escposRow("Net", formatMoneyAscii(receipt.netAmount)),
        escposCharSize(1, 1),
        ...(receipt.billingId ? [
            escposAlignCenter(),
            escposAscii(`*** PAID - Billing #${receipt.billingId} ***`),
            escposAlignLeft()
        ] : []),
        escposDashLine(),
        escposAlignCenter(),
        escposAscii("Thank you"),
        escposFeed(4),
        escposCut()
    ]);
}

export async function printReceipt(receipt) {
    await sendRawBytes(buildReceiptPayload(receipt));
    return { success: true };
}
