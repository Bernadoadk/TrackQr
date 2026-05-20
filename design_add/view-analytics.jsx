// view-analytics.jsx

function AreaChart({ data, height = 240, accent = "blue" }) {
  const w = 100;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const step = w / (data.length - 1 || 1);
  const points = data.map((v, i) => {
    const x = i * step;
    const y = height - ((v - min) / (max - min || 1)) * height * 0.85 - height * 0.075;
    return [x, y];
  });
  const linePath = "M " + points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" L ");
  const areaPath = linePath + ` L ${w},${height} L 0,${height} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ width: "100%", height, display: "block" }}>
      <defs>
        <linearGradient id="area-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.30" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
        <pattern id="grid-pat" width="10" height={height/5} patternUnits="userSpaceOnUse">
          <path d={`M0 ${height/5} L${w} ${height/5}`} stroke="var(--border-soft)" strokeWidth="0.15" fill="none"/>
        </pattern>
      </defs>
      <rect width={w} height={height} fill="url(#grid-pat)" opacity="0.6" />
      <path d={areaPath} fill="url(#area-grad)" />
      <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth="0.4" strokeLinejoin="round" strokeLinecap="round" />
      {points.filter((_, i) => i === points.length - 1).map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="1.2" fill="var(--bg-surface)" stroke="var(--accent)" strokeWidth="0.5"/>
        </g>
      ))}
    </svg>
  );
}

function Donut({ slices, size = 160, thickness = 22 }) {
  const r = (size - thickness) / 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  const total = slices.reduce((s, x) => s + x.value, 0);
  return (
    <svg viewBox={`0 0 ${size} ${size}`} style={{ width: size, height: size }}>
      <circle cx={c} cy={c} r={r} fill="none" stroke="var(--bg-sunken)" strokeWidth={thickness} />
      {slices.map((s, i) => {
        const frac = s.value / total;
        const len = frac * circumference;
        const dasharray = `${len} ${circumference - len}`;
        const dashoffset = -offset;
        offset += len;
        return (
          <circle
            key={i}
            cx={c} cy={c} r={r}
            fill="none"
            stroke={s.color}
            strokeWidth={thickness}
            strokeDasharray={dasharray}
            strokeDashoffset={dashoffset}
            transform={`rotate(-90 ${c} ${c})`}
            strokeLinecap="butt"
          />
        );
      })}
      <text x={c} y={c - 4} textAnchor="middle"
            style={{ fontFamily: "var(--ff-display)", fontWeight: 600, fontSize: 24, fill: "var(--fg-strong)" }}>
        {total.toLocaleString()}
      </text>
      <text x={c} y={c + 14} textAnchor="middle"
            style={{ fontFamily: "var(--ff-mono)", fontSize: 9, fill: "var(--fg-muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
        Total
      </text>
    </svg>
  );
}

function BarChart({ data, color = "var(--accent)" }) {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div className="col gap-3">
      {data.map((d, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "150px 1fr 60px", alignItems: "center", gap: 12, fontSize: 12.5 }}>
          <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--fg)" }}>{d.name}</div>
          <div style={{ height: 22, background: "var(--bg-sunken)", borderRadius: 4, position: "relative", overflow: "hidden" }}>
            <div style={{
              height: "100%",
              width: `${(d.value / max) * 100}%`,
              background: `linear-gradient(90deg, ${color}, var(--violet))`,
              borderRadius: 4,
              boxShadow: "0 0 12px var(--ring)",
            }}></div>
          </div>
          <div className="num" style={{ textAlign: "right", fontFamily: "var(--ff-mono)", color: "var(--fg-strong)", fontWeight: 500 }}>{fmt(d.value)}</div>
        </div>
      ))}
    </div>
  );
}

function ViewAnalytics() {
  const [period, setPeriod] = useState("30");
  const totalScans = SCANS_30D.reduce((s, n) => s + n, 0);
  const totalConv = QR_CODES.reduce((s, q) => s + q.conversions, 0);
  const convRate = (totalConv / totalScans * 100);

  const typeSlices = [
    { name: "Scans",      value: 7426, color: "#2563EB" },
    { name: "Conversions",value: 1244, color: "#16A34A" },
    { name: "Upsells",    value: 312,  color: "#7C3AED" },
    { name: "Bounce",     value: 188,  color: "#94A3B8" },
  ];

  return (
    <>
      <div className="page-head">
        <div className="page-head-left">
          <div className="page-eyebrow"><Icon name="bar-chart" size={11} /> Real-time</div>
          <h1 className="page-h1"><span className="em">Analytics</span></h1>
          <div className="page-sub">Where, when and on what device your audience is scanning.</div>
        </div>
        <div className="page-head-actions">
          <Segmented
            value={period}
            onChange={setPeriod}
            options={[
              { value: "7", label: "7d" },
              { value: "30", label: "30d" },
              { value: "90", label: "90d" },
              { value: "custom", label: "Custom" },
            ]}
          />
          <Button variant="secondary" icon="download">Export</Button>
        </div>
      </div>

      <div className="grid grid-4 mb-6">
        <StatCard accent="blue"   label="Total scans"   value={fmt(totalScans)} icon="scan"        delta="+8.2%" sub="vs. last 30d" sparklineData={SPARK_SCANS} />
        <StatCard accent="green"  label="Conversions"   value={fmt(totalConv)}  icon="trending-up" delta="+15.4%" sub="vs. last 30d" />
        <StatCard accent="amber"  label="Conv. rate"    value={fmtPct(convRate, 2)} icon="zap"     delta="+0.6pt" />
        <StatCard accent="violet" label="Unique users"  value={fmt(8742)}        icon="users"      delta="+12%" />
      </div>

      <Card accent="blue" className="mb-6">
        <CardHead
          title="Scans over time"
          subtitle="Daily totals across all QR codes — last 30 days"
          actions={
            <div className="flex gap-3 items-center">
              <div className="flex items-center gap-2 text-xs muted">
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent)" }}></span>
                Scans
              </div>
              <div className="flex items-center gap-2 text-xs muted">
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--violet)" }}></span>
                Conversions
              </div>
            </div>
          }
        />
        <div style={{ padding: "12px 18px 18px" }}>
          <AreaChart data={SCANS_30D} height={240} />
        </div>
      </Card>

      <div className="grid grid-2 mb-6">
        <Card>
          <CardHead title="Breakdown by event" />
          <div style={{ padding: "16px 18px 24px", display: "flex", alignItems: "center", gap: 24 }}>
            <Donut slices={typeSlices} />
            <div className="col gap-3" style={{ flex: 1 }}>
              {typeSlices.map((s, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color }}></span>
                  <span className="text-sm" style={{ flex: 1 }}>{s.name}</span>
                  <span className="num text-sm strong">{fmt(s.value)}</span>
                  <span className="text-xs muted num" style={{ width: 44, textAlign: "right" }}>
                    {((s.value / typeSlices.reduce((a, b) => a + b.value, 0)) * 100).toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card>
          <CardHead title="Top QR codes" subtitle="By scan volume" />
          <div style={{ padding: "16px 18px 24px" }}>
            <BarChart data={TOP_QRS} />
          </div>
        </Card>
      </div>

      <div className="grid grid-2 mb-6">
        <Card accent="violet">
          <CardHead title="Geography" subtitle="Top countries by scans" />
          <div style={{ padding: "8px 18px 18px" }}>
            {COUNTRIES.map(c => (
              <div key={c.name} className="progress-row">
                <div className="progress-flag">{c.flag}</div>
                <div>
                  <div className="progress-name">{c.name}</div>
                  <div className="progress-bar" style={{ marginTop: 4 }}>
                    <div className="progress-fill" style={{ width: `${c.pct * 2.5}%` }}></div>
                  </div>
                </div>
                <div className="progress-val">{fmt(c.value)}</div>
                <div className="progress-pct">{c.pct}%</div>
              </div>
            ))}
          </div>
        </Card>

        <Card accent="green">
          <CardHead title="Devices" subtitle="What people scan with" />
          <div style={{ padding: "20px 18px", display: "flex", flexDirection: "column", gap: 20 }}>
            {DEVICES.map(d => (
              <div key={d.name}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <span className="feed-icon" style={{ width: 32, height: 32 }}>
                      <Icon name={d.icon} size={14} />
                    </span>
                    <div>
                      <div className="strong text-sm">{d.name}</div>
                      <div className="text-xs muted num">{fmt(d.value)} scans</div>
                    </div>
                  </div>
                  <div className="strong num" style={{ fontFamily: "var(--ff-display)", fontSize: 20 }}>{d.pct}%</div>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${d.pct}%` }}></div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card>
        <CardHead
          title="Recent scans"
          subtitle="Last 50 events"
          actions={<Badge tone="success" live>Live</Badge>}
        />
        <div style={{ overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>QR code</th>
                <th>Type</th>
                <th>Location</th>
                <th>Device</th>
                <th>Result</th>
                <th className="right">When</th>
              </tr>
            </thead>
            <tbody>
              {RECENT_SCANS.map((s, i) => {
                const tm = typeMeta(s.type);
                return (
                  <tr key={i}>
                    <td className="strong">{s.qr}</td>
                    <td><Badge tone="neutral"><Icon name={tm.icon} size={11} />{tm.name}</Badge></td>
                    <td className="muted">{s.loc}</td>
                    <td className="muted">{s.device}</td>
                    <td><Badge tone={s.result === "Conversion" ? "success" : s.result === "Connected" ? "brand" : "neutral"} dot>{s.result}</Badge></td>
                    <td className="right num muted" style={{ fontFamily: "var(--ff-mono)", fontSize: 11.5 }}>{s.time}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

window.ViewAnalytics = ViewAnalytics;
