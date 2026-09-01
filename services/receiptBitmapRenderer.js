// Renders text (Thai included) to a monochrome bitmap and packs it into an
// ESC/POS raster image command (GS v 0). This exists because the Xprinter
// unit here has no Thai glyphs in its own font ROM at all — sending Thai
// bytes under any of its character-code-table options just prints
// mis-decoded Chinese (confirmed 2026-08-31: every candidate table 21, 22,
// 30-34, 255 did this). Rendering the text ourselves and printing it as a
// picture sidesteps the printer's font ROM entirely — this is the standard
// fix for this exact class of hardware limitation.
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";

// 80mm thermal printers print on ~72mm of actual paper (the rest is edge
// margin the paper guide takes up) at the near-universal 8 dots/mm
// resolution for this printer class, giving 576 dots — and 576 happens to
// already be a clean multiple of 8, which GS v 0 needs (each row is packed
// into whole bytes, 8 pixels each).
const BITMAP_WIDTH_PX = 576;

const THAI_FONT_FAMILY = "Leelawadee";
let thaiFontRegistered = false;

function ensureThaiFontRegistered() {
    if (thaiFontRegistered) {
        return;
    }

    // Registering explicitly (rather than relying on plain font-family
    // resolution) is what actually made Thai glyphs render instead of
    // empty tofu boxes — GlobalFonts needs the exact file, not just a name
    // that happens to match an installed Windows font.
    GlobalFonts.registerFromPath("C:/Windows/Fonts/leelawad.ttf", THAI_FONT_FAMILY);
    thaiFontRegistered = true;
}

const MARGIN_X = 8;
const AVAILABLE_WIDTH_PX = BITMAP_WIDTH_PX - MARGIN_X * 2;

// Breaks `text` into as many lines as needed to each fit maxWidth, breaking
// only at spaces (fine for this receipt's actual content — Thai names
// here are written with spaces between first/last/nickname components,
// not run together the way general Thai prose can be). A single word
// longer than maxWidth on its own is left as-is rather than mid-word
// hyphenated.
function wrapToWidth(ctx, text, font, maxWidth) {
    ctx.font = font;

    if (ctx.measureText(text).width <= maxWidth) {
        return [text];
    }

    const words = text.split(" ");
    const wrapped = [];
    let current = "";

    for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;

        if (current && ctx.measureText(candidate).width > maxWidth) {
            wrapped.push(current);
            current = word;
        } else {
            current = candidate;
        }
    }

    if (current) {
        wrapped.push(current);
    }

    return wrapped;
}

// lines: array of { text, fontSize = 24, bold = false, align = "left" }.
// Any line wider than the printable area wraps onto as many additional
// lines as needed (see wrapToWidth) rather than being cut off or forcing
// every line down to a tiny font size to make one long line fit.
export function renderLinesToBitmap(lines) {
    ensureThaiFontRegistered();

    const lineHeightPadding = 6;

    // First pass on a throwaway canvas just to measure/wrap text, since
    // canvas needs a fixed size up front.
    const measureCanvas = createCanvas(BITMAP_WIDTH_PX, 10);
    const measureCtx = measureCanvas.getContext("2d");
    let totalHeight = 12;
    const lineMetrics = lines.flatMap((line) => {
        const fontSize = line.fontSize || 24;
        const font = `${line.bold ? "bold " : ""}${fontSize}px "${THAI_FONT_FAMILY}"`;
        const height = Math.ceil(fontSize * 1.35) + lineHeightPadding;
        const wrappedTexts = wrapToWidth(measureCtx, line.text, font, AVAILABLE_WIDTH_PX);

        return wrappedTexts.map((text) => {
            totalHeight += height;
            return { ...line, text, fontSize, height };
        });
    });

    const canvas = createCanvas(BITMAP_WIDTH_PX, totalHeight);
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, BITMAP_WIDTH_PX, totalHeight);
    ctx.fillStyle = "#000000";
    ctx.textBaseline = "top";

    let y = 6;

    for (const line of lineMetrics) {
        ctx.font = `${line.bold ? "bold " : ""}${line.fontSize}px "${THAI_FONT_FAMILY}"`;
        const textWidth = ctx.measureText(line.text).width;
        let x = MARGIN_X;

        if (line.align === "center") {
            x = Math.max(MARGIN_X, (BITMAP_WIDTH_PX - textWidth) / 2);
        } else if (line.align === "right") {
            x = Math.max(MARGIN_X, BITMAP_WIDTH_PX - textWidth - MARGIN_X);
        }

        ctx.fillText(line.text, x, y);
        y += line.height;
    }

    return packCanvasToEscPosRaster(canvas, ctx);
}

function packCanvasToEscPosRaster(canvas, ctx) {
    const width = canvas.width;
    const height = canvas.height;
    const widthBytes = width / 8; // BITMAP_WIDTH_PX is always a multiple of 8
    const imageData = ctx.getImageData(0, 0, width, height).data;
    const packed = Buffer.alloc(widthBytes * height, 0);

    for (let row = 0; row < height; row += 1) {
        for (let col = 0; col < width; col += 1) {
            const pixelIndex = (row * width + col) * 4;
            const r = imageData[pixelIndex];
            const g = imageData[pixelIndex + 1];
            const b = imageData[pixelIndex + 2];
            const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
            const isDark = luminance < 128;

            if (isDark) {
                const byteIndex = row * widthBytes + Math.floor(col / 8);
                const bitIndex = 7 - (col % 8); // MSB first, as GS v 0 expects

                packed[byteIndex] |= (1 << bitIndex);
            }
        }
    }

    const xL = widthBytes & 0xff;
    const xH = (widthBytes >> 8) & 0xff;
    const yL = height & 0xff;
    const yH = (height >> 8) & 0xff;

    return Buffer.concat([
        Buffer.from([0x1d, 0x76, 0x30, 0x00, xL, xH, yL, yH]), // GS v 0 m xL xH yL yH
        packed
    ]);
}
