import crypto from "node:crypto";

/**
 * Short-lived HMAC tokens for links opened outside the embedded admin (a new
 * browser tab has no Shopify session token), e.g. campaign previews.
 */
function secret(): string {
  return process.env.SHOPIFY_API_SECRET || process.env.SIGNING_SECRET || "trackqr-dev-signing-secret";
}

function sign(payload: string, expiresAt: number): string {
  return crypto
    .createHmac("sha256", secret())
    .update(`${payload}|${expiresAt}`)
    .digest("base64url")
    .slice(0, 32);
}

/** `${expiresAt}.${signature}` — valid for `ttlSeconds`. */
export function createSignedToken(payload: string, ttlSeconds = 24 * 3600): string {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  return `${expiresAt}.${sign(payload, expiresAt)}`;
}

export function verifySignedToken(payload: string, token: string | null | undefined): boolean {
  if (!token) return false;
  const [expRaw, signature] = token.split(".");
  const expiresAt = Number(expRaw);
  if (!Number.isFinite(expiresAt) || !signature) return false;
  if (expiresAt < Math.floor(Date.now() / 1000)) return false;
  const expected = sign(payload, expiresAt);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Preview link for a campaign, valid 24 hours. */
export function campaignPreviewPath(campaignId: string): string {
  const token = createSignedToken(`campaign-preview:${campaignId}`);
  return `/campaigns/${campaignId}/preview?token=${encodeURIComponent(token)}`;
}

export function verifyCampaignPreviewToken(campaignId: string, token: string | null | undefined): boolean {
  return verifySignedToken(`campaign-preview:${campaignId}`, token);
}
