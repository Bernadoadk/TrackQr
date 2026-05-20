import type { LoaderFunctionArgs } from "react-router";
import { requireShop } from "../lib/shop.server";
import { getCampaignBySlug } from "../lib/campaign.server";
import { listLeads } from "../lib/leads.server";
import { csvCell } from "../lib/csv.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { shop } = await requireShop(request);
  if (!params.slug) throw new Response("Missing slug", { status: 400 });
  const campaign = await getCampaignBySlug(params.slug);
  if (!campaign || campaign.shopId !== shop.id) throw new Response("Not found", { status: 404 });

  const leads = await listLeads(campaign.id);
  const dynamicKeys = new Set<string>();
  for (const l of leads) for (const k of Object.keys(l.fields as Record<string, unknown>)) dynamicKeys.add(k);
  const dynamic = Array.from(dynamicKeys);

  const headerCols = ["Time", "Email", "Destination", "Sync", ...dynamic];
  const rows = leads.map(l => [
    csvCell(l.createdAt.toISOString()),
    csvCell(l.email),
    csvCell(l.destination),
    csvCell(l.syncStatus),
    ...dynamic.map(k => csvCell((l.fields as Record<string, unknown>)[k] ?? "")),
  ].join(","));
  const csv = [headerCols.map(csvCell).join(","), ...rows].join("\n");

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${campaign.slug}-${Date.now()}.csv"`,
    },
  });
};
