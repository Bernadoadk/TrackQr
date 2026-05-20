import type { HeadersFunction, LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { requireShop } from "../lib/shop.server";
import { createQr } from "../lib/qr-crud.server";
import { QuotaExceededError } from "../lib/plan.server";
import { Icon } from "../components/ui/Icon";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Card } from "../components/ui/Card";
import { Field, Input, Textarea } from "../components/ui/Input";
import { Segmented } from "../components/ui/Segmented";
import { useToast } from "../components/ui/Toast";
import { renderQrSvg as renderQrSvgClient } from "../lib/qr-render";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await requireShop(request);
  const form = await request.formData();

  try {
    const design = JSON.parse(String(form.get("design") ?? "{}"));
    const label = JSON.parse(String(form.get("label") ?? "{}"));

    const qr = await createQr(shop, {
      name: String(form.get("name") ?? ""),
      description: (form.get("description") as string | null) || null,
      type: String(form.get("type") ?? ""),
      target: String(form.get("target") ?? ""),
      shopifyRef: (form.get("shopifyRef") as string | null) || null,
      design,
      label,
      utmCampaign: (form.get("utmCampaign") as string | null) || null,
      utmSource: (form.get("utmSource") as string | null) || null,
      utmMedium: (form.get("utmMedium") as string | null) || null,
      activate: form.get("activate") === "1",
    });

    return { ok: true, id: qr.id, slug: qr.slug, name: qr.name } as const;
  } catch (err) {
    if (err instanceof QuotaExceededError) {
      return {
        ok: false,
        error: "quota",
        message: `Plan limit reached — ${err.resource} (${err.limit} max on ${err.planId}). Upgrade to add more.`,
      } as const;
    }
    const message = err instanceof Error ? err.message : "Could not save QR code";
    return { ok: false, error: "validation", message } as const;
  }
};

/* ── Types ── */
type QrStyle     = "square" | "rounded" | "dot" | "classy";
type CornerStyle = "square" | "rounded" | "extra-rounded";
type LabelPos    = "none" | "top" | "bottom" | "left" | "right";
type LabelTone   = "default" | "brand" | "mono" | "muted";

const QR_TYPES = [
  { id: "home",    name: "Homepage",     icon: "home",           group: "shopify", url: "/" },
  { id: "product", name: "Product page", icon: "package",        group: "shopify", url: "/products/aurora-tee" },
  { id: "link",    name: "Link",         icon: "link",           group: "shopify", url: "https://" },
  { id: "atc",     name: "Add to cart",  icon: "shopping-cart",  group: "shopify", url: "/cart/add" },
  { id: "promo",   name: "Promo code",   icon: "tag",            group: "shopify", url: "/discount/" },
  { id: "url",     name: "Custom URL",   icon: "globe",          group: "custom",  url: "https://" },
  { id: "text",    name: "Text",         icon: "type",           group: "custom" },
  { id: "phone",   name: "Phone",        icon: "phone",          group: "custom" },
  { id: "sms",     name: "SMS",          icon: "message-square", group: "custom" },
  { id: "email",   name: "Email",        icon: "mail",           group: "custom" },
  { id: "wifi",    name: "WiFi",         icon: "wifi",           group: "custom" },
  { id: "vcard",   name: "vCard",        icon: "id-card",        group: "custom" },
] as const;

type QrTypeId = (typeof QR_TYPES)[number]["id"];

function typeMeta(id: QrTypeId) { return QR_TYPES.find(t => t.id === id) ?? QR_TYPES[0]; }

const QR_STYLES: QrStyle[]      = ["square", "rounded", "dot", "classy"];
const QR_CORNERS: CornerStyle[] = ["square", "rounded", "extra-rounded"];
const QR_COLORS    = ["#0B1220", "#2563EB", "#7C3AED", "#16A34A", "#D97706", "#DB2777"];
const QR_BG_COLORS = ["#FFFFFF", "#F1F5F9", "#FEF3C7", "#DCFCE7", "#DBEAFE", "#FCE7F3"];
const LABEL_POSITIONS: LabelPos[] = ["none", "top", "bottom", "left", "right"];
const LABEL_TONES = [
  { value: "default", label: "Default" },
  { value: "brand",   label: "Brand"   },
  { value: "mono",    label: "Mono"    },
  { value: "muted",   label: "Muted"   },
];

/* ── QrSvg (live preview) ──
 * Uses the shared renderQrSvg from app/lib/qr-render.ts so the preview
 * looks identical to what /qr/:id/svg serves after activation.
 */
function QrSvg({ text, size = 220, fg, bg, style, cornerStyle, logo }: {
  text: string; size?: number; fg: string; bg: string; style: QrStyle; cornerStyle: CornerStyle; logo: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    try {
      const svg = renderQrSvgClient(text || "TrackQr placeholder", {
        size, fg, bg, style, cornerStyle, withLogo: logo,
      });
      ref.current.innerHTML = svg;
    } catch (err) {
      console.error("[qr-preview] render failed", err);
    }
  }, [text, size, fg, bg, style, cornerStyle, logo]);
  return <div ref={ref} style={{ width: "100%", height: "100%", display: "grid", placeItems: "center" }} />;
}

/* ── StyleIllus — static mini pattern illustration (no CDN needed) ── */
const ILLUS_BITS = [
  [1,0,1,1,0,1,0],
  [0,1,0,1,1,0,1],
  [1,0,1,0,1,1,0],
  [1,1,0,1,0,0,1],
  [0,1,1,0,1,0,1],
  [1,0,0,1,1,1,0],
  [0,1,1,0,0,1,1],
];
function StyleIllus({ qrStyle, size = 36 }: { qrStyle: QrStyle; size?: number }) {
  const cell = size / ILLUS_BITS.length;
  const r =
    qrStyle === "dot"     ? cell / 2 :
    qrStyle === "rounded" ? cell * 0.38 :
    qrStyle === "classy"  ? cell * 0.22 : 0;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} style={{ display: "block" }}>
      {ILLUS_BITS.flatMap((row, ri) =>
        row.map((dark, ci) => {
          if (!dark) return null;
          const x = ci * cell + 0.5;
          const y = ri * cell + 0.5;
          const w = cell - 1;
          const key = `${ri}-${ci}`;
          return qrStyle === "dot"
            ? <circle key={key} cx={x + w / 2} cy={y + w / 2} r={w * 0.42} fill="currentColor" />
            : <rect key={key} x={x} y={y} width={w} height={w} rx={r} fill="currentColor" />;
        })
      )}
    </svg>
  );
}

/* ── CornerMini ── */
function CornerMini({ corner }: { corner: CornerStyle }) {
  const r = corner === "extra-rounded" ? 11 : corner === "rounded" ? 6 : 0;
  return (
    <svg viewBox="0 0 28 28" width="32" height="32">
      <rect x="1" y="1" width="26" height="26" rx={r} fill="currentColor" />
      <rect x="5" y="5" width="18" height="18" rx={Math.max(0, r - 4)} fill="var(--bg-surface)" />
      <rect x="9" y="9" width="10" height="10" rx={Math.max(0, r - 8)} fill="currentColor" />
    </svg>
  );
}

/* ── PositionMini ── */
function PositionMini({ pos }: { pos: LabelPos }) {
  const qrRect = <rect x="11" y="11" width="14" height="14" rx="1.6" fill="currentColor" />;
  const line = (x: number, y: number, w: number, h = 1.4) =>
    <rect key={`${x}${y}`} x={x} y={y} width={w} height={h} rx="0.7" fill="currentColor" />;
  return (
    <svg viewBox="0 0 36 36" width="40" height="40">
      {qrRect}
      {pos === "top"    && <>{line(6, 4, 24)}{line(10, 7, 16)}</>}
      {pos === "bottom" && <>{line(10, 28, 16)}{line(6, 31, 24)}</>}
      {pos === "left"   && <>{line(1, 14, 7)}{line(1, 17, 7)}{line(1, 20, 5)}</>}
      {pos === "right"  && <>{line(28, 14, 7)}{line(28, 17, 7)}{line(30, 20, 5)}</>}
      {pos === "none"   && <g opacity="0.35"><line x1="6" y1="6" x2="30" y2="30" stroke="currentColor" strokeWidth="0.8" strokeDasharray="2 2" /></g>}
    </svg>
  );
}

/* ════════════════════════ Page ════════════════════════ */

export default function CreateQr() {
  const navigate = useNavigate();
  const toast    = useToast();
  const fetcher  = useFetcher<typeof action>();

  const [name,        setName]        = useState("");
  const [description, setDescription] = useState("");
  const [type,        setType]        = useState<QrTypeId>("product");
  const [target,      setTarget]      = useState("");

  // Design
  const [style,       setStyle]       = useState<QrStyle>("rounded");
  const [cornerStyle, setCornerStyle] = useState<CornerStyle>("rounded");
  const [fg,          setFg]          = useState("#0B1220");
  const [bg,          setBg]          = useState("#FFFFFF");
  const [withLogo,    setWithLogo]    = useState(false);

  // Label
  const [labelText, setLabelText] = useState("Scan to discover");
  const [labelPos,  setLabelPos]  = useState<LabelPos>("bottom");
  const [labelTone, setLabelTone] = useState<LabelTone>("default");
  const [framed,    setFramed]    = useState(false);

  const [activated,    setActivated]    = useState(false);
  const [generating,   setGenerating]   = useState(false);
  const [renderToken,  setRenderToken]  = useState(0);

  useEffect(() => {
    setGenerating(true);
    const t = setTimeout(() => { setGenerating(false); setRenderToken(k => k + 1); }, 380);
    return () => clearTimeout(t);
  }, [style, cornerStyle, fg, bg, withLogo, name, type, target, activated]);

  // React to server response after activation submit.
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.ok) {
      setActivated(true);
      toast({ title: "QR code activated", desc: "Saved to My QR codes." });
    } else {
      toast({
        type: "error",
        title: fetcher.data.error === "quota" ? "Plan limit reached" : "Could not save",
        desc: fetcher.data.message,
      });
    }
  }, [fetcher.state, fetcher.data]);

  const submitting = fetcher.state !== "idle";

  function handleActivate() {
    if (!valid) {
      toast({ type: "error", title: "Add a name first", desc: "QR code name is required to activate." });
      return;
    }
    const fd = new FormData();
    fd.set("name", name);
    fd.set("description", description);
    fd.set("type", type);
    fd.set("target", target || (tm as { url?: string }).url || "");
    fd.set("design", JSON.stringify({ style, cornerStyle, fg, bg, withLogo }));
    fd.set("label", JSON.stringify({ text: labelText, position: labelPos, tone: labelTone, framed }));
    fd.set("activate", "1");
    fetcher.submit(fd, { method: "post" });
  }

  const tm = typeMeta(type);

  const targetForType = () => {
    if (type === "product") return target || "Aurora Tee — Stone Wash";
    if (type === "promo")   return target || "FREESHIP";
    if (type === "wifi")    return target || "Aurora Guest";
    if (type === "phone" || type === "sms") return target || "+1 (800) 278-7622";
    if (type === "email")   return target || "hello@aurora.co";
    return target || (tm as { url?: string }).url || "https://aurora.co";
  };

  const previewText = activated
    ? `https://trackqr.app/scan/${(name || "untitled").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
    : (name ? `${name} · ${targetForType()}` : "TrackQr placeholder");

  const valid     = name.trim().length > 0;
  const showLabel = !!labelText && labelPos !== "none";

  return (
    <>
      <div className="page-head">
        <div className="page-head-left">
          <Button size="sm" variant="ghost" icon="chevron-left" onClick={() => navigate("/app")} style={{ marginBottom: 8, marginLeft: -10 }}>
            Back to dashboard
          </Button>
          <h1 className="page-h1">Create a <span className="em">QR code</span></h1>
          <div className="page-sub">Configure the destination, customize the design, add a label, activate when ready.</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 24, alignItems: "start" }}>

        {/* ══ LEFT — Form ══ */}
        <div className="col gap-4">

          {/* Basics */}
          <Card className="card-pad-lg">
            <div className="section-h" style={{ fontSize: 15, marginBottom: 4 }}>Basics</div>
            <div className="section-sub">Internal label and notes — only visible to your team.</div>
            <div className="grid grid-2 mt-4">
              <Field label="QR code name" required hint="e.g. 'Summer drop · Hero banner'">
                <Input placeholder="Untitled QR code" value={name} onChange={e => setName(e.target.value)} />
              </Field>
              <Field label="Description" hint="Optional — visible in My QR codes">
                <Input placeholder="Add a description" value={description} onChange={e => setDescription(e.target.value)} />
              </Field>
            </div>
          </Card>

          {/* Destination */}
          <Card className="card-pad-lg">
            <div className="section-h" style={{ fontSize: 15, marginBottom: 4 }}>Destination</div>
            <div className="section-sub">Pick what visitors will see when they scan.</div>

            <div className="text-xs strong" style={{ color: "var(--fg-muted)", margin: "16px 0 8px", letterSpacing: ".06em", textTransform: "uppercase", fontFamily: "var(--ff-mono)" }}>
              Shopify
            </div>
            <div className="tile-grid">
              {QR_TYPES.filter(t => t.group === "shopify").map(t => (
                <div key={t.id} className={`tile ${type === t.id ? "active" : ""}`}
                  onClick={() => { setType(t.id as QrTypeId); setActivated(false); }}>
                  <div className="tile-icon"><Icon name={t.icon} /></div>
                  <div className="tile-name">{t.name}</div>
                </div>
              ))}
            </div>

            <div className="text-xs strong" style={{ color: "var(--fg-muted)", margin: "20px 0 8px", letterSpacing: ".06em", textTransform: "uppercase", fontFamily: "var(--ff-mono)" }}>
              Custom
            </div>
            <div className="tile-grid">
              {QR_TYPES.filter(t => t.group === "custom").map(t => (
                <div key={t.id} className={`tile ${type === t.id ? "active" : ""}`}
                  onClick={() => { setType(t.id as QrTypeId); setActivated(false); }}>
                  <div className="tile-icon"><Icon name={t.icon} /></div>
                  <div className="tile-name">{t.name}</div>
                </div>
              ))}
            </div>

            <div className="mt-6">
              {type === "product" && (
                <Field label="Shopify product" hint="Search and pick from your catalog.">
                  <Input icon="search" placeholder="Search products…" value={target} onChange={e => setTarget(e.target.value)} />
                </Field>
              )}
              {type === "promo" && (
                <Field label="Discount code" hint="Visitor lands on cart with code pre-applied.">
                  <Input placeholder="FREESHIP" value={target} onChange={e => setTarget(e.target.value)} />
                </Field>
              )}
              {(type === "link" || type === "url") && (
                <Field label="Destination URL" hint="Any https:// link.">
                  <Input icon="link" placeholder="https://aurora.co/landing" value={target} onChange={e => setTarget(e.target.value)} />
                </Field>
              )}
              {type === "atc" && (
                <Field label="Variant to add" hint="Selecting will pre-fill the cart line.">
                  <Input icon="package" placeholder="Aurora Tee — M / Stone Wash" value={target} onChange={e => setTarget(e.target.value)} />
                </Field>
              )}
              {type === "home" && (
                <div className="text-sm muted">Scans will open your storefront home page. No additional config required.</div>
              )}
              {type === "text" && (
                <Field label="Text content">
                  <Textarea placeholder="Anything you want — instructions, a message, a serial number…" value={target} onChange={e => setTarget(e.target.value)} />
                </Field>
              )}
              {(type === "phone" || type === "sms") && (
                <Field label={type === "sms" ? "SMS number" : "Phone number"}>
                  <Input icon={type === "sms" ? "message-square" : "phone"} placeholder="+1 (800) 278-7622" value={target} onChange={e => setTarget(e.target.value)} />
                </Field>
              )}
              {type === "email" && (
                <Field label="Email address">
                  <Input icon="mail" placeholder="hello@aurora.co" value={target} onChange={e => setTarget(e.target.value)} />
                </Field>
              )}
              {type === "wifi" && (
                <div className="grid grid-2">
                  <Field label="Network name"><Input placeholder="Aurora Guest" /></Field>
                  <Field label="Password"><Input type="password" placeholder="••••••••" /></Field>
                </div>
              )}
              {type === "vcard" && (
                <div className="grid grid-2">
                  <Field label="Full name"><Input placeholder="Aurora Sasaki" /></Field>
                  <Field label="Title"><Input placeholder="Founder" /></Field>
                  <Field label="Email"><Input placeholder="aurora@aurora.co" /></Field>
                  <Field label="Phone"><Input placeholder="+1 (800) 278-7622" /></Field>
                </div>
              )}
            </div>
          </Card>

          {/* Design */}
          <Card className="card-pad-lg">
            <div className="section-h" style={{ fontSize: 15, marginBottom: 4 }}>Design</div>
            <div className="section-sub">Pattern, finders, colors and an optional logo at the center.</div>

            <Field label="Pattern style" hint="Affects every module except the corner finders.">
              <div className="style-picker">
                {QR_STYLES.map(s => (
                  <div key={s} className={`style-opt ${style === s ? "active" : ""}`} onClick={() => setStyle(s)}>
                    <div className="style-opt-illus">
                      <StyleIllus qrStyle={s} size={36} />
                    </div>
                    <div className="style-opt-label">{s}</div>
                  </div>
                ))}
              </div>
            </Field>

            <Field label="Corner finders" hint="The three big squares — affect scanning reliability." className="mt-4">
              <div className="style-picker" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
                {QR_CORNERS.map(c => (
                  <div key={c} className={`style-opt ${cornerStyle === c ? "active" : ""}`} onClick={() => setCornerStyle(c)}>
                    <div className="style-opt-illus"><CornerMini corner={c} /></div>
                    <div className="style-opt-label">{c.replace("-", " ")}</div>
                  </div>
                ))}
              </div>
            </Field>

            <div className="grid grid-2 mt-4">
              <Field label="Foreground" hint="The dark modules.">
                <div className="swatch-row">
                  {QR_COLORS.map(c => (
                    <div key={c} className={`swatch ${fg === c ? "active" : ""}`} style={{ background: c }} onClick={() => setFg(c)} />
                  ))}
                  <label className={`swatch swatch-picker ${!QR_COLORS.includes(fg) ? "active" : ""}`} title="Custom color">
                    <input type="color" value={fg} onChange={e => setFg(e.target.value)} />
                    <span className="picker-icon"><Icon name="edit" size={11} /></span>
                  </label>
                </div>
                {!QR_COLORS.includes(fg) && (
                  <div style={{ marginTop: 6, fontSize: 11, color: "var(--fg-muted)", fontFamily: "var(--ff-mono)", display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: fg, border: "1px solid var(--border)" }} />
                    {fg.toUpperCase()}
                  </div>
                )}
              </Field>
              <Field label="Background" hint="Keep contrast strong for reliable scanning.">
                <div className="swatch-row">
                  {QR_BG_COLORS.map(c => (
                    <div key={c} className={`swatch ${bg === c ? "active" : ""}`} style={{ background: c }} onClick={() => setBg(c)} />
                  ))}
                  <label className={`swatch swatch-picker ${!QR_BG_COLORS.includes(bg) ? "active" : ""}`} title="Custom color">
                    <input type="color" value={bg} onChange={e => setBg(e.target.value)} />
                    <span className="picker-icon"><Icon name="edit" size={11} /></span>
                  </label>
                </div>
                {!QR_BG_COLORS.includes(bg) && (
                  <div style={{ marginTop: 6, fontSize: 11, color: "var(--fg-muted)", fontFamily: "var(--ff-mono)", display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: bg, border: "1px solid var(--border)" }} />
                    {bg.toUpperCase()}
                  </div>
                )}
              </Field>
            </div>

            <Field label="Center logo" className="mt-4">
              <div className="flex items-center gap-2" style={{ height: 36 }}>
                <Button size="sm" variant={withLogo ? "primary" : "secondary"} icon="image" onClick={() => setWithLogo(!withLogo)}>
                  {withLogo ? "Logo added" : "Add logo"}
                </Button>
                {withLogo && <span className="text-sm muted">aurora-mark.svg · 24×24</span>}
              </div>
            </Field>
          </Card>

          {/* Label */}
          <Card className="card-pad-lg">
            <div className="section-h" style={{ fontSize: 15, marginBottom: 4 }}>Label</div>
            <div className="section-sub">Add text around the QR — "Scan me", a brand name, or a tagline.</div>

            <Field label="Text" hint="Keep it short — under 30 characters reads best." className="mt-4">
              <Input value={labelText} onChange={e => setLabelText(e.target.value)} placeholder="Scan to discover" maxLength={60} />
            </Field>

            <Field label="Position" hint="Where the text sits relative to the QR." className="mt-4">
              <div className="pos-picker">
                {LABEL_POSITIONS.map(p => (
                  <div key={p} className={`style-opt pos-opt ${labelPos === p ? "active" : ""}`} onClick={() => setLabelPos(p)}>
                    <div className="pos-opt-illus"><PositionMini pos={p} /></div>
                    <div className="style-opt-label">{p === "none" ? "Off" : p}</div>
                  </div>
                ))}
              </div>
            </Field>

            <div className="grid grid-2 mt-4">
              <Field label="Tone">
                <Segmented value={labelTone} onChange={v => setLabelTone(v as LabelTone)} options={LABEL_TONES} />
              </Field>
              <Field label="Frame" hint="Outline around the QR + label as one card.">
                <div className="flex items-center gap-2" style={{ height: 36 }}>
                  <Button size="sm" variant={framed ? "primary" : "secondary"} icon={framed ? "check" : "plus"} onClick={() => setFramed(!framed)}>
                    {framed ? "Frame on" : "Add frame"}
                  </Button>
                </div>
              </Field>
            </div>
          </Card>

          {/* Tracking */}
          <Card className="card-pad-lg">
            <div className="section-h" style={{ fontSize: 15, marginBottom: 4 }}>Tracking</div>
            <div className="section-sub">UTM parameters appended to redirects automatically.</div>
            <div className="grid grid-2 mt-4">
              <Field label="UTM campaign"><Input placeholder="summer-drop-2026" /></Field>
              <Field label="UTM source"><Input placeholder="qr-flyer" /></Field>
            </div>
          </Card>
        </div>

        {/* ══ RIGHT — Sticky preview ══ */}
        <div style={{ position: "sticky", top: 28 }}>
          <Card className="card-pad-lg" accent={activated ? "green" : "blue"}>
            <div className="flex items-center justify-between mb-4">
              <div className="strong" style={{ fontSize: 13.5 }}>Live preview</div>
              <Badge tone={activated ? "success" : "neutral"} dot>{activated ? "Active" : "Draft"}</Badge>
            </div>

            <div className="qr-stage"
              data-pos={showLabel ? labelPos : "none"}
              data-tone={labelTone}
              data-frame={framed ? "yes" : "no"}
              style={{ background: bg }}>

              <div className="qr-stage-qr" style={{ background: bg }}>
                {!valid ? (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, color: "var(--fg-subtle)", fontSize: 11.5, textAlign: "center", padding: 16 }}>
                    <Icon name="qr-code" size={28} />
                    <div>Name your QR code<br />to preview it.</div>
                  </div>
                ) : (
                  <>
                    <QrSvg key={renderToken} text={previewText} size={220} fg={fg} bg={bg} style={style} cornerStyle={cornerStyle} logo={withLogo} />
                    <div className={`qr-loading-overlay ${generating ? "active" : ""}`}>
                      <div className="qr-loading-spinner" />
                      <div className="qr-loading-text">Generating…</div>
                    </div>
                  </>
                )}
              </div>

              {showLabel && valid && (
                <div className="qr-stage-label">{labelText}</div>
              )}
            </div>

            <div className="text-sm muted mt-4">
              Destination: <span className="strong">{tm.name}</span>
              {targetForType() && (
                <div style={{ fontFamily: "var(--ff-mono)", fontSize: 11, marginTop: 6, padding: "6px 8px", background: "var(--bg-sunken)", border: "1px solid var(--border-soft)", borderRadius: 6, wordBreak: "break-all" }}>
                  {targetForType()}
                </div>
              )}
            </div>

            {!activated ? (
              <div className="mt-4">
                <Button variant="success" size="lg" icon="zap"
                  disabled={submitting}
                  onClick={handleActivate}
                  style={{ width: "100%" }}>
                  {submitting ? "Activating…" : "Activate QR code"}
                </Button>
                <div className="text-xs muted mt-2" style={{ textAlign: "center" }}>
                  Activate to test, download or share.
                </div>
              </div>
            ) : (
              <div className="col gap-2 mt-4">
                <div className="strong" style={{ fontSize: 12 }}>Scan URL</div>
                <div style={{ fontFamily: "var(--ff-mono)", fontSize: 11, padding: "8px 10px", background: "var(--bg-sunken)", border: "1px solid var(--border)", borderRadius: 6, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {fetcher.data?.ok && fetcher.data.slug ? `${typeof window !== "undefined" ? window.location.origin : ""}/s/${fetcher.data.slug}` : previewText}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => {
                    const url = fetcher.data?.ok && fetcher.data.slug ? `${window.location.origin}/s/${fetcher.data.slug}` : previewText;
                    navigator.clipboard?.writeText(url);
                    toast({ title: "Link copied", type: "info" });
                  }}>
                    <Icon name="copy" size={12} />
                  </Button>
                </div>
                {fetcher.data?.ok && fetcher.data.id && (
                  <div className="grid grid-3 gap-2 mt-2">
                    <a href={`/qr/${fetcher.data.id}/png`} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
                      <Button size="sm" variant="secondary" icon="download" style={{ width: "100%" }}>PNG</Button>
                    </a>
                    <a href={`/qr/${fetcher.data.id}/svg`} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
                      <Button size="sm" variant="secondary" icon="download" style={{ width: "100%" }}>SVG</Button>
                    </a>
                    <a href={`/qr/${fetcher.data.id}/pdf`} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
                      <Button size="sm" variant="secondary" icon="download" style={{ width: "100%" }}>PDF</Button>
                    </a>
                  </div>
                )}
                <Button size="md" variant="primary" icon="eye"
                  style={{ marginTop: 4 }}
                  onClick={() => navigate("/app/qr-manager")}>
                  Go to My QR codes
                </Button>
              </div>
            )}
          </Card>

          <div className="text-xs muted mt-4" style={{ textAlign: "center", padding: "0 12px" }}>
            TrackQr tracks every scan, device and conversion through a unique short URL.
          </div>
        </div>
      </div>
    </>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
