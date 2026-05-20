import type { LoaderFunctionArgs } from "react-router";
import { requireShop } from "../lib/shop.server";
import { listQrCodes } from "../lib/qr-crud.server";
import { toCsv } from "../lib/csv.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireShop(request);
  const items = await listQrCodes(shop.id);

  const csv = toCsv(
    items.map(q => ({
      slug: q.slug,
      name: q.name,
      type: q.type,
      target: q.target,
      active: q.active ? "yes" : "no",
      scans: q.scans,
      conversions: q.conversions,
      createdAt: q.createdAt.toISOString(),
    })),
    [
      { key: "slug",        label: "Slug" },
      { key: "name",        label: "Name" },
      { key: "type",        label: "Type" },
      { key: "target",      label: "Target" },
      { key: "active",      label: "Active" },
      { key: "scans",       label: "Scans" },
      { key: "conversions", label: "Conversions" },
      { key: "createdAt",   label: "Created At" },
    ],
  );

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="trackqr-codes-${Date.now()}.csv"`,
    },
  });
};
