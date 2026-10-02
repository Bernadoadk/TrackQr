/**
 * WiFi QR payloads — "WIFI:T:WPA;S:<ssid>;P:<password>;H:true;;".
 * Special characters (\ ; , " :) are backslash-escaped in values.
 * Client-safe: used by the Create page and the scan landing page.
 */
export type WifiEncryption = "WPA" | "WEP" | "nopass";

const escapeValue = (s: string) => s.replace(/([\\;,":])/g, "\\$1");

export function wifiPayload(ssid: string, password: string, encryption: WifiEncryption = "WPA", hidden = false): string {
  const pwd = encryption === "nopass" ? "" : password;
  return `WIFI:T:${encryption};S:${escapeValue(ssid)};P:${escapeValue(pwd)};${hidden ? "H:true;" : ""};`;
}

/** Escape-aware parser (a password may contain ";" or ":"). */
export function parseWifiFields(payload: string): Record<string, string> {
  const parts: Record<string, string> = {};
  const body = payload.replace(/^WIFI:/i, "");
  let key = "";
  let value = "";
  let readingKey = true;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "\\" && i + 1 < body.length) {
      if (readingKey) key += body[++i]; else value += body[++i];
      continue;
    }
    if (readingKey && ch === ":") { readingKey = false; continue; }
    if (!readingKey && ch === ";") {
      if (key) parts[key.toUpperCase()] = value;
      key = ""; value = ""; readingKey = true;
      continue;
    }
    if (readingKey) key += ch; else value += ch;
  }
  if (key && !readingKey) parts[key.toUpperCase()] = value;
  return parts;
}

export function parseWifiPayload(payload: string): { ssid: string; password: string; encryption: WifiEncryption } {
  const parts = parseWifiFields(payload);
  const t = parts.T;
  return {
    ssid: parts.S ?? "",
    password: parts.P ?? "",
    encryption: t === "WEP" || t === "nopass" ? t : "WPA",
  };
}
