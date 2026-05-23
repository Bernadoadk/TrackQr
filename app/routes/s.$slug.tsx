import type { LoaderFunctionArgs } from "react-router";
import { getQrBySlug } from "../lib/qr-crud.server";
import { buildRedirectTarget } from "../lib/qr.server";
import { parseRequest, recordScan } from "../lib/tracking.server";

/**
 * Public scan endpoint. Every TrackQr QR encodes a URL pointing here.
 * We log the scan, set a 7-day attribution cookie, then either:
 *   - 302 redirect to the target (URLs, tel:, sms:, mailto:)
 *   - render a landing page (TEXT, WIFI, VCARD payloads that can't be a 302)
 */
export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const slug = params.slug;
  if (!slug) throw new Response("Not found", { status: 404 });

  const qr = await getQrBySlug(slug);
  if (!qr || qr.archivedAt) {
    return errorPage("This QR code has been removed.", 410);
  }
  if (!qr.active) {
    return errorPage("This QR code is currently paused.", 423);
  }

  const parsed = parseRequest(request);
  const scanId = await recordScan(qr.id, parsed);
  const dispatch = buildRedirectTarget(qr, qr.shop.domain);

  if (dispatch.kind === "landing") {
    return new Response(landingHtmlFor(dispatch.type, dispatch.payload, qr.name), {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        ...(parsed.setCookie ? { "Set-Cookie": parsed.setCookie } : {}),
      },
    });
  }

  let target = dispatch.url;
  // For Shopify checkout attribution: append cart attributes the merchant
  // can read in the order webhook. Only attach for real http(s) URLs.
  if (scanId && /^https?:\/\//i.test(target)) {
    try {
      const u = new URL(target);
      u.searchParams.set("attributes[tqr_scan]", scanId);
      u.searchParams.set("attributes[tqr_qr]",   qr.slug);
      target = u.toString();
    } catch {
      // ignore
    }
  }

  const headers = new Headers({ Location: target });
  if (parsed.setCookie) headers.append("Set-Cookie", parsed.setCookie);
  return new Response(null, { status: 302, headers });
};

/* ──────────── Landing pages for TEXT / WIFI / VCARD ──────────── */

function landingHtmlFor(type: "TEXT" | "WIFI" | "VCARD", payload: string, qrName: string): string {
  if (type === "TEXT")  return textLanding(payload, qrName);
  if (type === "WIFI")  return wifiLanding(payload, qrName);
  if (type === "VCARD") return vcardLanding(payload, qrName);
  return errorHtml("Unsupported payload.");
}

/** Escape a string for safe HTML embedding. */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function textLanding(text: string, name: string): string {
  const safeText = esc(text);
  const dataUri = `data:text/plain,${encodeURIComponent(text)}`;
  return shell(name, `
    <div class="card">
      <div class="eyebrow">Message</div>
      <pre>${safeText}</pre>
      <div class="actions">
        <button onclick="navigator.clipboard.writeText(document.querySelector('pre').innerText); this.innerText='Copied ✓'">Copy</button>
        <a href="${dataUri}" download="${esc(name)}.txt">Download</a>
      </div>
    </div>
  `);
}

function wifiLanding(payload: string, name: string): string {
  // Parse "WIFI:T:WPA;S:Aurora Guest;P:secret;;"
  const parts: Record<string, string> = {};
  payload.replace(/^WIFI:/, "").split(";").forEach(p => {
    const [k, ...v] = p.split(":");
    if (k) parts[k] = v.join(":");
  });
  const ssid = parts.S ?? "";
  const pwd  = parts.P ?? "";
  const enc  = parts.T ?? "WPA";

  return shell(name, `
    <div class="card">
      <div class="eyebrow">WiFi network</div>
      <h1>${esc(ssid)}</h1>
      <div class="kv">
        <div><span>Encryption</span><b>${esc(enc)}</b></div>
        <div><span>Password</span><b class="mono">${esc(pwd || "—")}</b></div>
      </div>
      <div class="actions">
        <button onclick="navigator.clipboard.writeText('${esc(pwd)}'); this.innerText='Password copied ✓'">Copy password</button>
      </div>
      <div class="hint">Open your phone's camera and scan the original QR again to auto-connect, or copy the credentials manually.</div>
    </div>
  `);
}

function vcardLanding(payload: string, name: string): string {
  const lines = payload.split(/\r?\n/);
  const get = (key: string) => {
    const line = lines.find(l => l.toUpperCase().startsWith(key.toUpperCase() + ":") || l.toUpperCase().startsWith(key.toUpperCase() + ";"));
    return line ? line.substring(line.indexOf(":") + 1) : "";
  };
  const fn    = get("FN");
  const org   = get("ORG");
  const title = get("TITLE");
  const tel   = get("TEL");
  const email = get("EMAIL");
  const url   = get("URL");
  const dataUri = `data:text/vcard;charset=utf-8,${encodeURIComponent(payload)}`;

  return shell(name, `
    <div class="card">
      <div class="eyebrow">Contact</div>
      <h1>${esc(fn || name)}</h1>
      ${title ? `<div class="muted">${esc(title)}${org ? " · " + esc(org) : ""}</div>` : ""}
      <div class="kv">
        ${tel   ? `<div><span>Phone</span><a href="tel:${esc(tel)}">${esc(tel)}</a></div>` : ""}
        ${email ? `<div><span>Email</span><a href="mailto:${esc(email)}">${esc(email)}</a></div>` : ""}
        ${url   ? `<div><span>Website</span><a href="${esc(url)}" target="_blank">${esc(url)}</a></div>` : ""}
      </div>
      <div class="actions">
        <a href="${dataUri}" download="${esc(fn || name)}.vcf" class="primary">Save contact</a>
      </div>
    </div>
  `);
}

function errorPage(msg: string, status: number): Response {
  return new Response(errorHtml(msg), { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function errorHtml(message: string): string {
  return shell("QR unavailable", `
    <div class="card center">
      <div class="mark">▦</div>
      <h1>QR unavailable</h1>
      <p>${esc(message)}</p>
    </div>
  `);
}

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body { font-family: -apple-system, system-ui, "Inter", sans-serif; background: #0B1220; color: #E2E8F0; margin: 0; padding: 24px; min-height: 100vh; display: grid; place-items: center; line-height: 1.5; }
  .card { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.10); border-radius: 16px; padding: 28px; max-width: 420px; width: 100%; }
  .card.center { text-align: center; }
  .eyebrow { font-family: ui-monospace, monospace; font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: #93C5FD; margin-bottom: 12px; }
  h1 { font-family: "Instrument Serif", serif; font-weight: 400; font-size: 30px; letter-spacing: -0.02em; margin: 0 0 8px; color: #fff; }
  p { color: #9DA4B8; margin: 8px 0; }
  .muted { color: #9DA4B8; font-size: 13px; margin-bottom: 16px; }
  pre { white-space: pre-wrap; word-break: break-word; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 14px; font-family: ui-monospace, monospace; font-size: 13px; color: #E2E8F0; margin: 14px 0; max-height: 320px; overflow-y: auto; }
  .kv { display: flex; flex-direction: column; gap: 10px; margin: 18px 0; }
  .kv > div { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 10px 12px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; }
  .kv span { color: #8B92A8; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; font-family: ui-monospace, monospace; }
  .kv b, .kv a { color: #fff; font-weight: 500; text-align: right; word-break: break-all; }
  .kv a { color: #93C5FD; text-decoration: none; }
  .mono { font-family: ui-monospace, monospace; }
  .actions { display: flex; gap: 8px; margin-top: 18px; }
  .actions button, .actions a { flex: 1; padding: 12px 16px; border: 1px solid rgba(255,255,255,0.16); background: rgba(255,255,255,0.06); color: #fff; border-radius: 10px; font-size: 14px; font-weight: 500; cursor: pointer; text-decoration: none; text-align: center; }
  .actions .primary, .actions a.primary { background: linear-gradient(135deg, #2563EB, #7C3AED); border-color: transparent; }
  .actions button:active, .actions a:active { transform: translateY(1px); }
  .hint { color: #5B6172; font-size: 12px; margin-top: 14px; text-align: center; }
  .mark { width: 56px; height: 56px; border-radius: 14px; background: linear-gradient(135deg, #2563EB, #7C3AED); margin: 0 auto 18px; display: grid; place-items: center; font-size: 28px; color: #fff; }
</style>
</head>
<body>${body}</body>
</html>`;
}
