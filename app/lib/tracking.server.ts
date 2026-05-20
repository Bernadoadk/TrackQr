import { UAParser } from "ua-parser-js";
import prisma from "../db.server";
import type { DeviceType } from "@prisma/client";
import { hashIp, randomToken } from "./crypto.server";

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
  sessionToken: string;
  setCookie: string | null; // null when an existing cookie was reused
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

  const country = req.headers.get("CF-IPCountry");
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
    country: country && country !== "XX" ? country : null,
    device: deviceType,
    os:      os.name      || null,
    browser: browser.name || null,
    userAgent: ua || null,
    referer: req.headers.get("Referer"),
    sessionToken,
    setCookie,
  };
}

/** Insert a Scan row. Errors are swallowed — tracking must never block the redirect. */
export async function recordScan(qrCodeId: string, parsed: ParsedRequest): Promise<string | null> {
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
