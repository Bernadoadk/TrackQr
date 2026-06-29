import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { CampaignLandingView } from "./c.$slug";

export const loader = async ({ params }: LoaderFunctionArgs) => {
  if (!params.id) throw new Response("Missing id", { status: 400 });
  const [{ default: prisma }, { campaignLandingData }] = await Promise.all([
    import("../db.server"),
    import("../lib/campaign-landing.server"),
  ]);
  const campaign = await prisma.campaign.findUnique({
    where: { id: params.id },
    include: { shop: { include: { activeSubscription: true } } },
  });
  if (!campaign) throw new Response("Not found", { status: 404 });
  return campaignLandingData(campaign, true);
};

export default function PublicCampaignPreview() {
  const data = useLoaderData<typeof loader>();
  return <CampaignLandingView data={data} />;
}
