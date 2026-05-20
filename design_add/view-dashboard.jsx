// view-dashboard.jsx

function ViewDashboard({ onNavigate }) {
  const totalQr = QR_CODES.length;
  const totalScans = QR_CODES.reduce((s, q) => s + q.scans, 0);
  const totalConv = QR_CODES.reduce((s, q) => s + q.conversions, 0);
  const convRate = (totalConv / totalScans * 100);
  const activeCmp = CAMPAIGNS.filter(c => c.status === "active").length;
  const recentQrs = [...QR_CODES].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);

  return (
    <>
      <div className="page-head">
        <div className="page-head-left">
          <div className="page-eyebrow"><span className="dot"></span>Welcome back</div>
          <h1 className="page-h1">Good morning, <span className="em">Aurora</span>.</h1>
          <div className="page-sub">A pulse on every QR code, campaign and conversion — refreshed every minute.</div>
        </div>
        <div className="page-head-actions">
          <Button variant="secondary" icon="bar-chart" onClick={() => onNavigate("analytics")}>Analytics</Button>
          <Button variant="primary" icon="plus" onClick={() => onNavigate("create")}>Create QR code</Button>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-4">
        <StatCard
          accent="blue"
          label="QR codes"
          value={totalQr}
          icon="qr-code"
          delta="+3"
          deltaTone="up"
          sub={`${activeCmp} campaigns running`}
        />
        <StatCard
          accent="violet"
          label="Total scans"
          value={fmt(totalScans)}
          icon="scan"
          delta="+8.2%"
          deltaTone="up"
          sub="last 14 days"
          sparklineData={SPARK_SCANS}
        />
        <StatCard
          accent="green"
          label="Conversions"
          value={fmt(totalConv)}
          icon="trending-up"
          delta="+15.4%"
          deltaTone="up"
          sub="vs. last period"
        />
        <StatCard
          accent="amber"
          label="Conv. rate"
          value={fmtPct(convRate, 2)}
          icon="zap"
          delta="+0.6pt"
          deltaTone="up"
          sub={`${activeCmp} active campaigns`}
        />
      </div>

      {/* Recent + Activity */}
      <div className="grid grid-23 mt-6">
        <Card accent="blue">
          <CardHead
            title="Recent QR codes"
            subtitle="Latest five additions"
            actions={
              <Button size="sm" variant="ghost" iconRight="arrow-right" onClick={() => onNavigate("manager")}>
                View all
              </Button>
            }
          />
          {recentQrs.length === 0 ? (
            <EmptyState
              icon="qr-code"
              title="No QR codes yet"
              desc="Create your first QR code to start tracking scans and conversions."
              cta={<Button variant="primary" icon="plus" onClick={() => onNavigate("create")}>Create QR code</Button>}
            />
          ) : (
            <div>
              {recentQrs.map(qr => {
                const tm = typeMeta(qr.type);
                return (
                  <div key={qr.id} className="row-item" onClick={() => onNavigate("manager")}>
                    <div className="row-thumb qr">
                      <QrSvg text={qr.url || qr.name} size={60} fg={qr.color} />
                    </div>
                    <div className="row-main">
                      <div className="row-title">{qr.name}</div>
                      <div className="row-meta">
                        <Icon name={tm.icon} size={11} style={{ verticalAlign: "-1px", marginRight: 4 }}/>
                        {tm.name}
                        <span className="sep">•</span>
                        <span className="num">{fmt(qr.scans)} scans</span>
                        <span className="sep">•</span>
                        {fmtRel(qr.createdAt)}
                      </div>
                    </div>
                    <Badge tone={qr.active ? "success" : "neutral"} dot>{qr.active ? "Active" : "Paused"}</Badge>
                    <Icon name="chevron-right" className="row-item-arrow" />
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card accent="violet">
          <CardHead
            title="Activity"
            actions={<Badge tone="success" live>Live</Badge>}
          />
          <div className="feed">
            {ACTIVITY.slice(0, 6).map((a, i) => (
              <div key={a.id} className={`feed-item ${i === 0 ? "live" : ""}`}>
                <div className={`feed-icon ${a.tone}`}>
                  <Icon name={activityIcon(a.kind)} size={13} />
                </div>
                <div className="feed-main">
                  <div className="feed-title"><b>{a.title}</b></div>
                  <div className="feed-meta">{a.who}</div>
                </div>
                <div className="feed-time">{fmtRel(a.time)}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Quick actions */}
      <div className="section">
        <h2 className="section-h">Quick actions</h2>
        <div className="grid grid-3">
          <div className="action-card" data-accent="blue" onClick={() => onNavigate("create")}>
            <div className="action-icon"><Icon name="plus" size={17} /></div>
            <div className="action-arrow"><Icon name="arrow-up-right" /></div>
            <div className="action-body">
              <div className="action-title">Create a QR code</div>
              <div className="action-desc">Link a product, page, promo or anything else — designed in seconds.</div>
            </div>
          </div>
          <div className="action-card" data-accent="violet" onClick={() => onNavigate("campaigns")}>
            <div className="action-icon"><Icon name="megaphone" size={17} /></div>
            <div className="action-arrow"><Icon name="arrow-up-right" /></div>
            <div className="action-body">
              <div className="action-title">New campaign</div>
              <div className="action-desc">Launch a landing page with email capture, timer and conversion tracking.</div>
            </div>
          </div>
          <div className="action-card" data-accent="amber" onClick={() => onNavigate("manager")}>
            <div className="action-icon"><Icon name="zap" size={17} /></div>
            <div className="action-arrow"><Icon name="arrow-up-right" /></div>
            <div className="action-body">
              <div className="action-title">QR designer</div>
              <div className="action-desc">Pick a style, add a logo, choose colors — make every code on-brand.</div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

window.ViewDashboard = ViewDashboard;
