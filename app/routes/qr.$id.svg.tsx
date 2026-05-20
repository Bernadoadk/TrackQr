import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { renderQrSvg, scanUrl, type QrDesign } from "../lib/qr.server";

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const id = params.id;
  if (!id) throw new Response("Missing id", { status: 400 });
  const qr = await prisma.qrCode.findUnique({ where: { id } });
  if (!qr) throw new Response("Not found", { status: 404 });

  const url = new URL(request.url);
  const size = Math.max(128, Math.min(2048, parseInt(url.searchParams.get("size") ?? "512", 10)));
  const svg = renderQrSvg(scanUrl(qr.slug), qr.design as QrDesign, size);

  return new Response(svg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml",
      "Content-Disposition": `inline; filename="${qr.slug}.svg"`,
      "Cache-Control": "public, max-age=300",
    },
  });
};
