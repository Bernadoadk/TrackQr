import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { renderQrPng, scanUrl, type QrDesign } from "../lib/qr.server";
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
  const size = Math.max(128, Math.min(4096, parseInt(url.searchParams.get("size") ?? "1024", 10)));
  const disposition = url.searchParams.get("download") === "1" ? "attachment" : "inline";
  const plan = await resolvePlan(qr.shop);
  const { design } = applyDesignEntitlement(plan.customDesign, qr.design, qr.label);
  const png = await renderQrPng(scanUrl(qr.slug), design as QrDesign, size);

  return new Response(png as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `${disposition}; filename="${qr.slug}.png"`,
      "Cache-Control": "public, max-age=300",
    },
  });
};
