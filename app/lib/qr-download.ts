export type DownloadFormat = "png" | "svg" | "pdf";

function safeFilename(name: string, fallback: string) {
  return (name || fallback).trim().replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || fallback;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function bytesFromDataUrl(dataUrl: string) {
  const base64 = dataUrl.split(",")[1] ?? "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function canvasFromSvg(svg: string, size = 1400) {
  const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Could not render SVG"));
    });

    const ratio = (img.naturalWidth || size) / (img.naturalHeight || size);
    const width = ratio >= 1 ? size : Math.round(size * ratio);
    const height = ratio >= 1 ? Math.round(size / ratio) : size;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function buildJpegPdf(jpegBytes: Uint8Array, imageWidth: number, imageHeight: number) {
  const enc = new TextEncoder();
  const pageW = 612;
  const pageH = 612;
  const max = 540;
  const scale = Math.min(max / imageWidth, max / imageHeight);
  const drawW = imageWidth * scale;
  const drawH = imageHeight * scale;
  const drawX = (pageW - drawW) / 2;
  const drawY = (pageH - drawH) / 2;
  const content = `q\n${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${drawX.toFixed(2)} ${drawY.toFixed(2)} cm\n/Im0 Do\nQ`;
  const objects: Uint8Array[] = [
    enc.encode("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"),
    enc.encode("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n"),
    enc.encode(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>\nendobj\n`),
    enc.encode(`4 0 obj\n<< /Length ${enc.encode(content).length} >>\nstream\n${content}\nendstream\nendobj\n`),
    concatBytes(
      enc.encode(`5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`),
      jpegBytes,
      enc.encode("\nendstream\nendobj\n"),
    ),
  ];

  const header = enc.encode("%PDF-1.4\n");
  const offsets: number[] = [];
  let offset = header.length;
  for (const obj of objects) {
    offsets.push(offset);
    offset += obj.length;
  }
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const objOffset of offsets) xref += `${String(objOffset).padStart(10, "0")} 00000 n \n`;
  const trailer = enc.encode(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF`);
  return concatBytes(header, ...objects, trailer);
}

function concatBytes(...chunks: Uint8Array[]) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export async function downloadQrAsset(qr: { id: string; name: string; slug: string }, format: DownloadFormat) {
  const res = await fetch(`/qr/${qr.id}/svg?size=1024`);
  if (!res.ok) throw new Error("Could not prepare QR code");
  const svg = await res.text();
  const filename = safeFilename(qr.name, qr.slug);

  if (format === "svg") {
    triggerDownload(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), `${filename}.svg`);
    return;
  }

  const canvas = await canvasFromSvg(svg);
  if (format === "png") {
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(b => b ? resolve(b) : reject(new Error("PNG export failed")), "image/png"),
    );
    triggerDownload(blob, `${filename}.png`);
    return;
  }

  const jpeg = canvas.toDataURL("image/jpeg", 0.95);
  const pdf = buildJpegPdf(bytesFromDataUrl(jpeg), canvas.width, canvas.height);
  triggerDownload(new Blob([pdf], { type: "application/pdf" }), `${filename}.pdf`);
}
