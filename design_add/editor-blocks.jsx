// editor-blocks.jsx — Per-block previews, field editors, defaults.
// Each block type has: { defaults, layout, Preview, Fields }
// BLOCK_TYPES is the registry used by the editor shell.

/* ───────────────────── Helpers ───────────────────── */

const ALIGN_OPTS = [
  { value: "left",   label: "L", icon: null },
  { value: "center", label: "C", icon: null },
  { value: "right",  label: "R", icon: null },
];

const PADDING_OPTS = [
  { value: "sm", label: "S" },
  { value: "md", label: "M" },
  { value: "lg", label: "L" },
];

const BG_OPTS = [
  { value: "surface",    label: "Default", swatch: "var(--bg-surface)",  border: "var(--border)" },
  { value: "sunken",     label: "Sunken",  swatch: "var(--bg-sunken)",   border: "var(--border)" },
  { value: "brand-soft", label: "Brand",   swatch: "var(--accent-soft)", border: "var(--accent-border)" },
  { value: "brand",      label: "Solid",   swatch: "var(--accent)",      border: "var(--accent)" },
  { value: "dark",       label: "Dark",    swatch: "var(--fg-strong)",   border: "var(--fg-strong)" },
];

// Themed blocks have their own complete visual treatment — layout overrides don't apply visibly.
const THEMED_BLOCKS = new Set(["hero", "timer", "products", "promo", "capture"]);

function uid(prefix = "b") {
  return prefix + Math.random().toString(36).slice(2, 8);
}

/* ───────────────────── Stars ───────────────────── */
function Stars({ value = 5, size = 14 }) {
  const stars = [];
  for (let i = 0; i < 5; i++) {
    stars.push(
      <svg key={i} viewBox="0 0 24 24" width={size} height={size}
        fill={i < value ? "currentColor" : "transparent"}
        stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
      </svg>
    );
  }
  return <span style={{ display: "inline-flex", gap: 1 }}>{stars}</span>;
}

/* ───────────────────── Repeater control ───────────────────── */
function Repeater({ items, onChange, addLabel, render, defaultItem }) {
  const set = (i, key, value) => {
    const next = items.map((it, idx) => idx === i ? { ...it, [key]: value } : it);
    onChange(next);
  };
  const remove = (i) => onChange(items.filter((_, idx) => idx !== i));
  const add = () => onChange([...items, { ...defaultItem }]);
  return (
    <div>
      {items.map((it, i) => (
        <div key={i} className="prop-repeater-item">
          <div className="prop-repeater-head">
            <span className="prop-repeater-num">Item {i + 1}</span>
            <button className="prop-repeater-remove"
              onClick={() => remove(i)}
              disabled={items.length <= 1}
              title="Remove">
              <Icon name="trash" size={11} />
            </button>
          </div>
          {render(it, (k, v) => set(i, k, v))}
        </div>
      ))}
      <button className="prop-repeater-add" onClick={add}>
        <Icon name="plus" size={12} /> {addLabel}
      </button>
    </div>
  );
}

/* ═════════════════════════ Block previews ═════════════════════════ */

function HeroPreview({ p }) {
  return (
    <div className="lp-hero">
      <Badge tone="brand" style={{ marginBottom: 14 }}><span className="dot"></span>{p.eyebrow || "Limited time"}</Badge>
      <h1>{p.title}</h1>
      {p.subtitle && <p>{p.subtitle}</p>}
      <Button variant="primary" size="lg">{p.cta} <Icon name="arrow-right" /></Button>
    </div>
  );
}

function TimerPreview({ p }) {
  const parts = (p.endsIn || "00 · 00 · 00 · 00").split("·").map(s => s.trim());
  const labels = ["Days", "Hours", "Min", "Sec"];
  return (
    <div>
      {p.label && (
        <div className="text-xs muted" style={{
          textAlign: "center", padding: "16px 16px 0",
          fontFamily: "var(--ff-mono)", textTransform: "uppercase",
          letterSpacing: ".1em", fontSize: 10.5,
        }}>{p.label}</div>
      )}
      <div className="lp-timer">
        {parts.map((part, i) => (
          <div key={i} className="lp-timer-unit">
            <div className="lp-timer-num">{part}</div>
            <div className="lp-timer-lbl">{labels[i]}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProductsPreview({ p }) {
  const names = ["Aurora Tee", "Stone Hoodie", "Drift Cap", "Pace Tote", "Linen Shirt", "Wool Beanie"];
  const prices = ["$48.00", "$128.00", "$36.00", "$58.00", "$92.00", "$28.00"];
  const cols = Math.min(p.count || 3, 4);
  return (
    <div>
      <div style={{ padding: "16px 24px 12px", fontFamily: "var(--ff-display)", fontWeight: 600, fontSize: 16, letterSpacing: "-0.012em" }}>{p.title}</div>
      <div className="lp-products" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {Array.from({ length: p.count || 3 }, (_, i) => (
          <div key={i} className="lp-product">
            <div className="lp-product-img"><Icon name="image" size={24} /></div>
            <div className="lp-product-info">
              <div className="lp-product-name">{names[i % names.length]}</div>
              <div className="lp-product-price">{prices[i % prices.length]}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CapturePreview({ p }) {
  return (
    <div className="lp-capture">
      <h3>{p.title}</h3>
      {p.subtitle && <p>{p.subtitle}</p>}
      <div className="lp-capture-form">
        <Input placeholder={p.placeholder || "you@email.com"} />
        <Button variant="primary">{p.cta || "Notify me"}</Button>
      </div>
    </div>
  );
}

function PromoPreview({ p }) {
  return (
    <div className="lp-promo">
      <div className="text-xs strong" style={{
        fontFamily: "var(--ff-mono)", textTransform: "uppercase",
        letterSpacing: ".08em", marginBottom: 6, color: "var(--amber-fg)",
      }}>{p.eyebrow || "Use code"}</div>
      <div className="lp-promo-code">{p.code}</div>
      <div className="text-sm" style={{ marginTop: 6 }}>{p.title}</div>
    </div>
  );
}

function TextPreview({ p, layout }) {
  return (
    <div className="lp-text block-content" data-align={layout?.align || "left"}>
      {p.heading && <h2>{p.heading}</h2>}
      {p.body && <p>{p.body}</p>}
    </div>
  );
}

function ButtonPreview({ p, layout }) {
  return (
    <div className="lp-button-block block-content" data-align={layout?.align || "center"}>
      <Button variant={p.variant || "primary"} size="lg"
        iconRight={p.icon ? "arrow-right" : null}>
        {p.label || "Click me"}
      </Button>
    </div>
  );
}

function ImagePreview({ p }) {
  return (
    <div className="lp-image block-content">
      <div className="lp-image-frame" data-aspect={p.aspect || "16:9"}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, position: "relative" }}>
          <Icon name="image" size={36} />
          <div style={{ fontSize: 10.5, fontFamily: "var(--ff-mono)", textTransform: "uppercase", letterSpacing: ".08em" }}>
            {p.aspect || "16:9"} · placeholder
          </div>
        </div>
      </div>
      {p.caption && <div className="lp-image-caption">{p.caption}</div>}
    </div>
  );
}

function VideoPreview({ p }) {
  return (
    <div className="lp-video block-content">
      {p.title && (
        <div className="lp-video-title">
          <Icon name="video" size={13} /> {p.title}
        </div>
      )}
      <div className="lp-video-frame">
        <div className="lp-video-play">
          <Icon name="play" size={20} />
        </div>
      </div>
    </div>
  );
}

function ReviewsPreview({ p, layout }) {
  const avg = (p.items || []).reduce((s, r) => s + (r.rating || 5), 0) / Math.max((p.items || []).length, 1);
  return (
    <div className="lp-reviews block-content" data-align={layout?.align || "center"}>
      <div className="lp-reviews-head">
        <h2>{p.title || "What customers say"}</h2>
        <div className="lp-reviews-rating">
          <span className="lp-reviews-stars"><Stars value={Math.round(avg)} /></span>
          <span>{avg.toFixed(1)} · {(p.items || []).length} reviews</span>
        </div>
      </div>
      <div className="lp-reviews-grid" style={{ gridTemplateColumns: `repeat(${Math.min((p.items || []).length, 3)}, 1fr)` }}>
        {(p.items || []).slice(0, 3).map((r, i) => (
          <div key={i} className="lp-review-card">
            <div className="stars"><Stars value={r.rating || 5} size={12} /></div>
            <p>"{r.text}"</p>
            <div className="name">— {r.name}{r.verified && <span className="verified">✓ Verified</span>}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FaqPreview({ p }) {
  return (
    <div className="lp-faq block-content">
      {p.title && <h2>{p.title}</h2>}
      {(p.items || []).map((it, i) => (
        <div key={i} className="lp-faq-item">
          <div className="lp-faq-q">
            <span>{it.q}</span>
            <Icon name="chevron-down" size={14} />
          </div>
          {(p.expanded || i === 0) && it.a && <div className="lp-faq-a">{it.a}</div>}
        </div>
      ))}
    </div>
  );
}

function UrgencyPreview({ p }) {
  const iconName = p.icon || "alert-triangle";
  return (
    <div className="lp-urgency block-content" data-tone={p.tone || "danger"}>
      <Icon name={iconName} size={15} />
      <span><b>{p.label || "Hurry"}</b> · {p.message}</span>
    </div>
  );
}

function QrPreview({ p }) {
  const svgRef = useRef(null);
  useEffect(() => {
    if (!svgRef.current || !window.generateQrSvg) return;
    const svg = window.generateQrSvg(p.data || "https://qrflow.app", {
      size: 220, margin: 4, fg: "#0B1220", bg: "#FFFFFF",
      style: "rounded", cornerStyle: "rounded",
    });
    if (svg) svgRef.current.innerHTML = svg;
  }, [p.data]);
  return (
    <div className="lp-qr-block block-content">
      <h3>{p.title || "Scan to continue"}</h3>
      {p.subtitle && <div className="sub">{p.subtitle}</div>}
      <div className="lp-qr-block-canvas" data-size={p.size || "md"} ref={svgRef}></div>
    </div>
  );
}

/* ═════════════════════════ Block field editors ═════════════════════════ */

function HeroFields({ p, set }) {
  return (
    <>
      <Field label="Eyebrow"><Input value={p.eyebrow || ""} onChange={e => set("eyebrow", e.target.value)} placeholder="Limited time" /></Field>
      <Field label="Title" required><Input value={p.title} onChange={e => set("title", e.target.value)} /></Field>
      <Field label="Subtitle"><Textarea value={p.subtitle || ""} onChange={e => set("subtitle", e.target.value)} rows="2" /></Field>
      <Field label="Call to action"><Input value={p.cta} onChange={e => set("cta", e.target.value)} /></Field>
    </>
  );
}

function TimerFields({ p, set }) {
  return (
    <>
      <Field label="Label (optional)"><Input value={p.label || ""} onChange={e => set("label", e.target.value)} placeholder="Drop ends in" /></Field>
      <Field label="Ends in" hint="DD · HH · MM · SS">
        <Input value={p.endsIn} onChange={e => set("endsIn", e.target.value)} placeholder="01 · 14 · 32 · 06" />
      </Field>
    </>
  );
}

function ProductsFields({ p, set }) {
  return (
    <>
      <Field label="Section title"><Input value={p.title} onChange={e => set("title", e.target.value)} /></Field>
      <Field label="Number of products">
        <Select value={p.count} onChange={e => set("count", +e.target.value)}>
          <option value={2}>2 products</option>
          <option value={3}>3 products</option>
          <option value={4}>4 products</option>
          <option value={6}>6 products</option>
        </Select>
      </Field>
      <Field label="Collection" hint="Pulls live from your Shopify store">
        <Select value={p.collection || "featured"} onChange={e => set("collection", e.target.value)}>
          <option value="featured">Featured</option>
          <option value="bestsellers">Bestsellers</option>
          <option value="new">New arrivals</option>
          <option value="sale">On sale</option>
          <option value="custom">Custom selection…</option>
        </Select>
      </Field>
    </>
  );
}

function CaptureFields({ p, set }) {
  return (
    <>
      <Field label="Title"><Input value={p.title} onChange={e => set("title", e.target.value)} /></Field>
      <Field label="Subtitle"><Input value={p.subtitle || ""} onChange={e => set("subtitle", e.target.value)} /></Field>
      <Field label="Placeholder"><Input value={p.placeholder || ""} onChange={e => set("placeholder", e.target.value)} placeholder="you@email.com" /></Field>
      <Field label="Button label"><Input value={p.cta || ""} onChange={e => set("cta", e.target.value)} placeholder="Notify me" /></Field>
      <Field label="Send leads to">
        <Select value={p.destination || "db"} onChange={e => set("destination", e.target.value)}>
          <option value="db">QR Flow database</option>
          <option value="klaviyo">Klaviyo</option>
          <option value="mailchimp">Mailchimp</option>
          <option value="hubspot">HubSpot</option>
          <option value="csv">CSV export only</option>
        </Select>
      </Field>
    </>
  );
}

function PromoFields({ p, set }) {
  return (
    <>
      <Field label="Eyebrow"><Input value={p.eyebrow || ""} onChange={e => set("eyebrow", e.target.value)} placeholder="Use code" /></Field>
      <Field label="Discount code"><Input value={p.code} onChange={e => set("code", e.target.value)} style={{ fontFamily: "var(--ff-mono)", letterSpacing: "0.04em" }} /></Field>
      <Field label="Description"><Input value={p.title} onChange={e => set("title", e.target.value)} /></Field>
      <Field label="Auto-apply at checkout">
        <Select value={p.autoApply ? "on" : "off"} onChange={e => set("autoApply", e.target.value === "on")}>
          <option value="on">Yes — apply automatically</option>
          <option value="off">No — visitor must enter manually</option>
        </Select>
      </Field>
    </>
  );
}

function TextFields({ p, set }) {
  return (
    <>
      <Field label="Heading"><Input value={p.heading || ""} onChange={e => set("heading", e.target.value)} /></Field>
      <Field label="Body" hint="Plain text — line breaks preserved.">
        <Textarea value={p.body || ""} onChange={e => set("body", e.target.value)} rows="4" />
      </Field>
    </>
  );
}

function ButtonFields({ p, set }) {
  return (
    <>
      <Field label="Label"><Input value={p.label} onChange={e => set("label", e.target.value)} /></Field>
      <Field label="URL"><Input value={p.href || ""} onChange={e => set("href", e.target.value)} placeholder="https://" icon="link" /></Field>
      <Field label="Style">
        <Select value={p.variant || "primary"} onChange={e => set("variant", e.target.value)}>
          <option value="primary">Primary (filled)</option>
          <option value="secondary">Secondary (outline)</option>
          <option value="outline">Outline (light)</option>
          <option value="ghost">Ghost (text only)</option>
        </Select>
      </Field>
      <div className="prop-row prop-row-h">
        <label>Show arrow icon</label>
        <EditorToggle on={!!p.icon} onChange={v => set("icon", v)} />
      </div>
    </>
  );
}

function ImageFields({ p, set }) {
  return (
    <>
      <Field label="Source"
        hint="Drop a file here or paste a URL. Placeholder shown while empty.">
        <Input value={p.src || ""} onChange={e => set("src", e.target.value)} placeholder="image.jpg or https://…" icon="image" />
      </Field>
      <Field label="Aspect ratio">
        <Segmented
          value={p.aspect || "16:9"}
          onChange={v => set("aspect", v)}
          options={[
            { value: "16:9", label: "16:9" },
            { value: "1:1",  label: "1:1" },
            { value: "4:5",  label: "4:5" },
            { value: "3:1",  label: "Wide" },
          ]}
        />
      </Field>
      <Field label="Caption (optional)"><Input value={p.caption || ""} onChange={e => set("caption", e.target.value)} /></Field>
      <Field label="Alt text" hint="Important for accessibility & SEO."><Input value={p.alt || ""} onChange={e => set("alt", e.target.value)} /></Field>
    </>
  );
}

function VideoFields({ p, set }) {
  return (
    <>
      <Field label="Title (optional)"><Input value={p.title || ""} onChange={e => set("title", e.target.value)} placeholder="Watch the drop" /></Field>
      <Field label="Video URL" hint="YouTube, Vimeo, or direct mp4.">
        <Input value={p.src || ""} onChange={e => set("src", e.target.value)} placeholder="https://youtube.com/..." icon="link" />
      </Field>
      <div className="prop-row prop-row-h">
        <label>Autoplay (muted)</label>
        <EditorToggle on={!!p.autoplay} onChange={v => set("autoplay", v)} />
      </div>
      <div className="prop-row prop-row-h">
        <label>Show controls</label>
        <EditorToggle on={p.controls !== false} onChange={v => set("controls", v)} />
      </div>
    </>
  );
}

function ReviewsFields({ p, set }) {
  return (
    <>
      <Field label="Section title"><Input value={p.title || ""} onChange={e => set("title", e.target.value)} /></Field>
      <Field label="Reviews">
        <Repeater
          items={p.items || []}
          onChange={items => set("items", items)}
          addLabel="Add review"
          defaultItem={{ name: "Anna L.", rating: 5, text: "Loved it. Fits perfectly.", verified: true }}
          render={(it, setKey) => (
            <>
              <div className="prop-row">
                <label>Name</label>
                <Input value={it.name} onChange={e => setKey("name", e.target.value)} />
              </div>
              <div className="prop-row">
                <label>Rating</label>
                <Select value={it.rating} onChange={e => setKey("rating", +e.target.value)}>
                  <option value={5}>★★★★★</option>
                  <option value={4}>★★★★☆</option>
                  <option value={3}>★★★☆☆</option>
                  <option value={2}>★★☆☆☆</option>
                  <option value={1}>★☆☆☆☆</option>
                </Select>
              </div>
              <div className="prop-row">
                <label>Quote</label>
                <Textarea value={it.text} onChange={e => setKey("text", e.target.value)} rows="2" />
              </div>
              <div className="prop-row prop-row-h">
                <label>Verified buyer</label>
                <EditorToggle on={!!it.verified} onChange={v => setKey("verified", v)} />
              </div>
            </>
          )}
        />
      </Field>
    </>
  );
}

function FaqFields({ p, set }) {
  return (
    <>
      <Field label="Section title"><Input value={p.title || ""} onChange={e => set("title", e.target.value)} /></Field>
      <div className="prop-row prop-row-h">
        <label>Expand all by default</label>
        <EditorToggle on={!!p.expanded} onChange={v => set("expanded", v)} />
      </div>
      <Field label="Questions">
        <Repeater
          items={p.items || []}
          onChange={items => set("items", items)}
          addLabel="Add question"
          defaultItem={{ q: "New question?", a: "Helpful answer here." }}
          render={(it, setKey) => (
            <>
              <div className="prop-row">
                <label>Question</label>
                <Input value={it.q} onChange={e => setKey("q", e.target.value)} />
              </div>
              <div className="prop-row">
                <label>Answer</label>
                <Textarea value={it.a} onChange={e => setKey("a", e.target.value)} rows="2" />
              </div>
            </>
          )}
        />
      </Field>
    </>
  );
}

function UrgencyFields({ p, set }) {
  return (
    <>
      <Field label="Prefix"><Input value={p.label || ""} onChange={e => set("label", e.target.value)} placeholder="Hurry" /></Field>
      <Field label="Message"><Input value={p.message || ""} onChange={e => set("message", e.target.value)} /></Field>
      <Field label="Tone">
        <Select value={p.tone || "danger"} onChange={e => set("tone", e.target.value)}>
          <option value="danger">Red · Danger</option>
          <option value="warning">Amber · Warning</option>
          <option value="info">Blue · Info</option>
          <option value="dark">Dark · Neutral</option>
        </Select>
      </Field>
      <Field label="Icon">
        <Select value={p.icon || "alert-triangle"} onChange={e => set("icon", e.target.value)}>
          <option value="alert-triangle">Warning triangle</option>
          <option value="clock">Clock</option>
          <option value="zap">Lightning</option>
          <option value="bell">Bell</option>
          <option value="info">Info</option>
        </Select>
      </Field>
    </>
  );
}

function QrFields({ p, set }) {
  return (
    <>
      <Field label="Title"><Input value={p.title || ""} onChange={e => set("title", e.target.value)} /></Field>
      <Field label="Subtitle"><Input value={p.subtitle || ""} onChange={e => set("subtitle", e.target.value)} /></Field>
      <Field label="Encodes" hint="URL or text the QR points to.">
        <Input value={p.data || ""} onChange={e => set("data", e.target.value)} placeholder="https://" icon="link" />
      </Field>
      <Field label="Size">
        <Segmented
          value={p.size || "md"}
          onChange={v => set("size", v)}
          options={[
            { value: "sm", label: "Small" },
            { value: "md", label: "Medium" },
            { value: "lg", label: "Large" },
          ]}
        />
      </Field>
    </>
  );
}

/* ═════════════════════════ Toggle (used inside Fields) ═════════════════════════ */
function EditorToggle({ on, onChange }) {
  return (
    <div
      onClick={() => onChange(!on)}
      style={{
        width: 32, height: 18,
        background: on ? "var(--accent)" : "var(--border-strong)",
        borderRadius: 9,
        position: "relative",
        transition: "all .14s var(--ease)",
        cursor: "default",
        flexShrink: 0,
      }}>
      <div style={{
        position: "absolute",
        top: 2, left: on ? 16 : 2,
        width: 14, height: 14,
        background: "#fff",
        borderRadius: "50%",
        transition: "all .14s var(--ease)",
        boxShadow: "0 1px 2px rgba(0,0,0,0.25)",
      }}></div>
    </div>
  );
}

/* ═════════════════════════ BLOCK_TYPES registry ═════════════════════════ */

const BLOCK_TYPES = {
  hero: {
    defaults: () => ({ eyebrow: "Limited time", title: "Limited drop · 24 hours only", subtitle: "Aurora's spring collection — exclusive scan-to-shop access.", cta: "Shop the drop" }),
    layout:   () => ({ padding: "lg", align: "center", bg: "dark" }),
    Preview:  HeroPreview,
    Fields:   HeroFields,
  },
  timer: {
    defaults: () => ({ label: "Drop ends in", endsIn: "01 · 14 · 32 · 06" }),
    layout:   () => ({ padding: "md", align: "center", bg: "sunken" }),
    Preview:  TimerPreview,
    Fields:   TimerFields,
  },
  products: {
    defaults: () => ({ title: "Featured pieces", count: 3, collection: "featured" }),
    layout:   () => ({ padding: "md", align: "left", bg: "surface" }),
    Preview:  ProductsPreview,
    Fields:   ProductsFields,
  },
  capture: {
    defaults: () => ({ title: "Get early access", subtitle: "Drop your email — we'll text you when it's live.", placeholder: "you@email.com", cta: "Notify me", destination: "db" }),
    layout:   () => ({ padding: "md", align: "center", bg: "sunken" }),
    Preview:  CapturePreview,
    Fields:   CaptureFields,
  },
  promo: {
    defaults: () => ({ eyebrow: "Use code", code: "AURORA15", title: "15% off your first order", autoApply: true }),
    layout:   () => ({ padding: "md", align: "center", bg: "surface" }),
    Preview:  PromoPreview,
    Fields:   PromoFields,
  },
  text: {
    defaults: () => ({ heading: "Why this drop is different", body: "Hand-cut, hand-stitched, made in batches of 200. When they're gone, they're gone — and the next drop won't look like this one." }),
    layout:   () => ({ padding: "md", align: "left", bg: "surface" }),
    Preview:  TextPreview,
    Fields:   TextFields,
  },
  button: {
    defaults: () => ({ label: "Shop the collection", href: "https://", variant: "primary", icon: true }),
    layout:   () => ({ padding: "sm", align: "center", bg: "surface" }),
    Preview:  ButtonPreview,
    Fields:   ButtonFields,
  },
  image: {
    defaults: () => ({ src: "", aspect: "16:9", caption: "", alt: "" }),
    layout:   () => ({ padding: "md", align: "center", bg: "surface" }),
    Preview:  ImagePreview,
    Fields:   ImageFields,
  },
  video: {
    defaults: () => ({ title: "Watch the drop", src: "", autoplay: false, controls: true }),
    layout:   () => ({ padding: "md", align: "center", bg: "surface" }),
    Preview:  VideoPreview,
    Fields:   VideoFields,
  },
  reviews: {
    defaults: () => ({
      title: "What customers say",
      items: [
        { name: "Anna L.", rating: 5, text: "Fits like a glove. Better quality than I expected.", verified: true },
        { name: "Marcus T.", rating: 5, text: "The fabric is unreal. Already ordered a second one.", verified: true },
        { name: "Priya S.", rating: 4, text: "Beautiful piece. Shipping took a little while.", verified: false },
      ],
    }),
    layout:   () => ({ padding: "md", align: "center", bg: "sunken" }),
    Preview:  ReviewsPreview,
    Fields:   ReviewsFields,
  },
  faq: {
    defaults: () => ({
      title: "Questions, answered",
      expanded: false,
      items: [
        { q: "When will my order ship?", a: "Within 2 business days. You'll get tracking by email." },
        { q: "What's the return policy?", a: "30 days, no questions asked. Items must be unworn." },
        { q: "Do you ship internationally?", a: "Yes — to 40+ countries. Duties calculated at checkout." },
      ],
    }),
    layout:   () => ({ padding: "md", align: "left", bg: "surface" }),
    Preview:  FaqPreview,
    Fields:   FaqFields,
  },
  urgency: {
    defaults: () => ({ label: "Only 14 left", message: "Once they're gone, they're gone.", tone: "danger", icon: "alert-triangle" }),
    layout:   () => ({ padding: "sm", align: "center", bg: "surface" }),
    Preview:  UrgencyPreview,
    Fields:   UrgencyFields,
  },
  qr: {
    defaults: () => ({ title: "Scan to continue", subtitle: "Open this page on your phone to shop.", data: "https://qrflow.app/c/aurora/spring", size: "md" }),
    layout:   () => ({ padding: "md", align: "center", bg: "sunken" }),
    Preview:  QrPreview,
    Fields:   QrFields,
  },
};

function makeBlock(type) {
  const def = BLOCK_TYPES[type];
  if (!def) return null;
  return {
    id: uid(),
    type,
    props: def.defaults(),
    layout: def.layout(),
    visibility: { mobile: true, desktop: true },
  };
}

Object.assign(window, {
  BLOCK_TYPES,
  THEMED_BLOCKS,
  ALIGN_OPTS, PADDING_OPTS, BG_OPTS,
  Repeater, EditorToggle, Stars,
  makeBlock, uid,
});
