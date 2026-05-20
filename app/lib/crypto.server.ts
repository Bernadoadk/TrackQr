import crypto from "node:crypto";

const ALGO = "aes-256-gcm";

function getKey(): Buffer {
  const raw = process.env.INTEGRATION_KEY;
  if (!raw) {
    // Dev fallback — 32 bytes of zeros. NEVER ship to prod without INTEGRATION_KEY set.
    return crypto.createHash("sha256").update("trackqr-dev-fallback").digest();
  }
  // Accept hex (64 chars), base64, or raw — normalize to 32 bytes.
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  const b = Buffer.from(raw, "base64");
  if (b.length === 32) return b;
  return crypto.createHash("sha256").update(raw).digest();
}

/** Encrypt a secret string. Returns "iv:tag:ciphertext" base64-encoded. */
export function encryptSecret(plain: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptSecret(blob: string): string {
  const [ivB64, tagB64, encB64] = blob.split(":");
  if (!ivB64 || !tagB64 || !encB64) throw new Error("Malformed encrypted blob");
  const key = getKey();
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const enc = Buffer.from(encB64, "base64");
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

/**
 * Daily-salted IP hash for GDPR-safe scan deduplication.
 * Uses today's date so the same IP gives the same hash within a day,
 * but cannot be reverse-linked across days.
 */
export function hashIp(ip: string): string {
  const day = new Date().toISOString().slice(0, 10);
  const pepper = process.env.IP_HASH_PEPPER || "trackqr-pepper";
  return crypto.createHash("sha256").update(`${ip}|${day}|${pepper}`).digest("hex");
}

/** Short random token for session cookies, scan IDs in URLs, etc. */
export function randomToken(bytes = 16): string {
  return crypto.randomBytes(bytes).toString("base64url");
}
