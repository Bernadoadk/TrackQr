import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { renderQrPng, scanUrl, type QrDesign } from "../lib/qr.server";
import { hasFeature, resolvePlan } from "../lib/plan.server";
import { applyDesignEntitlement } from "../lib/qr-standard";

/**
 * Raster QR code — public on purpose: it is the image merchants paste into
 * Shopify order emails and packing slips ("Embed" in My QR codes).
 * `?ref={{ order.name }}` makes one code per order (Starter+): the encoded
 * link carries the reference and the scan records it.
 */
export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const id = params.id;
  if (!id) throw new Response("Missing id", { status: 400 });
  const qr = await prisma.qrCode.findUnique({
    where: { id },
    include: { shop: { include: { activeSubscription: { include: { plan: true } } } } },
  });
  if (!qr || qr.archivedAt) throw new Response("Not found", { status: 404 });

  const url = new URL(request.url);
  const size = Math.max(128, Math.min(4096, parseInt(url.searchParams.get("size") ?? "1024", 10) || 1024));
  const disposition = url.searchParams.get("download") === "1" ? "attachment" : "inline";
  const plan = await resolvePlan(qr.shop);
  const { design } = applyDesignEntitlement(plan.customDesign, qr.design, qr.label);

  const ref = (url.searchParams.get("ref") ?? "").trim().replace(/[^\w#\-.:/ ]/g, "").slice(0, 80);
  const link = ref && hasFeature(plan, "orderTracking")
    ? `${scanUrl(qr.slug)}?ref=${encodeURIComponent(ref)}`
    : scanUrl(qr.slug);
  const png = await renderQrPng(link, design as QrDesign, size);

  return new Response(png as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `${disposition}; filename="${qr.slug}${ref ? `-${ref.replace(/[^\w-]/g, "")}` : ""}.png"`,
      "Cache-Control": "public, max-age=86400",
    },
  });
};
