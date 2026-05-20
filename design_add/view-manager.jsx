// view-manager.jsx — My QR codes

function ViewManager({ onNavigate }) {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("recent");

  const totalScans = QR_CODES.reduce((s, q) => s + q.scans, 0);
  const totalConv = QR_CODES.reduce((s, q) => s + q.conversions, 0);
  const activeCount = QR_CODES.filter(q => q.active).length;
  const activePct = (activeCount / QR_CODES.length * 100);

  const filtered = QR_CODES.filter(q => {
    if (query && !q.name.toLowerCase().includes(query.toLowerCase())) return false;
    if (typeFilter !== "all" && q.type !== typeFilter) return false;
    if (statusFilter === "active" && !q.active) return false;
    if (statusFilter === "inactive" && q.active) return false;
    return true;
  });

  // Sort
  const sorted = useMemo(() => {
    const arr = [...filtered];
    if (sortBy === "scans")    arr.sort((a, b) => b.scans - a.scans);
    else if (sortBy === "conv") arr.sort((a, b) => b.conversions - a.conversions);
    else if (sortBy === "name") arr.sort((a, b) => a.name.localeCompare(b.name));
    else                         arr.sort((a, b) => b.createdAt - a.createdAt);
    return arr;
  }, [filtered, sortBy]);

  const activeFilterCount =
    (typeFilter !== "all" ? 1 : 0) +
    (statusFilter !== "all" ? 1 : 0) +
    (query ? 1 : 0);

  const clearAll = () => { setQuery(""); setTypeFilter("all"); setStatusFilter("all"); };

  return (
    <>
      <div className="page-head">
        <div className="page-head-left">
          <div className="page-eyebrow"><Icon name="qr-code" size={11} /> {QR_CODES.length} codes</div>
          <h1 className="page-h1">My <span className="em">QR codes</span></h1>
          <div className="page-sub">Browse, edit and download every code your team has shipped.</div>
        </div>
        <div className="page-head-actions">
          <Button variant="secondary" icon="download">Export CSV</Button>
          <Button variant="primary" icon="plus" onClick={() => onNavigate("create")}>New QR code</Button>
        </div>
      </div>

      <div className="grid grid-4 mb-6">
        <StatCard accent="blue"   label="Total QR codes"  value={QR_CODES.length} icon="qr-code" sub={`${activeCount} active`} />
        <StatCard accent="violet" label="Total scans"     value={fmt(totalScans)} icon="scan"    delta="+8.2%" deltaTone="up" />
        <StatCard accent="green"  label="Active rate"     value={fmtPct(activePct, 0)} icon="circle-check" sub={`${activeCount} / ${QR_CODES.length}`} />
        <StatCard accent="amber"  label="Conversions"     value={fmt(totalConv)} icon="zap" delta="+15%" deltaTone="up" />
      </div>

      <div className="filterbar">
        <div className="filterbar-search">
          <Icon name="search" />
          <input
            type="text"
            placeholder="Search QR codes by name…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          {query && (
            <button
              className="modal-close"
              style={{ width: 22, height: 22 }}
              onClick={() => setQuery("")}
              aria-label="Clear search"
            >
              <Icon name="x" size={12} />
            </button>
          )}
        </div>

        <div className="filterbar-divider" />

        <div className="filterbar-group">
          <span className="filter-select-label">Type</span>
          <select
            className="filter-select"
            data-active={typeFilter !== "all"}
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
          >
            <option value="all">All types</option>
            {QR_TYPES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>

        <div className="filterbar-divider" />

        <div className="filterbar-group">
          <span className="filter-select-label">Status</span>
          <Segmented
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: "all", label: "All" },
              { value: "active", label: "Active" },
              { value: "inactive", label: "Paused" },
            ]}
          />
        </div>

        <div className="filterbar-divider" />

        <div className="filterbar-group">
          <span className="filter-select-label">Sort</span>
          <select
            className="filter-select"
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
          >
            <option value="recent">Most recent</option>
            <option value="scans">Most scans</option>
            <option value="conv">Most conversions</option>
            <option value="name">Name (A→Z)</option>
          </select>
        </div>
      </div>

      <div className="filter-chips">
        {query && (
          <span className="filter-chip">
            <span className="filter-chip-label">Search</span>
            <span style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>"{query}"</span>
            <button className="filter-chip-x" onClick={() => setQuery("")} aria-label="Clear search">
              <Icon name="x" />
            </button>
          </span>
        )}
        {typeFilter !== "all" && (
          <span className="filter-chip">
            <span className="filter-chip-label">Type</span>
            {typeMeta(typeFilter).name}
            <button className="filter-chip-x" onClick={() => setTypeFilter("all")} aria-label="Clear type">
              <Icon name="x" />
            </button>
          </span>
        )}
        {statusFilter !== "all" && (
          <span className="filter-chip">
            <span className="filter-chip-label">Status</span>
            {statusFilter === "active" ? "Active" : "Paused"}
            <button className="filter-chip-x" onClick={() => setStatusFilter("all")} aria-label="Clear status">
              <Icon name="x" />
            </button>
          </span>
        )}
        {activeFilterCount > 1 && (
          <button className="filter-clear" onClick={clearAll}>Clear all</button>
        )}
        <span className="filter-count">
          <b>{sorted.length}</b> of {QR_CODES.length} {QR_CODES.length === 1 ? "code" : "codes"}
        </span>
      </div>

      {sorted.length === 0 ? (
        <Card>
          <EmptyState
            icon="qr-code"
            title="No QR codes match those filters"
            desc="Try clearing your search or status filter."
            cta={<Button variant="secondary" onClick={clearAll}>Clear filters</Button>}
          />
        </Card>
      ) : (
        <div className="grid grid-3" style={{ gap: 16 }}>
          {sorted.map(qr => {
            const tm = typeMeta(qr.type);
            return (
              <Card key={qr.id} hoverLift className="card-pad">
                <div className="flex items-center gap-3 mb-3" style={{ justifyContent: "space-between" }}>
                  <Badge tone="brand">
                    <Icon name={tm.icon} size={11} />
                    {tm.name}
                  </Badge>
                  <Badge tone={qr.active ? "success" : "neutral"} dot>{qr.active ? "Active" : "Paused"}</Badge>
                </div>
                <div style={{
                  background: "#fff",
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  padding: 14,
                  aspectRatio: "1",
                  display: "grid",
                  placeItems: "center",
                  marginBottom: 14,
                  maxWidth: 220,
                  width: "100%",
                  marginInline: "auto",
                }}>
                  <QrSvg text={qr.url || qr.name} size={180} fg={qr.color} style="rounded" cornerStyle="rounded" />
                </div>
                <div className="strong" style={{ fontSize: 13.5, marginBottom: 4 }}>{qr.name}</div>
                <div className="text-xs muted mb-3">
                  Created {fmtRel(qr.createdAt)}
                </div>
                <div className="flex items-center gap-3" style={{ paddingTop: 10, borderTop: "1px solid var(--border-soft)" }}>
                  <div className="flex-1">
                    <div className="text-xs muted" style={{ fontFamily: "var(--ff-mono)", textTransform: "uppercase", letterSpacing: ".06em", fontSize: 10 }}>Scans</div>
                    <div className="strong num" style={{ fontSize: 16, fontFamily: "var(--ff-display)" }}>{fmt(qr.scans)}</div>
                  </div>
                  <div className="flex-1">
                    <div className="text-xs muted" style={{ fontFamily: "var(--ff-mono)", textTransform: "uppercase", letterSpacing: ".06em", fontSize: 10 }}>Conv.</div>
                    <div className="strong num" style={{ fontSize: 16, fontFamily: "var(--ff-display)" }}>{fmt(qr.conversions)}</div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => toast({ title: "Link copied", tone: "info" })}><Icon name="copy" size={13} /></Button>
                    <Button size="sm" variant="ghost"><Icon name="edit" size={13} /></Button>
                    <Button size="sm" variant="ghost" onClick={() => toast({ title: "PNG downloaded" })}><Icon name="download" size={13} /></Button>
                    <Button size="sm" variant="ghost"><Icon name="more-horizontal" size={13} /></Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}

window.ViewManager = ViewManager;
