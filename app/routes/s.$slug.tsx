import type { LoaderFunctionArgs } from "react-router";
import type { QrCode, Shop } from "@prisma/client";
import { deactivateQrById, getQrBySlug, pauseQrForQuota } from "../lib/qr-crud.server";
import { buildRedirectTarget, ensureUtm, withScanAttribution } from "../lib/qr.server";
import { parseRequest, recordMissedScan, recordScan, visitorBucket, type ParsedRequest } from "../lib/tracking.server";
import { entitlementsForPlan, getBillingAccess, isOverQuota, type PlanEntitlements } from "../lib/plan.server";
import { readShopSettings, storeHosts } from "../lib/shop-settings.server";
import { EMPTY_ROUTING, hasRouting, normalizeRoutingConfig, resolveRouting } from "../lib/routing";
import { safeLinkUrl } from "../lib/url-safety";
import { parseWifiFields } from "../lib/wifi";

type MissedReason = "PAUSED" | "SCHEDULED" | "EXPIRED" | "OVER_QUOTA" | "ARCHIVED";

/**
 * Public scan endpoint. Every TrackQr QR encodes a URL pointing here.
 * We log the scan, set a 7-day session cookie, then either:
 *   - 302 redirect to the target (URLs, tel:, sms:, mailto:)
 *   - render a landing page (TEXT, WIFI, VCARD payloads that can't be a 302)
 *
 * A printed code never ends on an error page: when it can't serve its
 * destination (paused, not active yet, expired, over the plan quota,
 * archived) the visitor goes to the fallback URL — the store home page by
 * default — and the merchant sees the missed scan in the admin.
 */
export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const slug = params.slug;
  const parsed = parseRequest(request);
  const lang = pickLanguage(parsed.languages);
  if (!slug) return notFound(lang);

  const qr = await getQrBySlug(slug);
  if (!qr) return notFound(lang);

  const access = await getBillingAccess(qr.shop);
  const entitlements = entitlementsForPlan(access.plan, access.status);
  const now = new Date();

  // ── Lifecycle / quota gates → fallback redirect ──
  let missed: MissedReason | null = null;
  if (qr.archivedAt) {
    missed = "ARCHIVED";
  } else if (qr.expiresAt && qr.expiresAt <= now) {
    missed = "EXPIRED";
    if (qr.active) await deactivateQrById(qr.id);
  } else if (qr.activatesAt && qr.activatesAt > now) {
    missed = "SCHEDULED";
  } else if (!qr.active) {
    missed = qr.quotaPausedAt ? "OVER_QUOTA" : "PAUSED";
  } else if (await isOverQuota("qrCodes", qr, access.plan.qrCodeLimit)) {
    // A QR code beyond the plan limit (e.g. after a downgrade) is paused here
    // even if no admin page was opened since.
    await pauseQrForQuota(qr.id);
    missed = "OVER_QUOTA";
  }
  if (missed) {
    if (!parsed.isBot) await recordMissedScan(qr.id, missed);
    return redirectTo(fallbackUrl(qr, qr.shop, entitlements), parsed);
  }

  // ── Smart routing (Growth) ──
  const routing = entitlements.smartRouting ? normalizeRoutingConfig(qr.rules) : EMPTY_ROUTING;
  const decision = hasRouting(routing)
    ? resolveRouting(routing, {
        device: parsed.device,
        os: parsed.os,
        country: parsed.country,
        languages: parsed.languages,
        now,
        bucket: visitorBucket(parsed.sessionToken, qr.id),
      })
    : { url: null, route: null };

  // Per-order codes (packing slips, order emails) carry ?ref=<order> (Starter+).
  const ref = entitlements.orderTracking ? cleanRef(new URL(request.url).searchParams.get("ref")) : null;
  const scanId = parsed.isBot ? null : await recordScan(qr.id, parsed, { ref, route: decision.route });

  // A QR bound to a campaign opens the campaign landing page (/c/:slug); the
  // scan id travels along so the page's store links stay attributable.
  if (qr.campaign) {
    const params = new URLSearchParams();
    if (scanId) {
      params.set("tqr_scan", scanId);
      params.set("tqr_qr", qr.slug);
    }
    const query = params.toString();
    return redirectTo(`/c/${qr.campaign.slug}${query ? `?${query}` : ""}`, parsed);
  }

  const dispatch = decision.url
    ? { kind: "redirect" as const, url: ensureUtm(decision.url, qr) }
    : buildRedirectTarget(qr, qr.shop.domain);

  if (dispatch.kind === "landing") {
    return new Response(landingHtmlFor(dispatch.type, dispatch.payload, qr.name, lang), {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        ...(parsed.setCookie ? { "Set-Cookie": parsed.setCookie } : {}),
      },
    });
  }

  // For Shopify order attribution: carry the scan id to the storefront
  // (cart attributes / app embed). Only for store URLs.
  const target = scanId ? withScanAttribution(dispatch.url, scanId, qr.slug, storeHosts(qr.shop)) : dispatch.url;
  return redirectTo(target, parsed);
};

function fallbackUrl(qr: Pick<QrCode, "fallbackUrl">, shop: Pick<Shop, "domain" | "settings">, entitlements: PlanEntitlements): string {
  if (entitlements.customFallback) {
    if (qr.fallbackUrl) return qr.fallbackUrl;
    const settings = readShopSettings(shop);
    if (settings.defaultFallbackUrl) return settings.defaultFallbackUrl;
  }
  return `https://${shop.domain}/`;
}

function redirectTo(location: string, parsed: ParsedRequest): Response {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  if (parsed.setCookie) headers.append("Set-Cookie", parsed.setCookie);
  return new Response(null, { status: 302, headers });
}

function cleanRef(value: string | null): string | null {
  const ref = (value ?? "").trim().replace(/[^\w#\-.:/ ]/g, "").slice(0, 80);
  return ref || null;
}

/* ──────────── Visitor language for the hosted pages ──────────── */

type Lang = "en" | "fr" | "es" | "de" | "pt";

const COPY: Record<Lang, Record<string, string>> = {
  en: {
    message: "Message", copy: "Copy", copied: "Copied ✓", download: "Download",
    wifi: "WiFi network", encryption: "Encryption", password: "Password", copyPassword: "Copy password",
    passwordCopied: "Password copied ✓", wifiHint: "Scan the original QR code with your phone's camera to join automatically, or copy the password.",
    contact: "Contact", phone: "Phone", email: "Email", website: "Website", saveContact: "Save contact",
    notFoundTitle: "QR code not found", notFound: "This QR code doesn't exist or was deleted.",
  },
  fr: {
    message: "Message", copy: "Copier", copied: "Copié ✓", download: "Télécharger",
    wifi: "Réseau WiFi", encryption: "Chiffrement", password: "Mot de passe", copyPassword: "Copier le mot de passe",
    passwordCopied: "Mot de passe copié ✓", wifiHint: "Scannez le QR code d'origine avec l'appareil photo pour vous connecter automatiquement, ou copiez le mot de passe.",
    contact: "Contact", phone: "Téléphone", email: "E-mail", website: "Site web", saveContact: "Enregistrer le contact",
    notFoundTitle: "QR code introuvable", notFound: "Ce QR code n'existe pas ou a été supprimé.",
  },
  es: {
    message: "Mensaje", copy: "Copiar", copied: "Copiado ✓", download: "Descargar",
    wifi: "Red WiFi", encryption: "Cifrado", password: "Contraseña", copyPassword: "Copiar contraseña",
    passwordCopied: "Contraseña copiada ✓", wifiHint: "Escanea el código QR original con la cámara para conectarte automáticamente, o copia la contraseña.",
    contact: "Contacto", phone: "Teléfono", email: "Correo", website: "Sitio web", saveContact: "Guardar contacto",
    notFoundTitle: "Código QR no encontrado", notFound: "Este código QR no existe o fue eliminado.",
  },
  de: {
    message: "Nachricht", copy: "Kopieren", copied: "Kopiert ✓", download: "Herunterladen",
    wifi: "WLAN-Netzwerk", encryption: "Verschlüsselung", password: "Passwort", copyPassword: "Passwort kopieren",
    passwordCopied: "Passwort kopiert ✓", wifiHint: "Scannen Sie den Original-QR-Code mit der Kamera, um sich automatisch zu verbinden, oder kopieren Sie das Passwort.",
    contact: "Kontakt", phone: "Telefon", email: "E-Mail", website: "Webseite", saveContact: "Kontakt speichern",
    notFoundTitle: "QR-Code nicht gefunden", notFound: "Dieser QR-Code existiert nicht oder wurde gelöscht.",
  },
  pt: {
    message: "Mensagem", copy: "Copiar", copied: "Copiado ✓", download: "Baixar",
    wifi: "Rede WiFi", encryption: "Criptografia", password: "Senha", copyPassword: "Copiar senha",
    passwordCopied: "Senha copiada ✓", wifiHint: "Escaneie o código QR original com a câmera para se conectar automaticamente, ou copie a senha.",
    contact: "Contato", phone: "Telefone", email: "E-mail", website: "Site", saveContact: "Salvar contato",
    notFoundTitle: "Código QR não encontrado", notFound: "Este código QR não existe ou foi excluído.",
  },
};

function pickLanguage(languages: string[]): Lang {
  return (languages.find(l => l in COPY) as Lang | undefined) ?? "en";
}

/* ──────────── Landing pages for TEXT / WIFI / VCARD ──────────── */

function landingHtmlFor(type: "TEXT" | "WIFI" | "VCARD", payload: string, qrName: string, lang: Lang): string {
  const t = COPY[lang];
  if (type === "TEXT")  return textLanding(payload, qrName, t, lang);
  if (type === "WIFI")  return wifiLanding(payload, qrName, t, lang);
  return vcardLanding(payload, qrName, t, lang);
}

/** Escape a string for safe HTML embedding (text and double-quoted attributes). */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function textLanding(text: string, name: string, t: Record<string, string>, lang: Lang): string {
  const dataUri = `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`;
  return shell(name, lang, `
    <div class="card">
      <div class="eyebrow">${esc(t.message)}</div>
      <pre id="tqr-text">${esc(text)}</pre>
      <div class="actions">
        <button type="button" data-copy-target="#tqr-text" data-done="${esc(t.copied)}">${esc(t.copy)}</button>
        <a href="${esc(dataUri)}" download="${esc(name)}.txt">${esc(t.download)}</a>
      </div>
    </div>
  `);
}

function wifiLanding(payload: string, name: string, t: Record<string, string>, lang: Lang): string {
  // "WIFI:T:WPA;S:Aurora Guest;P:secret;;" — values may escape \ ; , " :
  const parts = parseWifiFields(payload);
  const ssid = parts.S ?? "";
  const pwd  = parts.P ?? "";
  const enc  = parts.T ?? "WPA";

  return shell(name, lang, `
    <div class="card">
      <div class="eyebrow">${esc(t.wifi)}</div>
      <h1>${esc(ssid)}</h1>
      <div class="kv">
        <div><span>${esc(t.encryption)}</span><b>${esc(enc)}</b></div>
        <div><span>${esc(t.password)}</span><b class="mono">${esc(pwd || "—")}</b></div>
      </div>
      ${pwd ? `<div class="actions">
        <button type="button" class="primary" data-copy-value="${esc(pwd)}" data-done="${esc(t.passwordCopied)}">${esc(t.copyPassword)}</button>
      </div>` : ""}
      <div class="hint">${esc(t.wifiHint)}</div>
    </div>
  `);
}

function vcardLanding(payload: string, name: string, t: Record<string, string>, lang: Lang): string {
  const lines = payload.split(/\r?\n/);
  const get = (key: string) => {
    const line = lines.find(l => l.toUpperCase().startsWith(key.toUpperCase() + ":") || l.toUpperCase().startsWith(key.toUpperCase() + ";"));
    return line ? line.substring(line.indexOf(":") + 1).trim() : "";
  };
  const fn    = get("FN");
  const org   = get("ORG");
  const title = get("TITLE");
  const tel   = get("TEL").replace(/[^\d+()\-\s.]/g, "");
  const email = get("EMAIL");
  const url   = safeLinkUrl(get("URL"));
  const dataUri = `data:text/vcard;charset=utf-8,${encodeURIComponent(payload)}`;

  return shell(name, lang, `
    <div class="card">
      <div class="eyebrow">${esc(t.contact)}</div>
      <h1>${esc(fn || name)}</h1>
      ${title || org ? `<div class="muted">${esc(title)}${title && org ? " · " : ""}${esc(org)}</div>` : ""}
      <div class="kv">
        ${tel   ? `<div><span>${esc(t.phone)}</span><a href="tel:${esc(tel.replace(/\s/g, ""))}">${esc(tel)}</a></div>` : ""}
        ${email ? `<div><span>${esc(t.email)}</span><a href="mailto:${esc(email)}">${esc(email)}</a></div>` : ""}
        ${url   ? `<div><span>${esc(t.website)}</span><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a></div>` : ""}
      </div>
      <div class="actions">
        <a href="${esc(dataUri)}" download="${esc(fn || name)}.vcf" class="primary">${esc(t.saveContact)}</a>
      </div>
    </div>
  `);
}

function notFound(lang: Lang): Response {
  const t = COPY[lang];
  return new Response(shell(t.notFoundTitle, lang, `
    <div class="card center">
      <div class="mark">▦</div>
      <h1>${esc(t.notFoundTitle)}</h1>
      <p>${esc(t.notFound)}</p>
    </div>
  `), { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

/** Copy buttons read their value from data-* attributes — never from inline JS. */
const COPY_SCRIPT = `document.addEventListener("click",function(e){var b=e.target.closest("[data-copy-value],[data-copy-target]");if(!b)return;var v=b.getAttribute("data-copy-value");if(v===null){var el=document.querySelector(b.getAttribute("data-copy-target"));v=el?el.innerText:"";}if(navigator.clipboard)navigator.clipboard.writeText(v);b.textContent=b.getAttribute("data-done")||"✓";});`;

function shell(title: string, lang: Lang, body: string): string {
  return `<!doctype html>
<html lang="${lang}"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body { font-family: -apple-system, system-ui, "Inter", sans-serif; background: #0B1220; color: #E2E8F0; margin: 0; padding: 24px; min-height: 100vh; display: grid; place-items: center; line-height: 1.5; }
  .card { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.10); border-radius: 16px; padding: 28px; max-width: 420px; width: 100%; }
  .card.center { text-align: center; }
  .eyebrow { font-family: ui-monospace, monospace; font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: #93C5FD; margin-bottom: 12px; }
  h1 { font-family: "Instrument Serif", serif; font-weight: 400; font-size: 30px; letter-spacing: -0.02em; margin: 0 0 8px; color: #fff; word-break: break-word; }
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
  .actions button, .actions a { flex: 1; padding: 12px 16px; border: 1px solid rgba(255,255,255,0.16); background: rgba(255,255,255,0.06); color: #fff; border-radius: 10px; font-size: 14px; font-weight: 500; cursor: pointer; text-decoration: none; text-align: center; font-family: inherit; }
  .actions .primary, .actions a.primary { background: linear-gradient(135deg, #2563EB, #7C3AED); border-color: transparent; }
  .actions button:active, .actions a:active { transform: translateY(1px); }
  .hint { color: #5B6172; font-size: 12px; margin-top: 14px; text-align: center; }
  .mark { width: 56px; height: 56px; border-radius: 14px; background: linear-gradient(135deg, #2563EB, #7C3AED); margin: 0 auto 18px; display: grid; place-items: center; font-size: 28px; color: #fff; }
</style>
</head>
<body>${body}<script>${COPY_SCRIPT}</script></body>
</html>`;
}
