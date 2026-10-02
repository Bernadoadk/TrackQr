import { UAParser } from "ua-parser-js";
import { isbot } from "isbot";
import crypto from "node:crypto";
import prisma from "../db.server";
import type { DeviceType } from "@prisma/client";
import { hashIp, randomToken } from "./crypto.server";
import { parseAcceptLanguage } from "./routing";

export const SESSION_COOKIE = "tqr_sid";
export const SESSION_TTL_DAYS = 7;

export interface ParsedRequest {
  ip: string | null;
  country: string | null;
  device: DeviceType;
  os: string | null;
  browser: string | null;
  userAgent: string | null;
  referer: string | null;
  /** Crawlers and link-preview bots (WhatsApp, iMessage, Slack…): not counted. */
  isBot: boolean;
  /** Visitor languages from Accept-Language, best first. */
  languages: string[];
  sessionToken: string;
  setCookie: string | null; // null when an existing cookie was reused
}

/** Stable 0–1 value for a visitor + key (sticky A/B assignment). */
export function visitorBucket(sessionToken: string, key: string): number {
  const digest = crypto.createHash("sha256").update(`${sessionToken}|${key}`).digest();
  return digest.readUInt32BE(0) / 0x100000000;
}

/** Best-effort client IP — supports a few common reverse proxies. */
function extractIp(req: Request): string | null {
  const h = req.headers;
  const cf = h.get("CF-Connecting-IP");
  if (cf) return cf;
  const xfwd = h.get("X-Forwarded-For");
  if (xfwd) return xfwd.split(",")[0]?.trim() ?? null;
  const xreal = h.get("X-Real-IP");
  if (xreal) return xreal;
  return null;
}

/**
 * ISO-3166 alpha-2 country injected by the edge / reverse proxy in front of
 * the app. Vercel (production host), Cloudflare and CloudFront each use their
 * own header; a generic X-Country-Code is accepted for other setups.
 */
function extractCountry(req: Request): string | null {
  const h = req.headers;
  const raw =
    h.get("X-Vercel-IP-Country") ||
    h.get("CF-IPCountry") ||
    h.get("CloudFront-Viewer-Country") ||
    h.get("X-Country-Code");
  if (!raw) return null;
  const code = raw.trim().toUpperCase();
  // "XX" (Cloudflare unknown) and "T1" (Tor) carry no usable geography.
  return /^[A-Z]{2}$/.test(code) && code !== "XX" && code !== "T1" ? code : null;
}

function readSessionCookie(req: Request): string | null {
  const raw = req.headers.get("Cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [name, value] = part.trim().split("=");
    if (name === SESSION_COOKIE && value) return decodeURIComponent(value);
  }
  return null;
}

export function parseRequest(req: Request): ParsedRequest {
  const ua = req.headers.get("User-Agent") ?? "";
  const parser = new UAParser(ua);
  const device = parser.getDevice();
  const os = parser.getOS();
  const browser = parser.getBrowser();

  const kind = device.type;
  const deviceType: DeviceType =
    kind === "mobile" ? "MOBILE" :
    kind === "tablet" ? "TABLET" :
    kind === "wearable" || kind === "embedded" ? "MOBILE" :
    ua ? "DESKTOP" : "UNKNOWN";

  const country = extractCountry(req);
  const ip = extractIp(req);

  let sessionToken = readSessionCookie(req);
  let setCookie: string | null = null;
  if (!sessionToken) {
    sessionToken = randomToken(16);
    const maxAge = SESSION_TTL_DAYS * 24 * 3600;
    setCookie = `${SESSION_COOKIE}=${encodeURIComponent(sessionToken)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax`;
  }

  return {
    ip,
    country,
    device: deviceType,
    os:      os.name      || null,
    browser: browser.name || null,
    userAgent: ua || null,
    referer: req.headers.get("Referer"),
    isBot: !ua || isbot(ua),
    languages: parseAcceptLanguage(req.headers.get("Accept-Language")),
    sessionToken,
    setCookie,
  };
}

export interface ScanExtras {
  /** Reference carried by the scan URL (?ref=…), e.g. an order number. */
  ref?: string | null;
  /** Smart-routing rule / A/B variant that served the scan. */
  route?: string | null;
}

/** Insert a Scan row. Errors are swallowed — tracking must never block the redirect. */
export async function recordScan(qrCodeId: string, parsed: ParsedRequest, extras: ScanExtras = {}): Promise<string | null> {
  try {
    const scan = await prisma.scan.create({
      data: {
        qrCodeId,
        sessionToken: parsed.sessionToken,
        ipHash: parsed.ip ? hashIp(parsed.ip) : null,
        country: parsed.country,
        device: parsed.device,
        os: parsed.os,
        browser: parsed.browser,
        userAgent: parsed.userAgent?.slice(0, 500) ?? null,
        referer: parsed.referer?.slice(0, 500) ?? null,
        ref: extras.ref?.slice(0, 80) || null,
        route: extras.route?.slice(0, 60) || null,
        delivered: true,
      },
      select: { id: true },
    });
    return scan.id;
  } catch (err) {
    console.error("[tracking] recordScan failed", err);
    return null;
  }
}

/** Scan that hit the fallback URL instead of the destination. */
export async function recordMissedScan(qrCodeId: string, reason: "PAUSED" | "SCHEDULED" | "EXPIRED" | "OVER_QUOTA" | "ARCHIVED") {
  try {
    await prisma.missedScan.create({ data: { qrCodeId, reason } });
  } catch (err) {
    console.error("[tracking] recordMissedScan failed", err);
  }
}
