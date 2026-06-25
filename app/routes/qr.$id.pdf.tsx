import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { renderQrPdf, scanUrl, type QrDesign } from "../lib/qr.server";

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const id = params.id;
  if (!id) throw new Response("Missing id", { status: 400 });
  const qr = await prisma.qrCode.findUnique({ where: { id } });
  if (!qr) throw new Response("Not found", { status: 404 });

  const url = new URL(request.url);
  const disposition = url.searchParams.get("download") === "1" ? "attachment" : "inline";
  const pdf = renderQrPdf(scanUrl(qr.slug), qr.design as QrDesign);

  return new Response(pdf as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="${qr.slug}.pdf"`,
      "Cache-Control": "public, max-age=300",
    },
  });
};
