// view-public.jsx — Scan interstitial + Campaign landing (public)

function ViewScan({ onNavigate }) {
  const [seconds, setSeconds] = useState(3);
  useEffect(() => {
    if (seconds <= 0) return;
    const t = setTimeout(() => setSeconds(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds]);

  return (
    <div style={{
      position: "relative",
      minHeight: "100vh",
      background: "radial-gradient(60% 50% at 50% 0%, var(--accent-soft) 0%, var(--bg-canvas) 70%)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "24px",
    }}>
      <Button size="sm" variant="ghost" icon="chevron-left" onClick={() => onNavigate("dashboard")} style={{ position: "absolute", top: 16, left: 16 }}>
        Back to admin
      </Button>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 28, maxWidth: 400, textAlign: "center" }}>
        <div className="sb-mark" style={{ width: 56, height: 56, borderRadius: 16 }}>
          <Icon name="qr-code" size={28} />
        </div>

        <div className="col gap-2 items-center">
          <Badge tone="brand" live>Public scan interstitial</Badge>
          <h1 className="page-h1" style={{ fontSize: 26, textAlign: "center" }}>You're being redirected…</h1>
          <div className="text-sm muted" style={{ maxWidth: 320 }}>
            Aurora is taking you to their <span className="strong">Summer drop</span> product page.
          </div>
        </div>

        {/* Loader bar */}
        <div style={{
          width: 240, height: 4,
          background: "var(--bg-sunken)",
          borderRadius: 2,
          overflow: "hidden",
          position: "relative",
        }}>
          <div style={{
            position: "absolute",
            top: 0, left: 0, height: "100%",
            width: "100%",
            background: "linear-gradient(90deg, var(--accent), var(--violet))",
            borderRadius: 2,
            animation: "scan-loader 3s ease-in-out forwards",
          }}></div>
        </div>
        <style>{`@keyframes scan-loader { from { transform: translateX(-100%); } to { transform: translateX(0%); } }`}</style>

        <div className="text-xs muted" style={{ fontFamily: "var(--ff-mono)", letterSpacing: ".08em", textTransform: "uppercase" }}>
          Redirecting in {seconds}s
        </div>

        <div className="text-xs muted mt-4">
          Powered by <span className="strong">QR Flow</span> · Scan logged · iPhone 15 · Brooklyn, NY
        </div>
      </div>
    </div>
  );
}

function ViewCampaignPublic({ onNavigate }) {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  return (
    <div style={{ background: "var(--bg-canvas)", minHeight: "100vh" }}>
      {/* Header */}
      <div style={{
        padding: "14px 24px",
        background: "var(--bg-surface)",
        borderBottom: "1px solid var(--border)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <Button size="sm" variant="ghost" icon="chevron-left" onClick={() => onNavigate("campaigns")}>
          Back to admin
        </Button>
        <div className="flex items-center gap-3">
          <div style={{
            width: 26, height: 26, borderRadius: 7,
            background: "linear-gradient(135deg, #0F172A, #1F2937)",
            color: "#fff",
            display: "grid", placeItems: "center",
            fontWeight: 600, fontSize: 13, fontFamily: "var(--ff-display)",
          }}>A</div>
          <div className="strong" style={{ fontFamily: "var(--ff-display)", letterSpacing: "-0.012em" }}>Aurora</div>
        </div>
        <Button size="sm" variant="ghost" iconRight="external-link">Back to store</Button>
      </div>

      {/* Hero */}
      <div className="lp-hero" style={{ padding: "72px 24px 64px" }}>
        <Badge tone="brand" style={{ marginBottom: 18 }}><span className="dot"></span>Limited time · 24 hours only</Badge>
        <h1 style={{ fontSize: 42, lineHeight: 1.05, maxWidth: 640, margin: "0 auto 14px" }}>
          The spring drop is here — only for the curious.
        </h1>
        <p style={{ maxWidth: 480, fontSize: 15 }}>
          Aurora's exclusive scan-to-shop access. Be first in line for our most-wanted pieces, before they hit the public site.
        </p>
        <div className="flex gap-2 items-center" style={{ justifyContent: "center", marginTop: 22 }}>
          <Button variant="primary" size="lg" iconRight="arrow-right" style={{ background: "#fff", color: "#0F172A", borderColor: "#fff" }}>
            Shop the drop
          </Button>
          <Button variant="ghost" size="lg" style={{ color: "rgba(255,255,255,0.8)" }}>Learn more</Button>
        </div>
      </div>

      {/* Timer */}
      <div style={{ background: "var(--bg-surface)" }}>
        <div className="text-xs muted" style={{
          textAlign: "center",
          padding: "20px 16px 8px",
          fontFamily: "var(--ff-mono)",
          textTransform: "uppercase",
          letterSpacing: ".1em",
          fontSize: 10.5,
        }}>Drop ends in</div>
        <div className="lp-timer" style={{ background: "var(--bg-surface)", paddingTop: 8 }}>
          {["01", "14", "32", "06"].map((p, i) => (
            <div key={i} className="lp-timer-unit" style={{ minWidth: 76, padding: "14px 18px" }}>
              <div className="lp-timer-num" style={{ fontSize: 28 }}>{p}</div>
              <div className="lp-timer-lbl">{["Days","Hours","Min","Sec"][i]}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Products */}
      <div style={{ maxWidth: 880, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <h2 style={{ fontFamily: "var(--ff-display)", fontSize: 24, fontWeight: 600, letterSpacing: "-0.018em", margin: 0 }}>
            Featured this drop
          </h2>
          <div className="text-sm muted mt-2">Hand-picked. Limited runs.</div>
        </div>
        <div className="grid grid-3" style={{ gap: 16 }}>
          {[
            { name: "Aurora Tee", price: "$48", tag: "Bestseller" },
            { name: "Stone Hoodie", price: "$128", tag: "New" },
            { name: "Drift Cap", price: "$36", tag: "Last 12" },
          ].map((p, i) => (
            <div key={i} style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border)",
              borderRadius: 14,
              overflow: "hidden",
            }}>
              <div style={{
                aspectRatio: "1",
                background: "linear-gradient(135deg, var(--bg-sunken), var(--bg-hover))",
                display: "grid", placeItems: "center",
                color: "var(--fg-subtle)",
                position: "relative",
              }}>
                <Icon name="image" size={40} />
                <Badge tone="brand" style={{ position: "absolute", top: 12, left: 12 }}>{p.tag}</Badge>
              </div>
              <div style={{ padding: 14 }}>
                <div className="strong" style={{ fontSize: 14 }}>{p.name}</div>
                <div className="num muted text-sm mt-2" style={{ fontFamily: "var(--ff-mono)" }}>{p.price}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Email capture */}
      <div style={{ maxWidth: 540, margin: "0 auto", padding: "0 24px 48px" }}>
        <div style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          borderRadius: 18,
          padding: 36,
          textAlign: "center",
          boxShadow: "var(--sh-md)",
        }}>
          <h3 style={{ fontFamily: "var(--ff-display)", fontSize: 20, fontWeight: 600, letterSpacing: "-0.015em", margin: "0 0 6px" }}>
            Get early access
          </h3>
          <p className="text-sm muted" style={{ margin: "0 0 18px" }}>
            Drop your email — we'll text you when the next drop goes live.
          </p>
          {submitted ? (
            <div className="flex items-center gap-2" style={{ justifyContent: "center", color: "var(--green-fg)" }}>
              <Icon name="circle-check" size={18} />
              <span className="strong">You're on the list.</span>
            </div>
          ) : (
            <div className="flex gap-2" style={{ maxWidth: 360, margin: "0 auto" }}>
              <Input placeholder="you@email.com" value={email} onChange={e => setEmail(e.target.value)} />
              <Button variant="primary" onClick={() => { if (email) setSubmitted(true); }}>
                Notify me
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Promo */}
      <div style={{ maxWidth: 540, margin: "0 auto", padding: "0 24px 48px" }}>
        <div className="lp-promo" style={{ margin: 0, padding: 28 }}>
          <div className="text-xs strong" style={{ fontFamily: "var(--ff-mono)", textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 8, color: "var(--amber-fg)" }}>
            First-time bonus
          </div>
          <div className="lp-promo-code" style={{ fontSize: 30 }}>AURORA15</div>
          <div className="text-sm" style={{ marginTop: 8 }}>15% off your first order — auto-applied at checkout.</div>
        </div>
      </div>

      {/* Footer */}
      <div style={{
        borderTop: "1px solid var(--border)",
        padding: "20px 24px",
        textAlign: "center",
        color: "var(--fg-muted)",
        fontSize: 12,
      }}>
        <div>© 2026 Aurora Studio · <a className="muted" style={{ textDecoration: "underline" }}>Terms</a> · <a className="muted" style={{ textDecoration: "underline" }}>Privacy</a></div>
        <div className="mt-2 text-xs" style={{ fontFamily: "var(--ff-mono)" }}>Powered by QR Flow</div>
      </div>
    </div>
  );
}

window.ViewScan = ViewScan;
window.ViewCampaignPublic = ViewCampaignPublic;
