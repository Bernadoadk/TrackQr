import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { renderQrPdf, scanUrl, type QrDesign } from "../lib/qr.server";
import { resolvePlan } from "../lib/plan.server";
import { applyDesignEntitlement } from "../lib/qr-standard";

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const id = params.id;
  if (!id) throw new Response("Missing id", { status: 400 });
  const qr = await prisma.qrCode.findUnique({
    where: { id },
    include: { shop: { include: { activeSubscription: { include: { plan: true } } } } },
  });
  if (!qr) throw new Response("Not found", { status: 404 });

  const url = new URL(request.url);
  const disposition = url.searchParams.get("download") === "1" ? "attachment" : "inline";
  const plan = await resolvePlan(qr.shop);
  // Vector exports are part of the `exports` feature (Starter+).
  if (!plan.exports) throw new Response("PDF export requires the Starter plan.", { status: 402 });
  const { design } = applyDesignEntitlement(plan.customDesign, qr.design, qr.label);
  const pdf = renderQrPdf(scanUrl(qr.slug), design as QrDesign);

  return new Response(pdf as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="${qr.slug}.pdf"`,
      "Cache-Control": "public, max-age=300",
    },
  });
};
