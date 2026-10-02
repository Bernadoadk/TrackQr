import type { LoaderFunctionArgs } from "react-router";
import { sendWeeklyReports } from "../lib/weekly-report.server";

/**
 * Daily Vercel cron (vercel.json) — sends the weekly reports that are due.
 * Vercel signs cron calls with `Authorization: Bearer $CRON_SECRET`.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("Authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const result = await sendWeeklyReports();
  return Response.json(result);
};
