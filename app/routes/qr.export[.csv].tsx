import type { LoaderFunctionArgs } from "react-router";
import { requireShop } from "../lib/shop.server";
import { listQrCodes } from "../lib/qr-crud.server";
import { toCsv } from "../lib/csv.server";
import { getPlanEntitlements } from "../lib/plan.server";
import { QR_TYPE_FROM_UI } from "../lib/qr-types";
import type { QrType } from "@prisma/client";

function coerceQrTypeFilter(value: string | null): QrType | "all" {
  if (!value || value === "all") return "all";
  return QR_TYPE_FROM_UI[value.toLowerCase()] ?? "all";
}

function coerceStatusFilter(value: string | null): "all" | "active" | "inactive" {
  return value === "active" || value === "inactive" ? value : "all";
}

function coerceSort(value: string | null): "recent" | "scans" | "conv" | "name" {
  return value === "scans" || value === "conv" || value === "name" ? value : "recent";
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireShop(request);
  const url = new URL(request.url);
  const entitlements = await getPlanEntitlements(shop);
  const items = await listQrCodes(shop.id, {
    query: url.searchParams.get("q") ?? undefined,
    type: coerceQrTypeFilter(url.searchParams.get("type")),
    status: coerceStatusFilter(url.searchParams.get("status")),
    sort: coerceSort(url.searchParams.get("sort")),
  }, {
    earliestScanDate: entitlements.earliestScanDate,
    attribution: entitlements.attribution,
  });
  const includeConversions = entitlements.attribution;
  const rows = items.map(q => ({
      slug: q.slug,
      name: q.name,
      type: q.type,
      target: q.target,
      active: q.active ? "yes" : "no",
      scans: q.scans,
      ...(includeConversions ? { conversions: q.conversions } : {}),
      createdAt: q.createdAt.toISOString(),
    }));
  const columns: Array<{ key: keyof (typeof rows)[number]; label: string }> = [
    { key: "slug",        label: "Slug" },
    { key: "name",        label: "Name" },
    { key: "type",        label: "Type" },
    { key: "target",      label: "Target" },
    { key: "active",      label: "Active" },
    { key: "scans",       label: "Scans" },
    ...(includeConversions ? [{ key: "conversions" as const, label: "Conversions" }] : []),
    { key: "createdAt",   label: "Created At" },
  ];

  const csv = toCsv(
    rows,
    columns,
  );

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="trackqr-codes-${Date.now()}.csv"`,
    },
  });
};
