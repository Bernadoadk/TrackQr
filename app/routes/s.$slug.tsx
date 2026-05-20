import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getQrBySlug } from "../lib/qr-crud.server";
import { buildRedirectTarget } from "../lib/qr.server";
import { parseRequest, recordScan } from "../lib/tracking.server";

/**
 * Public scan endpoint. Every TrackQr QR encodes a URL pointing here.
 * We log the scan, set a 7-day attribution cookie, then 302 to the
 * merchant's target destination.
 */
export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const slug = params.slug;
  if (!slug) throw new Response("Not found", { status: 404 });

  const qr = await getQrBySlug(slug);
  if (!qr || qr.archivedAt) {
    return new Response(landingHtml("This QR code has been removed."), {
      status: 410,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  if (!qr.active) {
    return new Response(landingHtml("This QR code is currently paused."), {
      status: 423,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const parsed = parseRequest(request);
  const scanId = await recordScan(qr.id, parsed);

  let target = buildRedirectTarget(qr, qr.shop.domain);

  // For Shopify checkout attribution: append cart attribute query string the merchant
  // can read in the order webhook. Only attach when scanId exists and the target is a real URL.
  if (scanId && target.startsWith("http")) {
    try {
      const u = new URL(target);
      u.searchParams.set("attributes[tqr_scan]", scanId);
      u.searchParams.set("attributes[tqr_qr]",   qr.slug);
      target = u.toString();
    } catch {
      // ignore — fall through with original target
    }
  }

  const headers = new Headers({ Location: target });
  if (parsed.setCookie) headers.append("Set-Cookie", parsed.setCookie);
  return new Response(null, { status: 302, headers });
};

function landingHtml(message: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>TrackQr</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; background: #0B1220; color: #fff; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 24px; }
    .card { max-width: 380px; text-align: center; }
    .mark { width: 56px; height: 56px; border-radius: 14px; background: linear-gradient(135deg, #2563EB, #7C3AED); margin: 0 auto 18px; display: grid; place-items: center; font-size: 28px; }
    h1 { font-size: 22px; margin: 0 0 8px; }
    p { color: #9DA4B8; margin: 0; font-size: 15px; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <div class="mark">▦</div>
    <h1>QR unavailable</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}
