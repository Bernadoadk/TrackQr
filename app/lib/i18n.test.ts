import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { es } from "../locales/es";
import { fr } from "../locales/fr";
import { formatNumber, resolveLocale, setClientLocale, t, tem, tm, tp, tx } from "./i18n";
// Registers every dictionary, as on the server.
import "./i18n.server";

afterEach(() => setClientLocale("en"));

describe("resolveLocale", () => {
  it("prefers the Shopify admin locale", () => {
    expect(resolveLocale("fr", "en-US")).toBe("fr");
    expect(resolveLocale("fr-CA")).toBe("fr");
    expect(resolveLocale("de", "fr-FR")).toBe("en");
  });

  it("falls back to the browser languages", () => {
    expect(resolveLocale(null, "de-DE,fr;q=0.8")).toBe("fr");
    expect(resolveLocale(null, "es-MX")).toBe("es");
    expect(resolveLocale(null, "it")).toBe("en");
    expect(resolveLocale(undefined, undefined)).toBe("en");
  });
});

describe("t / tp / tm", () => {
  it("returns English keys untouched and interpolates", () => {
    expect(t("Save settings")).toBe("Save settings");
    expect(t("Upgrade to {plan}", { plan: "Growth" })).toBe("Upgrade to Growth");
    expect(t("{count} to fallback", { count: 1234 })).toBe("1,234 to fallback");
  });

  it("translates and formats numbers in French", () => {
    setClientLocale("fr");
    expect(t("Save settings")).toBe("Enregistrer les paramètres");
    expect(t("{count} to fallback", { count: 1234 })).toBe(`${formatNumber(1234)} vers la page de secours`);
    expect(t("Not a known key")).toBe("Not a known key");
  });

  it("uses each locale's plural rules", () => {
    expect(tp(0, "{count} scan", "{count} scans")).toBe("0 scans");
    expect(tp(1, "{count} scan", "{count} scans")).toBe("1 scan");
    setClientLocale("fr");
    expect(tp(0, "{count} scan", "{count} scans")).toBe("0 scan");
    expect(tp(3, "{count} active")).toBe("3 actifs");
    expect(tp(1, "{count} active")).toBe("1 actif");
    // Spanish: 0 is plural.
    setClientLocale("es");
    expect(tp(0, "{count} scan", "{count} scans")).toBe("0 escaneos");
    expect(tp(1, "{count} active")).toBe("1 activo");
    expect(t("Save settings")).toBe("Guardar la configuración");
  });

  it("translates server messages, including the values they embed", () => {
    setClientLocale("fr");
    expect(tm("Settings saved.")).toBe("Paramètres enregistrés.");
    expect(tm("Smart routing and A/B tests requires the Growth plan.")).toBe("Routage intelligent et tests A/B : nécessite le forfait Growth.");
    expect(tm("Your Free plan allows 3 QR codes. Archive or delete one, or upgrade to add more.")).toContain("Votre forfait Free autorise 3 QR codes");
    expect(tm("Some unexpected server error")).toBe("Some unexpected server error");
    expect(tm(undefined)).toBe("");
  });

  it("scopes the locale of server work (SSR, emails)", async () => {
    const { runWithLocale } = await import("./i18n.server");
    expect(runWithLocale("fr", () => t("Weekly report"))).toBe("Rapport hebdomadaire");
    expect(await runWithLocale("fr", async () => {
      await new Promise(resolve => setTimeout(resolve, 5));
      return tp(2, "{count} scan", "{count} scans");
    })).toBe("2 scans");
    expect(runWithLocale("klingon", () => t("Weekly report"))).toBe("Weekly report");
    expect(t("Weekly report")).toBe("Weekly report");
  });

  it("renders markup placeholders and emphasized titles", () => {
    setClientLocale("fr");
    const parts = tx("Click {button} and paste the snippet where the QR code should appear.", { button: "Modifier le code" });
    expect(parts.map(p => (typeof p === "string" ? p : "[node]")).join("")).toBe("Cliquez sur [node] et collez l'extrait à l'endroit où le QR code doit apparaître.");
    const title = tem("<em>Scan</em> analytics");
    expect(title.filter(p => typeof p === "string").join("")).toBe("Analyse des ");
    expect(title).toHaveLength(3);
  });
});

/* ── Dictionary checks ── */

const PLACEHOLDER = /\{(\w+)\}/g;
const baseKey = (key: string) => key.replace(/\|(one|other)$/, "");
const placeholders = (text: string) => [...text.matchAll(PLACEHOLDER)].map(m => m[1]).sort();

/** Literal keys passed to t() / tx() / tem() / tp() in the app sources. */
function keysUsedInCode(): Map<string, { file: string; plural: boolean }> {
  const files = ["app/routes", "app/components", "app/lib"].flatMap(root =>
    (fs.readdirSync(root, { recursive: true }) as string[])
      // i18n.ts itself only shows examples in its comments.
      .filter(rel => /\.tsx?$/.test(rel) && !rel.endsWith(".test.ts") && !/^i18n(\.server)?\.ts$/.test(rel))
      .map(rel => path.join(root, rel)),
  );
  const literal = String.raw`"((?:[^"\\]|\\.)*)"`;
  const single = new RegExp(String.raw`\b(?:t|tx|tem)\(\s*${literal}`, "g");
  const plural = new RegExp(String.raw`\btp\(\s*[^,()]+(?:\([^()]*\))?[^,()]*,\s*${literal}(?:\s*,\s*${literal})?`, "g");
  const keys = new Map<string, { file: string; plural: boolean }>();
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    if (!/from "(\.\.\/)+lib\/i18n"|from "\.\/i18n"/.test(src)) continue;
    for (const m of src.matchAll(single)) keys.set(JSON.parse(`"${m[1]}"`) as string, { file, plural: false });
    for (const m of src.matchAll(plural)) {
      for (const raw of [m[1], m[2]]) {
        if (raw !== undefined) keys.set(JSON.parse(`"${raw}"`) as string, { file, plural: true });
      }
    }
  }
  return keys;
}

const DICTIONARIES = { fr, es };

describe.each(Object.entries(DICTIONARIES))("%s dictionary", (_locale, dict) => {
  it("keeps every placeholder and emphasis marker of its key", () => {
    const broken = Object.entries(dict).filter(([key, value]) => {
      const source = baseKey(key);
      return placeholders(source).join() !== placeholders(value).join()
        || (source.match(/<em>/g) ?? []).length !== (value.match(/<em>/g) ?? []).length;
    });
    expect(broken).toEqual([]);
  });

  it("translates every literal key used by the app", () => {
    const used = keysUsedInCode();
    const missing = [...used].filter(([key, { plural }]) => !(key in dict) && !(plural && `${key}|one` in dict))
      .map(([key, { file }]) => `${file}: ${key}`);
    expect(missing).toEqual([]);
    // Guard against a silently empty scan (paths, regex).
    expect(used.size).toBeGreaterThan(900);
  });

  it("has the same keys as the French dictionary", () => {
    expect(Object.keys(dict).sort()).toEqual(Object.keys(fr).sort());
  });
});

