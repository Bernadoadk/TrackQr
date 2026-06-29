import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { requireShop } from "../lib/shop.server";
import { limitedPeriodRange, type PeriodKey } from "../lib/analytics.server";
import { toCsv } from "../lib/csv.server";
import { getPlanEntitlements } from "../lib/plan.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireShop(request);
  const url = new URL(request.url);
  const period = (url.searchParams.get("period") as PeriodKey) || "30d";
  const entitlements = await getPlanEntitlements(shop);
  const { from } = limitedPeriodRange(period, entitlements);
  const includeConversions = entitlements.attribution;

  const scans = await prisma.scan.findMany({
    where: { qrCode: { shopId: shop.id }, createdAt: { gte: from } },
    orderBy: { createdAt: "desc" },
    include: {
      qrCode: { select: { slug: true, name: true, type: true } },
      conversion: { select: { shopifyOrderId: true, orderName: true, amount: true, currency: true } },
    },
    take: 25000, // hard cap
  });

  const rows = scans.map(s => ({
    time: s.createdAt.toISOString(),
    qrSlug: s.qrCode.slug,
    qrName: s.qrCode.name,
    qrType: s.qrCode.type,
    country: s.country ?? "",
    device:  s.device,
    os:      s.os ?? "",
    browser: s.browser ?? "",
    referer: s.referer ?? "",
    ...(includeConversions ? {
      converted: s.conversion ? "yes" : "no",
      orderName: s.conversion?.orderName ?? "",
      orderAmount: s.conversion?.amount != null ? (s.conversion.amount / 100).toFixed(2) : "",
      orderCurrency: s.conversion?.currency ?? "",
    } : {}),
  }));
  const columns: Array<{ key: keyof (typeof rows)[number]; label: string }> = [
    { key: "time",          label: "Time" },
    { key: "qrSlug",        label: "QR Slug" },
    { key: "qrName",        label: "QR Name" },
    { key: "qrType",        label: "QR Type" },
    { key: "country",       label: "Country" },
    { key: "device",        label: "Device" },
    { key: "os",            label: "OS" },
    { key: "browser",       label: "Browser" },
    { key: "referer",       label: "Referer" },
    ...(includeConversions ? [
      { key: "converted" as const,     label: "Converted" },
      { key: "orderName" as const,     label: "Order" },
      { key: "orderAmount" as const,   label: "Amount" },
      { key: "orderCurrency" as const, label: "Currency" },
    ] : []),
  ];

  const csv = toCsv(
    rows,
    columns,
  );

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="trackqr-scans-${period}-${Date.now()}.csv"`,
    },
  });
};
