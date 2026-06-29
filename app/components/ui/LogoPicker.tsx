import React from "react";
import {
  siWhatsapp, siFacebook, siX, siInstagram, siYoutube, siTiktok,
  siThreads, siSpotify, siApple, siSnapchat, siTelegram, siDiscord,
  siTwitch, siPinterest, siReddit, siGoogle, siGooglemaps, siShopify,
  siGmail, siApplemusic, siWechat, siMessenger, siSignal,
} from "simple-icons";
import { Icon } from "./Icon";

/* ──────────────────────────────────────────────────────────────────
 * Brand center logos for QR codes. Sourced from `simple-icons` —
 * authentic brand SVG paths and palette hex, MIT-licensed by upstream.
 *
 * Each `glyph` is the official monochrome path; we paint it WHITE over
 * a rounded square filled with the official brand color. For brands
 * whose canonical mark is dark on light (Apple, X), we keep the brand
 * color dark and a light background so the glyph stays visible.
 * ──────────────────────────────────────────────────────────────── */

interface SiIcon { title: string; slug: string; path: string; hex: string; }

interface BrandSpec {
  /** Stable id stored on the QR record. */
  id: string;
  /** User-facing label. */
  name: string;
  /** Imported simple-icons object. */
  icon: SiIcon;
  /** Glyph color (default white). Some brands look better dark-on-light. */
  glyphColor?: string;
  /** Background override (defaults to "#" + icon.hex). Used for white-marked brands like Google. */
  bg?: string;
}

const SPECS: BrandSpec[] = [
  { id: "whatsapp",    name: "WhatsApp",      icon: siWhatsapp },
  { id: "messenger",   name: "Messenger",     icon: siMessenger },
  { id: "facebook",    name: "Facebook",      icon: siFacebook },
  { id: "instagram",   name: "Instagram",     icon: siInstagram, bg: "linear-gradient(45deg,#FFD600,#FF7A00,#FF0069,#D300C5,#7638FA)" },
  { id: "x",           name: "X",             icon: siX },
  { id: "threads",     name: "Threads",       icon: siThreads },
  { id: "tiktok",      name: "TikTok",        icon: siTiktok },
  { id: "youtube",     name: "YouTube",       icon: siYoutube },
  { id: "snapchat",    name: "Snapchat",      icon: siSnapchat, glyphColor: "#000000" },
  { id: "pinterest",   name: "Pinterest",     icon: siPinterest },
  { id: "reddit",      name: "Reddit",        icon: siReddit },
  { id: "telegram",    name: "Telegram",      icon: siTelegram },
  { id: "discord",     name: "Discord",       icon: siDiscord },
  { id: "twitch",      name: "Twitch",        icon: siTwitch },
  { id: "wechat",      name: "WeChat",        icon: siWechat },
  { id: "signal",      name: "Signal",        icon: siSignal },
  { id: "spotify",     name: "Spotify",       icon: siSpotify },
  { id: "applemusic",  name: "Apple Music",   icon: siApplemusic },
  { id: "apple",       name: "Apple",         icon: siApple },
  { id: "google",      name: "Google",        icon: siGoogle,     bg: "#FFFFFF", glyphColor: "#4285F4" },
  { id: "gmail",       name: "Gmail",         icon: siGmail,      bg: "#FFFFFF", glyphColor: "#EA4335" },
  { id: "googlemaps",  name: "Google Maps",   icon: siGooglemaps, bg: "#FFFFFF", glyphColor: "#1A73E8" },
  { id: "shopify",     name: "Shopify",       icon: siShopify },
];

export interface BrandLogo {
  id: string;
  name: string;
  /** Resolved background (CSS color or linear-gradient). */
  bg: string;
  /** SVG `<path>` data for the glyph (24×24 viewBox). */
  path: string;
  /** Color of the glyph stroke/fill. */
  glyphColor: string;
}

export const BRAND_LOGOS: BrandLogo[] = SPECS.map(s => ({
  id: s.id,
  name: s.name,
  bg: s.bg ?? `#${s.icon.hex}`,
  path: s.icon.path,
  glyphColor: s.glyphColor ?? "#FFFFFF",
}));

/**
 * Render the brand logo as a self-contained SVG (rounded square + glyph),
 * encoded as a data URL — usable as an <img src=…> or inside an <image href=…>.
 */
export function logoSvgDataUrl(logoId: string, size = 80): string {
  const logo = BRAND_LOGOS.find(l => l.id === logoId);
  if (!logo) return "";
  const bg = logo.bg.startsWith("linear-gradient") || logo.bg.startsWith("radial-gradient")
    ? `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#FFD600"/><stop offset="50%" stop-color="#FF0069"/><stop offset="100%" stop-color="#7638FA"/></linearGradient></defs><rect width="24" height="24" rx="5" fill="url(#g)"/>`
    : `<rect width="24" height="24" rx="5" fill="${logo.bg}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}">${bg}<path d="${logo.path}" fill="${logo.glyphColor}" transform="scale(0.7) translate(5.2 5.2)"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export interface LogoSelection {
  kind: "none" | "brand" | "custom";
  brandId?: string | null;
  customUrl?: string | null;
  customPreviewUrl?: string | null;
  customAssetId?: string | null;
}

export function LogoPicker({ value, onChange }: {
  value: LogoSelection;
  onChange: (next: LogoSelection) => void;
}) {
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const previewUrlRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  const triggerUpload = () => {
    setError(null);
    fileRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/files/upload", { method: "POST", body: fd });
      const json = await res.json() as { ok: boolean; asset?: { assetId: string; url: string }; message?: string };
      if (!json.ok || !json.asset) {
        setError(json.message ?? "Upload failed");
        return;
      }
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      const previewUrl = URL.createObjectURL(file);
      previewUrlRef.current = previewUrl;
      onChange({
        kind: "custom",
        customUrl: json.asset.url,
        customPreviewUrl: previewUrl,
        customAssetId: json.asset.assetId,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const isNone   = value.kind === "none";
  const isCustom = value.kind === "custom";

  return (
    <div>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(8, 1fr)",
        gap: 8,
        marginTop: 4,
      }}>
        {/* "None" */}
        <button
          type="button"
          onClick={() => onChange({ kind: "none" })}
          className={`logo-tile ${isNone ? "active" : ""}`}
          title="No logo"
          style={tileStyle(isNone)}
        >
          <Icon name="x" size={16} style={{ color: "var(--fg-subtle)" }} />
        </button>

        {/* Brand presets */}
        {BRAND_LOGOS.map(logo => {
          const active = value.kind === "brand" && value.brandId === logo.id;
          return (
            <button
              key={logo.id}
              type="button"
              onClick={() => onChange({ kind: "brand", brandId: logo.id })}
              className={`logo-tile ${active ? "active" : ""}`}
              title={logo.name}
              style={tileStyle(active)}
            >
              <img src={logoSvgDataUrl(logo.id, 36)} alt={logo.name} width={28} height={28} style={{ display: "block" }} />
            </button>
          );
        })}

        {/* Upload */}
        {isCustom && value.customUrl ? (
          <button
            type="button"
            onClick={triggerUpload}
            className="logo-tile active"
            title="Replace custom logo"
            style={tileStyle(true)}
          >
            <img src={value.customPreviewUrl || value.customUrl} alt="Custom" width={28} height={28} style={{ display: "block", objectFit: "contain" }} />
          </button>
        ) : (
          <button
            type="button"
            onClick={triggerUpload}
            disabled={uploading}
            className="logo-tile"
            title="Upload custom logo"
            style={{ ...tileStyle(false), borderStyle: "dashed", opacity: uploading ? 0.6 : 1 }}
          >
            {uploading
              ? <Icon name="loader" size={16} style={{ color: "var(--accent)" }} />
              : <Icon name="image" size={16} style={{ color: "var(--fg-subtle)" }} />}
          </button>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif"
          style={{ display: "none" }}
          onChange={handleFileChange}
        />
      </div>

      {error && (
        <div style={{ marginTop: 8, fontSize: 11, color: "var(--red-fg)" }}>{error}</div>
      )}

      <div style={{ marginTop: 8, fontSize: 11, color: "var(--fg-muted)", fontFamily: "var(--ff-mono)" }}>
        {value.kind === "brand"  && <>Selected: <b>{BRAND_LOGOS.find(l => l.id === value.brandId)?.name ?? value.brandId}</b></>}
        {value.kind === "custom" && <>Selected: <b>Custom upload</b> · max 2 MB · PNG/JPG/SVG/WebP/GIF</>}
        {value.kind === "none"   && <>No center logo</>}
      </div>
    </div>
  );
}

function tileStyle(active: boolean): React.CSSProperties {
  return {
    width: "100%",
    aspectRatio: "1",
    background: active ? "var(--accent-soft)" : "var(--bg-surface)",
    border: `1.5px solid ${active ? "var(--accent)" : "var(--border)"}`,
    borderRadius: 10,
    cursor: "pointer",
    display: "grid",
    placeItems: "center",
    padding: 6,
    transition: "all .14s var(--ease)",
  };
}
