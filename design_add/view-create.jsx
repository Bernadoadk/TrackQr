// view-create.jsx — Create QR code (2-column: form + live preview)

const QR_STYLES = ["square", "rounded", "dot", "classy"];
const QR_CORNERS = ["square", "rounded", "extra-rounded"];
const QR_COLORS = ["#0B1220", "#2563EB", "#7C3AED", "#16A34A", "#D97706", "#DB2777"];
const QR_BG_COLORS = ["#FFFFFF", "#F1F5F9", "#FEF3C7", "#DCFCE7", "#DBEAFE", "#FCE7F3"];
const LABEL_POSITIONS = ["none", "top", "bottom", "left", "right"];
const LABEL_TONES = [
  { value: "default", label: "Default" },
  { value: "brand",   label: "Brand" },
  { value: "mono",    label: "Mono" },
  { value: "muted",   label: "Muted" },
];

/* ══════════════════════ Mini illustrations ══════════════════════ */

// Mini live QR illustration — uses generateQrSvg with the actual style applied.
function QrMini({ style, cornerStyle = "square", fg = "currentColor", bg = "transparent", size = 38 }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current || !window.generateQrSvg) return;
    const svg = window.generateQrSvg("qr style preview seed", {
      size, margin: 1, fg, bg, style, cornerStyle,
    });
    if (svg) ref.current.innerHTML = svg;
  }, [style, cornerStyle, fg, bg, size]);
  return <div ref={ref} className="qr-mini" style={{ width: size, height: size }}></div>;
}

// Corner-finder illustration — the 3-ring finder pattern with the chosen radius
function CornerMini({ corner }) {
  const radius =
    corner === "extra-rounded" ? 11 :
    corner === "rounded"       ? 6  : 0;
  return (
    <svg viewBox="0 0 28 28" width="32" height="32">
      <rect x="1" y="1" width="26" height="26" rx={radius} fill="currentColor" />
      <rect x="5" y="5" width="18" height="18" rx={Math.max(0, radius - 4)} fill="var(--bg-surface)" />
      <rect x="9" y="9" width="10" height="10" rx={Math.max(0, radius - 8)} fill="currentColor" />
    </svg>
  );
}

// Position picker illustration — QR + text bars
function PositionMini({ pos }) {
  const qrRect = <rect x="11" y="11" width="14" height="14" rx="1.6" fill="currentColor" />;
  const line = (x, y, w, h = 1.4) =>
    <rect x={x} y={y} width={w} height={h} rx="0.7" fill="currentColor" />;
  return (
    <svg viewBox="0 0 36 36" width="40" height="40">
      {qrRect}
      {pos === "top" && (<>
        {line(6,  4, 24)}
        {line(10, 7, 16)}
      </>)}
      {pos === "bottom" && (<>
        {line(10, 28, 16)}
        {line(6,  31, 24)}
      </>)}
      {pos === "left" && (<>
        {line(1, 14, 7)}
        {line(1, 17, 7)}
        {line(1, 20, 5)}
      </>)}
      {pos === "right" && (<>
        {line(28, 14, 7)}
        {line(28, 17, 7)}
        {line(30, 20, 5)}
      </>)}
      {pos === "none" && (
        <g opacity="0.35">
          <line x1="6"  y1="6"  x2="30" y2="30" stroke="currentColor" strokeWidth="0.8" strokeDasharray="2 2" />
        </g>
      )}
    </svg>
  );
}

/* ══════════════════════ View ══════════════════════ */

function ViewCreate({ onNavigate }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState("product");
  const [target, setTarget] = useState("");

  // Design
  const [style, setStyle] = useState("rounded");
  const [cornerStyle, setCornerStyle] = useState("rounded");
  const [fg, setFg] = useState("#0B1220");
  const [bg, setBg] = useState("#FFFFFF");
  const [withLogo, setWithLogo] = useState(false);

  // Label (replaces old frame+caption)
  const [labelText, setLabelText] = useState("Scan to discover");
  const [labelPos, setLabelPos] = useState("bottom");
  const [labelTone, setLabelTone] = useState("default");
  const [framed, setFramed] = useState(false);

  const [activated, setActivated] = useState(false);

  // Debounced loader for the live preview
  const [generating, setGenerating] = useState(false);
  // Bumps when any QR-affecting param changes — used as a `key` to force remount + replay pop animation
  const [renderToken, setRenderToken] = useState(0);
  useEffect(() => {
    setGenerating(true);
    const t = setTimeout(() => {
      setGenerating(false);
      setRenderToken(k => k + 1);
    }, 380);
    return () => clearTimeout(t);
  }, [style, cornerStyle, fg, bg, withLogo, name, type, target, activated]);

  const tm = typeMeta(type);

  const targetForType = () => {
    if (type === "product") return target || "Aurora Tee — Stone Wash";
    if (type === "promo") return target || "FREESHIP";
    if (type === "wifi") return target || "Aurora Guest";
    if (type === "phone" || type === "sms") return target || "+1 (800) 278-7622";
    if (type === "email") return target || "hello@aurora.co";
    return target || tm.url || "https://aurora.co";
  };

  const previewText = activated
    ? `https://qrflow.app/scan/${(name || "untitled").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
    : (name ? `${name} · ${targetForType()}` : "QR Flow placeholder");

  const valid = name.trim().length > 0;
  const showLabel = labelText && labelPos !== "none";

  return (
    <>
      <div className="page-head">
        <div className="page-head-left">
          <Button size="sm" variant="ghost" icon="chevron-left" onClick={() => onNavigate("dashboard")} style={{ marginBottom: 8, marginLeft: -10 }}>
            Back to dashboard
          </Button>
          <h1 className="page-h1">Create a <span className="em">QR code</span></h1>
          <div className="page-sub">Configure the destination, customize the design, add a label, activate when ready.</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 24, alignItems: "start" }}>
        {/* LEFT — Form */}
        <div className="col gap-4">
          {/* Basics */}
          <Card className="card-pad-lg">
            <div className="section-h" style={{ fontSize: 15, marginBottom: 4 }}>Basics</div>
            <div className="section-sub">Internal label and notes — only visible to your team.</div>
            <div className="grid grid-2 mt-4">
              <Field label="QR code name" required hint="e.g. ‘Summer drop · Hero banner’">
                <Input placeholder="Untitled QR code" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Description" hint="Optional — visible in My QR codes">
                <Input placeholder="Add a description" value={description} onChange={(e) => setDescription(e.target.value)} />
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
                <div key={t.id} className={`tile ${type === t.id ? "active" : ""}`} onClick={() => { setType(t.id); setActivated(false); }}>
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
                <div key={t.id} className={`tile ${type === t.id ? "active" : ""}`} onClick={() => { setType(t.id); setActivated(false); }}>
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
                <Field label="Text content"><Textarea placeholder="Anything you want — instructions, a message, a serial number…" value={target} onChange={e => setTarget(e.target.value)} /></Field>
              )}
              {(type === "phone" || type === "sms") && (
                <Field label={type === "sms" ? "SMS number" : "Phone number"}>
                  <Input icon={type === "sms" ? "message-square" : "phone"} placeholder="+1 (800) 278-7622" value={target} onChange={e => setTarget(e.target.value)} />
                </Field>
              )}
              {type === "email" && (
                <Field label="Email address"><Input icon="mail" placeholder="hello@aurora.co" value={target} onChange={e => setTarget(e.target.value)} /></Field>
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

            {/* Pattern style */}
            <Field label="Pattern style" hint="Affects every module except the corner finders.">
              <div className="style-picker">
                {QR_STYLES.map(s => (
                  <div key={s}
                       className={`style-opt ${style === s ? "active" : ""}`}
                       onClick={() => setStyle(s)}>
                    <div className="style-opt-illus">
                      <QrMini style={s} cornerStyle="square" fg="currentColor" size={38} />
                    </div>
                    <div className="style-opt-label">{s}</div>
                  </div>
                ))}
              </div>
            </Field>

            {/* Corner style */}
            <Field label="Corner finders" hint="The three big squares — affect scanning reliability." className="mt-4">
              <div className="style-picker" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
                {QR_CORNERS.map(c => (
                  <div key={c}
                       className={`style-opt ${cornerStyle === c ? "active" : ""}`}
                       onClick={() => setCornerStyle(c)}>
                    <div className="style-opt-illus">
                      <CornerMini corner={c} />
                    </div>
                    <div className="style-opt-label">{c.replace("-", " ")}</div>
                  </div>
                ))}
              </div>
            </Field>

            <div className="grid grid-2 mt-4">
              <Field label="Foreground" hint="The dark modules.">
                <div className="swatch-row">
                  {QR_COLORS.map(c => (
                    <div key={c} className={`swatch ${fg === c ? "active" : ""}`} style={{ background: c }} onClick={() => setFg(c)}></div>
                  ))}
                </div>
              </Field>
              <Field label="Background" hint="Keep contrast strong for reliable scanning.">
                <div className="swatch-row">
                  {QR_BG_COLORS.map(c => (
                    <div key={c} className={`swatch ${bg === c ? "active" : ""}`} style={{ background: c }} onClick={() => setBg(c)}></div>
                  ))}
                </div>
              </Field>
            </div>

            <Field label="Center logo" className="mt-4">
              <div className="flex gap-2 items-center" style={{ height: 36 }}>
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
                  <div key={p}
                       className={`style-opt pos-opt ${labelPos === p ? "active" : ""}`}
                       onClick={() => setLabelPos(p)}>
                    <div className="pos-opt-illus"><PositionMini pos={p} /></div>
                    <div className="style-opt-label">{p === "none" ? "Off" : p}</div>
                  </div>
                ))}
              </div>
            </Field>

            <div className="grid grid-2 mt-4">
              <Field label="Tone">
                <Segmented
                  value={labelTone}
                  onChange={setLabelTone}
                  options={LABEL_TONES.map(t => ({ value: t.value, label: t.label }))}
                />
              </Field>
              <Field label="Frame" hint="Outline around the QR + label as one card.">
                <div className="flex gap-2 items-center" style={{ height: 36 }}>
                  <Button size="sm" variant={framed ? "primary" : "secondary"} icon={framed ? "check" : "plus"}
                          onClick={() => setFramed(!framed)}>
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

        {/* RIGHT — Sticky preview */}
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
                  <div style={{
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
                    color: "var(--fg-subtle)", fontSize: 11.5, textAlign: "center", padding: 16,
                  }}>
                    <Icon name="qr-code" size={28} />
                    <div>Name your QR code<br/>to preview it.</div>
                  </div>
                ) : (
                  <>
                    <QrSvg
                      key={renderToken}
                      text={previewText}
                      size={220}
                      fg={fg}
                      bg={bg}
                      style={style}
                      cornerStyle={cornerStyle}
                      logo={withLogo ? fg : null}
                    />
                    <div className={`qr-loading-overlay ${generating ? "active" : ""}`}>
                      <div className="qr-loading-spinner"></div>
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
                <div style={{
                  fontFamily: "var(--ff-mono)",
                  fontSize: 11,
                  marginTop: 6,
                  padding: "6px 8px",
                  background: "var(--bg-sunken)",
                  border: "1px solid var(--border-soft)",
                  borderRadius: 6,
                  wordBreak: "break-all",
                }}>{targetForType()}</div>
              )}
            </div>

            {!activated ? (
              <div className="mt-4">
                <Button variant="success" size="lg" icon="zap"
                        onClick={() => {
                          if (!valid) return toast({ tone: "error", title: "Add a name first", desc: "QR code name is required to activate." });
                          setActivated(true);
                          toast({ title: "QR code activated", desc: "A scan URL has been generated." });
                        }}
                        style={{ width: "100%" }}>
                  Activate QR code
                </Button>
                <div className="text-xs muted mt-2" style={{ textAlign: "center" }}>
                  Activate to test, download or share.
                </div>
              </div>
            ) : (
              <div className="col gap-2 mt-4">
                <div className="strong" style={{ fontSize: 12 }}>Scan URL</div>
                <div style={{
                  fontFamily: "var(--ff-mono)",
                  fontSize: 11,
                  padding: "8px 10px",
                  background: "var(--bg-sunken)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  display: "flex", alignItems: "center", gap: 8,
                }}>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{previewText}</span>
                  <Button size="sm" variant="ghost" onClick={() => toast({ title: "Link copied", tone: "info" })}><Icon name="copy" size={12} /></Button>
                </div>

                <div className="grid grid-3 gap-2 mt-2">
                  <Button size="sm" variant="secondary" icon="download" onClick={() => toast({ title: "PNG downloaded" })}>PNG</Button>
                  <Button size="sm" variant="secondary" icon="download" onClick={() => toast({ title: "SVG downloaded" })}>SVG</Button>
                  <Button size="sm" variant="secondary" icon="download" onClick={() => toast({ title: "PDF downloaded" })}>PDF</Button>
                </div>
                <Button size="md" variant="primary" icon="eye" onClick={() => onNavigate("scan-preview")} style={{ marginTop: 4 }}>Test scan</Button>
              </div>
            )}
          </Card>

          <div className="text-xs muted mt-4" style={{ textAlign: "center", padding: "0 12px" }}>
            QR Flow tracks every scan, device and conversion through a unique short URL.
          </div>
        </div>
      </div>
    </>
  );
}

window.ViewCreate = ViewCreate;
