// view-campaigns.jsx — Campaigns list

const STATUS_TONE = {
  active: "success",
  paused: "warning",
  draft: "neutral",
  ended: "danger",
};
const STATUS_LABEL = {
  active: "Active",
  paused: "Paused",
  draft: "Draft",
  ended: "Ended",
};

function ViewCampaigns({ onNavigate, onEdit }) {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);

  const filtered = CAMPAIGNS.filter(c =>
    (query === "" || c.name.toLowerCase().includes(query.toLowerCase())) &&
    (status === "all" || c.status === status)
  );

  const totalActive = CAMPAIGNS.filter(c => c.status === "active").length;
  const totalLeads = CAMPAIGNS.reduce((s, c) => s + c.leads, 0);
  const totalScans = CAMPAIGNS.reduce((s, c) => s + c.scans, 0);
  const totalConv = CAMPAIGNS.reduce((s, c) => s + c.conversions, 0);

  return (
    <>
      <div className="page-head">
        <div className="page-head-left">
          <div className="page-eyebrow"><Icon name="megaphone" size={11} /> {totalActive} running</div>
          <h1 className="page-h1"><span className="em">Campaigns</span></h1>
          <div className="page-sub">Landing pages built block-by-block, attached to a QR code, tracked end-to-end.</div>
        </div>
        <div className="page-head-actions">
          <Button variant="primary" icon="plus" onClick={() => setCreateOpen(true)}>New campaign</Button>
        </div>
      </div>

      <div className="grid grid-4 mb-6">
        <StatCard accent="green"  label="Active"      value={totalActive} icon="play" sub={`of ${CAMPAIGNS.length} total`} />
        <StatCard accent="violet" label="Total leads" value={fmt(totalLeads)} icon="mail" delta="+18%" deltaTone="up" />
        <StatCard accent="blue"   label="Total scans" value={fmt(totalScans)} icon="scan" delta="+8.2%" deltaTone="up" />
        <StatCard accent="amber"  label="Conversions" value={fmt(totalConv)} icon="zap" delta="+15%" deltaTone="up" />
      </div>

      <div className="toolbar">
        <div className="grow">
          <Input icon="search" placeholder="Search campaigns…" value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <Tabs
          value={status}
          onChange={setStatus}
          tabs={[
            { value: "all", label: "All" },
            { value: "active", label: "Active" },
            { value: "paused", label: "Paused" },
            { value: "draft", label: "Draft" },
            { value: "ended", label: "Ended" },
          ]}
        />
      </div>

      <div className="col gap-3">
        {filtered.map(c => (
          <Card key={c.id} hoverLift className="card-pad" style={{ cursor: "default" }}>
            <div className="flex gap-4 items-start">
              <div style={{
                width: 56, height: 56,
                background: c.status === "active"
                  ? "linear-gradient(135deg, #2563EB, #7C3AED)"
                  : c.status === "paused"
                  ? "linear-gradient(135deg, #F59E0B, #D97706)"
                  : c.status === "draft"
                  ? "linear-gradient(135deg, #94A3B8, #475569)"
                  : "linear-gradient(135deg, #DC2626, #B91C1C)",
                borderRadius: 12,
                display: "grid", placeItems: "center", color: "#fff",
                flexShrink: 0,
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.2)",
              }}>
                <Icon name="megaphone" size={22} />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <div className="strong" style={{ fontFamily: "var(--ff-display)", fontSize: 16, letterSpacing: "-0.012em" }}>{c.name}</div>
                  <Badge tone={STATUS_TONE[c.status]} dot>{STATUS_LABEL[c.status]}</Badge>
                </div>
                <div className="text-sm muted mb-3" style={{ maxWidth: 600 }}>{c.description}</div>
                <div className="flex gap-6 items-center text-sm muted" style={{ fontFamily: "var(--ff-mono)", fontSize: 11.5 }}>
                  <div><Icon name="calendar" size={11} style={{ verticalAlign: "-1px", marginRight: 4 }}/>{c.start} → {c.end}</div>
                  <div><Icon name="scan" size={11} style={{ verticalAlign: "-1px", marginRight: 4 }}/><span className="num strong">{fmt(c.scans)}</span> scans</div>
                  <div><Icon name="mail" size={11} style={{ verticalAlign: "-1px", marginRight: 4 }}/><span className="num strong">{fmt(c.leads)}</span> leads</div>
                  <div><Icon name="trending-up" size={11} style={{ verticalAlign: "-1px", marginRight: 4 }}/><span className="num strong">{c.convRate.toFixed(2)}%</span> conv.</div>
                </div>
              </div>
              <div className="flex gap-2">
                {c.status === "draft" ? (
                  <Button variant="primary" size="sm" icon="play" onClick={onEdit}>Continue</Button>
                ) : (
                  <>
                    <Button variant="secondary" size="sm" icon="external-link" onClick={() => onNavigate("campaign-public")}>Live page</Button>
                    <Button variant="secondary" size="sm" icon="edit" onClick={onEdit}>Edit</Button>
                  </>
                )}
                {c.status === "active" && (
                  <Button variant="ghost" size="sm" onClick={() => toast({ title: "Campaign paused", tone: "warning" })}><Icon name="pause" size={13} /></Button>
                )}
                {c.status === "paused" && (
                  <Button variant="ghost" size="sm" onClick={() => toast({ title: "Campaign resumed" })}><Icon name="play" size={13} /></Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => toast({ title: "Leads exported", desc: `${c.leads} rows · CSV` })}><Icon name="download" size={13} /></Button>
                <Button variant="ghost" size="sm"><Icon name="more-horizontal" size={13} /></Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <NewCampaignModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={(data) => {
          setCreateOpen(false);
          toast({ title: "Campaign created", desc: `${data.name} · Continue in editor` });
          onEdit?.();
        }}
      />
    </>
  );
}

/* ─────────────── New campaign modal ─────────────── */
function todayISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function NewCampaignModal({ open, onClose, onCreate }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState(todayISO(30));
  const [touched, setTouched] = useState(false);

  // Reset when opening
  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setStartDate(todayISO());
      setEndDate(todayISO(30));
      setTouched(false);
    }
  }, [open]);

  const nameError = touched && !name.trim() ? "Give your campaign a name." : null;
  const dateError = startDate && endDate && endDate < startDate
    ? "End date must be on or after the start date."
    : null;
  const canSubmit = name.trim() && !dateError;

  const handleSubmit = (e) => {
    e?.preventDefault?.();
    setTouched(true);
    if (!canSubmit) return;
    onCreate?.({ name: name.trim(), description: description.trim(), startDate, endDate });
  };

  // Pretty-format duration
  const days = (() => {
    if (!startDate || !endDate) return null;
    const a = new Date(startDate), b = new Date(endDate);
    return Math.round((b - a) / 86400000) + 1;
  })();

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon="megaphone"
      accent="violet"
      title="New campaign"
      subtitle="Set the basics — you can fine-tune blocks, leads and design in the editor."
      footer={
        <>
          <span className="text-xs muted" style={{ marginRight: "auto", fontFamily: "var(--ff-mono)" }}>
            {days != null && days > 0 ? `${days} day${days === 1 ? "" : "s"} duration` : ""}
          </span>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="arrow-right" onClick={handleSubmit}>Create & open editor</Button>
        </>
      }
    >
      <form onSubmit={handleSubmit}>
        <Field label="Campaign name" required error={nameError} hint={!nameError ? "Visible only to your team — e.g. \"Aurora summer drop\"." : null}>
          <Input
            autoFocus
            placeholder="Aurora summer drop"
            value={name}
            onChange={e => setName(e.target.value)}
            onBlur={() => setTouched(true)}
            maxLength={64}
          />
        </Field>

        <Field label="Description" hint="One-liner shown on the dashboard list. Optional.">
          <Textarea
            placeholder="A capsule drop landing page tied to the in-store window QR. Capture emails, push to checkout."
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={3}
            style={{ minHeight: 76 }}
            maxLength={240}
          />
          <div style={{ fontFamily: "var(--ff-mono)", fontSize: 10.5, color: "var(--fg-subtle)", textAlign: "right", marginTop: 2 }}>
            {description.length}/240
          </div>
        </Field>

        <div className="grid grid-2" style={{ gap: 12 }}>
          <Field label="Start date" required>
            <Input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              icon="calendar"
            />
          </Field>
          <Field label="End date" required error={dateError}>
            <Input
              type="date"
              value={endDate}
              min={startDate}
              onChange={e => setEndDate(e.target.value)}
              icon="calendar"
            />
          </Field>
        </div>

        <button type="submit" style={{ display: "none" }} aria-hidden="true" />
      </form>
    </Modal>
  );
}

window.ViewCampaigns = ViewCampaigns;
