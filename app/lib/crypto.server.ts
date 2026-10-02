import crypto from "node:crypto";

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
