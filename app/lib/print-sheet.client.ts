import { assemblePdf, canvasFromSvg, canvasToJpeg, concatBytes, fetchQrSvg, triggerDownload } from "./qr-download";

/**
 * Print sheet: several QR codes on A4 / Letter pages (labels, shelf tags,
 * packaging inserts). QR codes are rasterized at print resolution and laid
 * out on a grid, with the QR code name under each one.
 * Browser-only.
 */

export type PaperSize = "a4" | "letter";

export interface PrintSheetOptions {
  paper: PaperSize;
  columns: number;
  rows: number;
  showNames: boolean;
}

const PAPER: Record<PaperSize, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
};

/** PDF string literal in WinAnsi (Helvetica): escape delimiters, drop what the font can't show. */
function pdfText(value: string): string {
  const ascii = value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7E]/g, "?");
  return ascii.replace(/([\\()])/g, "\\$1");
}

type SheetQr = { id: string; name: string; slug: string };

export async function downloadPrintSheet(qrs: SheetQr[], opts: PrintSheetOptions, onProgress?: (done: number) => void) {
  const enc = new TextEncoder();
  const [pageW, pageH] = PAPER[opts.paper];
  const cols = Math.max(1, Math.min(6, opts.columns));
  const rows = Math.max(1, Math.min(8, opts.rows));
  const perPage = cols * rows;
  const margin = 36;
  const cellW = (pageW - margin * 2) / cols;
  const cellH = (pageH - margin * 2) / rows;
  const labelH = opts.showNames ? 16 : 0;
  const qrSize = Math.min(cellW, cellH - labelH) * 0.84;
  const fontSize = Math.max(6, Math.min(10, cellW / 16));

  // Rasterize every QR code once (≈300 dpi at the printed size).
  const pixels = Math.min(1200, Math.max(300, Math.round((qrSize / 72) * 300)));
  const images: { jpeg: Uint8Array; w: number; h: number }[] = [];
  let done = 0;
  for (const qr of qrs) {
    const svg = await fetchQrSvg(qr, false, 1024);
    const canvas = await canvasFromSvg(svg, pixels);
    images.push({ jpeg: canvasToJpeg(canvas, 0.92), w: canvas.width, h: canvas.height });
    onProgress?.(++done);
  }

  const pageCount = Math.max(1, Math.ceil(qrs.length / perPage));
  // Object numbers: 1 catalog, 2 pages, 3 font, 4.. images, then page + content per page.
  const firstImage = 4;
  const firstPage = firstImage + images.length;
  const pageObjNumber = (p: number) => firstPage + p * 2;

  const objects: Uint8Array[] = [];
  objects.push(enc.encode("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"));
  const kids = Array.from({ length: pageCount }, (_, p) => `${pageObjNumber(p)} 0 R`).join(" ");
  objects.push(enc.encode(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>\nendobj\n`));
  objects.push(enc.encode("3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n"));

  images.forEach((img, i) => {
    objects.push(concatBytes(
      enc.encode(`${firstImage + i} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpeg.length} >>\nstream\n`),
      img.jpeg,
      enc.encode("\nendstream\nendobj\n"),
    ));
  });

  for (let p = 0; p < pageCount; p++) {
    const ops: string[] = [];
    const xobjects: string[] = [];
    for (let slot = 0; slot < perPage; slot++) {
      const index = p * perPage + slot;
      if (index >= qrs.length) break;
      const img = images[index];
      const col = slot % cols;
      const row = Math.floor(slot / cols);
      const cellX = margin + col * cellW;
      const cellTop = pageH - margin - row * cellH;
      const drawW = qrSize;
      const drawH = qrSize * (img.h / img.w);
      const x = cellX + (cellW - drawW) / 2;
      const y = cellTop - (cellH - labelH - drawH) / 2 - drawH;
      const name = `Im${index}`;
      xobjects.push(`/${name} ${firstImage + index} 0 R`);
      ops.push(`q ${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /${name} Do Q`);
      if (opts.showNames) {
        const maxChars = Math.max(4, Math.floor(cellW / (fontSize * 0.52)));
        const raw = qrs[index].name.length > maxChars ? `${qrs[index].name.slice(0, maxChars - 3)}...` : qrs[index].name;
        const text = pdfText(raw);
        const textW = raw.length * fontSize * 0.5;
        const tx = cellX + (cellW - textW) / 2;
        const ty = y - fontSize - 2;
        ops.push(`BT /F1 ${fontSize.toFixed(1)} Tf 0.2 0.2 0.25 rg ${tx.toFixed(2)} ${ty.toFixed(2)} Td (${text}) Tj ET`);
      }
    }
    const content = ops.join("\n");
    const contentBytes = enc.encode(content);
    objects.push(enc.encode(
      `${pageObjNumber(p)} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] ` +
      `/Resources << /Font << /F1 3 0 R >> /XObject << ${xobjects.join(" ")} >> >> /Contents ${pageObjNumber(p) + 1} 0 R >>\nendobj\n`,
    ));
    objects.push(concatBytes(
      enc.encode(`${pageObjNumber(p) + 1} 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n`),
      contentBytes,
      enc.encode("\nendstream\nendobj\n"),
    ));
  }

  const pdf = assemblePdf(objects);
  triggerDownload(new Blob([pdf as BlobPart], { type: "application/pdf" }), `trackqr-print-sheet-${new Date().toISOString().slice(0, 10)}.pdf`);
}
