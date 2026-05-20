// view-editor.jsx — Campaign editor (3-column drag/drop).
// Block previews + field editors live in editor-blocks.jsx.

const STARTER_BLOCKS = ["hero", "timer", "products", "capture", "promo"];

function startingBlocks() {
  return STARTER_BLOCKS.map(makeBlock);
}

function renderBlock(b, device) {
  const def = BLOCK_TYPES[b.type];
  if (!def) return <div style={{ padding: 32, textAlign: "center", color: "var(--fg-muted)" }}>Unknown block: {b.type}</div>;
  const Preview = def.Preview;
  return <Preview p={b.props} layout={b.layout} device={device} />;
}

function ViewEditor({ onNavigate }) {
  const toast = useToast();
  const [blocks, setBlocks] = useState(() => startingBlocks());
  const [device, setDevice] = useState("desktop");
  const [selectedId, setSelectedId] = useState(() => null);
  const [campaignName, setCampaignName] = useState("Spring collection launch");
  const [search, setSearch] = useState("");
  const [dropIdx, setDropIdx] = useState(null);
  const [dropEndZone, setDropEndZone] = useState(false);
  const [collapsed, setCollapsed] = useState({}); // prop section collapse state
  const [history, setHistory] = useState({ past: [], future: [] });
  const dragRef = useRef(null);

  // Initial selection after first render (so blocks have IDs)
  useEffect(() => {
    if (!selectedId && blocks.length) setSelectedId(blocks[0].id);
  }, [blocks, selectedId]);

  const selected = blocks.find(b => b.id === selectedId);
  const selectedIdx = blocks.findIndex(b => b.id === selectedId);

  // ── State mutators (with history) ──
  const commit = (next) => {
    setHistory(h => ({ past: [...h.past, blocks].slice(-30), future: [] }));
    setBlocks(next);
  };
  const undo = () => {
    setHistory(h => {
      if (!h.past.length) return h;
      const prev = h.past[h.past.length - 1];
      setBlocks(prev);
      return { past: h.past.slice(0, -1), future: [blocks, ...h.future].slice(0, 30) };
    });
  };
  const redo = () => {
    setHistory(h => {
      if (!h.future.length) return h;
      const next = h.future[0];
      setBlocks(next);
      return { past: [...h.past, blocks].slice(-30), future: h.future.slice(1) };
    });
  };

  const updateProp = (key, value) => {
    if (!selected) return;
    commit(blocks.map(b => b.id === selectedId ? { ...b, props: { ...b.props, [key]: value } } : b));
  };
  const updateLayout = (key, value) => {
    if (!selected) return;
    commit(blocks.map(b => b.id === selectedId ? { ...b, layout: { ...b.layout, [key]: value } } : b));
  };
  const updateVisibility = (key, value) => {
    if (!selected) return;
    commit(blocks.map(b => b.id === selectedId ? { ...b, visibility: { ...b.visibility, [key]: value } } : b));
  };

  const moveBlock = (id, dir) => {
    const i = blocks.findIndex(b => b.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    commit(next);
  };
  const duplicateBlock = (id) => {
    const i = blocks.findIndex(b => b.id === id);
    if (i < 0) return;
    const copy = { ...blocks[i], id: uid() };
    const next = [...blocks];
    next.splice(i + 1, 0, copy);
    commit(next);
    setSelectedId(copy.id);
    toast({ title: "Block duplicated" });
  };
  const deleteBlock = (id) => {
    const i = blocks.findIndex(b => b.id === id);
    commit(blocks.filter(b => b.id !== id));
    if (selectedId === id) {
      const nextSel = blocks[i + 1] || blocks[i - 1];
      setSelectedId(nextSel ? nextSel.id : null);
    }
  };
  const addBlock = (type, atIdx) => {
    const newBlock = makeBlock(type);
    if (!newBlock) return;
    const next = [...blocks];
    next.splice(atIdx ?? blocks.length, 0, newBlock);
    commit(next);
    setSelectedId(newBlock.id);
    toast({ title: `${blockMeta(type)?.name || type} added` });
  };

  // ── Drag handlers ──
  const onLibraryDragStart = (e, type) => {
    dragRef.current = { source: "library", type };
    e.dataTransfer.effectAllowed = "copy";
  };
  const onBlockDragStart = (e, id) => {
    dragRef.current = { source: "block", id };
    e.dataTransfer.effectAllowed = "move";
  };
  const onDragOverGap = (e, idx) => {
    e.preventDefault();
    setDropIdx(idx);
    setDropEndZone(false);
  };
  const onDragOverEndZone = (e) => {
    e.preventDefault();
    setDropEndZone(true);
    setDropIdx(null);
  };
  const onDropAt = (idx) => {
    const d = dragRef.current;
    setDropIdx(null);
    setDropEndZone(false);
    if (!d) return;
    if (d.source === "library") {
      addBlock(d.type, idx);
    } else if (d.source === "block") {
      const fromIdx = blocks.findIndex(b => b.id === d.id);
      if (fromIdx === -1) return;
      const next = [...blocks];
      const [moved] = next.splice(fromIdx, 1);
      const adjusted = fromIdx < idx ? idx - 1 : idx;
      next.splice(adjusted, 0, moved);
      commit(next);
    }
    dragRef.current = null;
  };

  const filteredLibrary = useMemo(() => {
    if (!search.trim()) return BLOCK_LIBRARY;
    const q = search.toLowerCase();
    return BLOCK_LIBRARY.filter(b => b.name.toLowerCase().includes(q));
  }, [search]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const onKey = (e) => {
      const ae = document.activeElement;
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT")) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((e.metaKey || e.ctrlKey) && (e.key === "y" || (e.shiftKey && e.key === "z"))) { e.preventDefault(); redo(); }
      else if ((e.metaKey || e.ctrlKey) && e.key === "d" && selected) { e.preventDefault(); duplicateBlock(selectedId); }
      else if (e.key === "Backspace" && selected) { e.preventDefault(); deleteBlock(selectedId); }
      else if (e.key === "ArrowUp" && (e.metaKey || e.ctrlKey) && selected) { e.preventDefault(); moveBlock(selectedId, -1); }
      else if (e.key === "ArrowDown" && (e.metaKey || e.ctrlKey) && selected) { e.preventDefault(); moveBlock(selectedId, 1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, selectedId, blocks, history]);

  return (
    <div style={{ padding: "20px 24px 32px" }}>
      <EditorTopBar
        campaignName={campaignName}
        setCampaignName={setCampaignName}
        device={device}
        setDevice={setDevice}
        onNavigate={onNavigate}
        onUndo={undo}
        onRedo={redo}
        canUndo={history.past.length > 0}
        canRedo={history.future.length > 0}
        toast={toast}
      />

      <div className="editor-shell">
        {/* LEFT — Block library */}
        <div className="editor-col">
          <div className="editor-col-head">
            <span>Blocks · Drag onto canvas</span>
          </div>
          <div style={{ padding: "10px 12px 0" }}>
            <div className="block-search">
              <Input
                icon="search"
                placeholder="Search blocks…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="editor-blocks scroll">
            {filteredLibrary.length === 0 ? (
              <div className="block-palette-empty">No blocks match "{search}"</div>
            ) : filteredLibrary.map(b => (
              <div key={b.id}
                   className="block-item"
                   draggable
                   onDragStart={(e) => onLibraryDragStart(e, b.id)}
                   onClick={() => addBlock(b.id)}
                   title={`Click or drag to add ${b.name}`}>
                <div className="block-item-icon"><Icon name={b.icon} /></div>
                <span style={{ flex: 1 }}>{b.name}</span>
                <span className={`tone-pill ${b.tone || "neutral"}`}></span>
              </div>
            ))}
          </div>
          <div style={{ padding: "10px 12px", borderTop: "1px solid var(--border-soft)", fontSize: 10.5, color: "var(--fg-subtle)", fontFamily: "var(--ff-mono)", textTransform: "uppercase", letterSpacing: ".06em" }}>
            {blocks.length} block{blocks.length !== 1 ? "s" : ""} on page
          </div>
        </div>

        {/* CENTER — Canvas */}
        <div className="editor-canvas scroll">
          <div className="editor-frame" data-device={device}>
            {blocks.length === 0 && (
              <div className="canvas-empty">
                <Icon name="layers" size={28} />
                <div className="mt-2 strong">Empty canvas</div>
                <div className="text-sm mt-2">Drag blocks from the left to start composing your landing page.</div>
              </div>
            )}

            {blocks.length > 0 && (
              <div
                className={`drop-indicator ${dropIdx === 0 ? "active" : ""}`}
                onDragOver={(e) => onDragOverGap(e, 0)}
                onDrop={(e) => { e.preventDefault(); onDropAt(0); }}
                onDragLeave={() => setDropIdx(null)}
                style={{ height: 14 }}
              ></div>
            )}

            {blocks.map((b, idx) => {
              const isSelected = selectedId === b.id;
              const hiddenOnThisDevice =
                (device === "mobile" && !b.visibility?.mobile) ||
                (device !== "mobile" && !b.visibility?.desktop);
              return (
                <React.Fragment key={b.id}>
                  <div
                    className={[
                      "canvas-block",
                      isSelected && "selected",
                      hiddenOnThisDevice && "hidden-on-device",
                    ].filter(Boolean).join(" ")}
                    draggable
                    onDragStart={(e) => onBlockDragStart(e, b.id)}
                    onClick={() => setSelectedId(b.id)}
                    data-padding={!THEMED_BLOCKS.has(b.type) ? b.layout?.padding : null}
                    data-align={!THEMED_BLOCKS.has(b.type) ? b.layout?.align : null}
                    data-bg={!THEMED_BLOCKS.has(b.type) ? b.layout?.bg : null}
                  >
                    {hiddenOnThisDevice && (
                      <div className="hidden-badge">
                        <Icon name="eye-off" size={10} /> Hidden
                      </div>
                    )}
                    {isSelected && (
                      <BlockToolbar
                        block={b}
                        canUp={idx > 0}
                        canDown={idx < blocks.length - 1}
                        onMoveUp={() => moveBlock(b.id, -1)}
                        onMoveDown={() => moveBlock(b.id, 1)}
                        onDuplicate={() => duplicateBlock(b.id)}
                        onDelete={() => deleteBlock(b.id)}
                      />
                    )}
                    {renderBlock(b, device)}
                  </div>
                  <div
                    className={`drop-indicator ${dropIdx === idx + 1 ? "active" : ""}`}
                    onDragOver={(e) => onDragOverGap(e, idx + 1)}
                    onDrop={(e) => { e.preventDefault(); onDropAt(idx + 1); }}
                    onDragLeave={() => setDropIdx(null)}
                    style={{ height: 14 }}
                  ></div>
                </React.Fragment>
              );
            })}

            <div
              className={`canvas-add-zone ${dropEndZone ? "dropping" : ""}`}
              onDragOver={onDragOverEndZone}
              onDrop={(e) => { e.preventDefault(); onDropAt(blocks.length); }}
              onDragLeave={() => setDropEndZone(false)}
            >
              <Icon name="plus" size={14} />
              {dropEndZone ? "Drop to add here" : "Drag a block here, or click one on the left"}
            </div>
          </div>

          <div className="text-xs muted mt-4" style={{ textAlign: "center" }}>
            URL: <span style={{ fontFamily: "var(--ff-mono)" }}>qrflow.app/c/aurora/{campaignName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")}</span>
          </div>
        </div>

        {/* RIGHT — Properties */}
        <div className="editor-col">
          <div className="editor-col-head">
            {selected ? (
              <span>{blockMeta(selected.type)?.name || selected.type} · Properties</span>
            ) : (
              <span>Properties</span>
            )}
          </div>
          <div className="scroll" style={{ overflow: "auto", flex: 1 }}>
            {!selected ? (
              <div className="empty">
                <div className="empty-icon"><Icon name="panel-left" /></div>
                <div className="empty-title">Nothing selected</div>
                <div className="empty-desc">Click a block in the canvas to edit its content, style, and visibility.</div>
              </div>
            ) : (
              <PropertiesPanel
                block={selected}
                updateProp={updateProp}
                updateLayout={updateLayout}
                updateVisibility={updateVisibility}
                onDelete={() => deleteBlock(selected.id)}
                onDuplicate={() => duplicateBlock(selected.id)}
                collapsed={collapsed}
                setCollapsed={setCollapsed}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════ Top bar ════════════════════════ */

function EditorTopBar({ campaignName, setCampaignName, device, setDevice, onNavigate, onUndo, onRedo, canUndo, canRedo, toast }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-3">
        <Button size="sm" variant="ghost" icon="chevron-left" onClick={() => onNavigate("campaigns")}>Campaigns</Button>
        <span className="muted">/</span>
        <input
          value={campaignName}
          onChange={e => setCampaignName(e.target.value)}
          style={{
            border: "1px solid transparent",
            background: "transparent",
            fontFamily: "var(--ff-display)",
            fontWeight: 600,
            fontSize: 18,
            letterSpacing: "-0.018em",
            color: "var(--fg-strong)",
            padding: "4px 8px",
            borderRadius: 6,
            outline: "none",
            width: 320,
          }}
          onFocus={e => e.target.style.background = "var(--bg-sunken)"}
          onBlur={e => e.target.style.background = "transparent"}
        />
        <Badge tone="warning" dot>Draft</Badge>
      </div>
      <div className="flex gap-2 items-center">
        <Button size="sm" variant="ghost" disabled={!canUndo} onClick={onUndo} title="Undo (⌘Z)"><Icon name="undo" size={13} /></Button>
        <Button size="sm" variant="ghost" disabled={!canRedo} onClick={onRedo} title="Redo (⌘⇧Z)"><Icon name="redo" size={13} /></Button>
        <div style={{ width: 1, height: 22, background: "var(--border)", margin: "0 4px" }}></div>
        <Segmented
          value={device}
          onChange={setDevice}
          options={[
            { value: "desktop", label: "", icon: "monitor" },
            { value: "tablet",  label: "", icon: "tablet" },
            { value: "mobile",  label: "", icon: "smartphone" },
          ]}
        />
        <div style={{ width: 1, height: 22, background: "var(--border)", margin: "0 4px" }}></div>
        <Button size="sm" variant="secondary" icon="eye" onClick={() => onNavigate("campaign-public")}>Preview</Button>
        <Button size="sm" variant="secondary" icon="save" onClick={() => toast({ title: "Draft saved" })}>Save</Button>
        <Button size="sm" variant="success" icon="rocket" onClick={() => toast({ title: "Campaign published", desc: "URL copied to clipboard" })}>Publish</Button>
      </div>
    </div>
  );
}

/* ════════════════════════ Block toolbar (top of selected) ════════════════════════ */

function BlockToolbar({ block, canUp, canDown, onMoveUp, onMoveDown, onDuplicate, onDelete }) {
  const meta = blockMeta(block.type);
  const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
  return (
    <div className="block-toolbar" onClick={(e) => e.stopPropagation()}>
      <span className="block-toolbar-label">
        <Icon name={meta?.icon || "type"} size={10} />
        {meta?.name || block.type}
      </span>
      <button className="block-toolbar-btn" disabled={!canUp} onClick={stop(onMoveUp)} title="Move up">
        <Icon name="arrow-up" size={11} />
      </button>
      <button className="block-toolbar-btn" disabled={!canDown} onClick={stop(onMoveDown)} title="Move down">
        <Icon name="arrow-down" size={11} />
      </button>
      <button className="block-toolbar-btn" onClick={stop(onDuplicate)} title="Duplicate">
        <Icon name="copy" size={11} />
      </button>
      <button className="block-toolbar-btn danger" onClick={stop(onDelete)} title="Delete" style={{ marginRight: 4 }}>
        <Icon name="trash" size={11} />
      </button>
    </div>
  );
}

/* ════════════════════════ Properties panel ════════════════════════ */

function PropSection({ label, k, collapsed, setCollapsed, children, defaultOpen = true }) {
  const isCollapsed = collapsed[k] ?? !defaultOpen;
  const toggle = () => setCollapsed(c => ({ ...c, [k]: !isCollapsed }));
  return (
    <div className="prop-section" data-collapsed={isCollapsed ? "true" : "false"}>
      <div className="prop-section-toggle" onClick={toggle}>
        <span className="prop-section-label" style={{ marginBottom: 0 }}>{label}</span>
        <Icon name="chevron-down" size={13} />
      </div>
      <div className="prop-section-body">
        {children}
      </div>
    </div>
  );
}

function BgSwatchPicker({ value, onChange }) {
  return (
    <div className="swatch-row">
      {BG_OPTS.map(o => (
        <div key={o.value}
             className={`swatch ${value === o.value ? "active" : ""}`}
             style={{ background: o.swatch, boxShadow: value === o.value ? `0 0 0 2px var(--accent)` : `0 0 0 1px ${o.border}` }}
             title={o.label}
             onClick={() => onChange(o.value)}></div>
      ))}
    </div>
  );
}

function PropertiesPanel({ block, updateProp, updateLayout, updateVisibility, onDelete, onDuplicate, collapsed, setCollapsed }) {
  const def = BLOCK_TYPES[block.type];
  if (!def) return null;
  const Fields = def.Fields;
  const meta = blockMeta(block.type);
  const isThemed = THEMED_BLOCKS.has(block.type);

  return (
    <>
      {/* Header */}
      <div className="prop-section">
        <div className="flex items-center gap-3">
          <div className="block-item-icon" style={{
            background: meta?.tone === "blue" ? "var(--accent-soft)" :
                        meta?.tone === "violet" ? "var(--violet-soft)" :
                        meta?.tone === "amber" ? "var(--amber-soft)" :
                        meta?.tone === "danger" ? "var(--red-soft)" : "var(--bg-sunken)",
            color: meta?.tone === "blue" ? "var(--accent)" :
                   meta?.tone === "violet" ? "var(--violet)" :
                   meta?.tone === "amber" ? "var(--amber)" :
                   meta?.tone === "danger" ? "var(--red)" : "var(--fg-muted)",
            borderColor: meta?.tone === "blue" ? "var(--accent-border)" :
                         meta?.tone === "violet" ? "var(--violet-border)" :
                         meta?.tone === "amber" ? "var(--amber-border)" :
                         meta?.tone === "danger" ? "var(--red-border)" : "var(--border)",
            width: 32, height: 32,
          }}>
            <Icon name={meta?.icon} size={15} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="strong text-sm">{meta?.name}</div>
            <div className="text-xs muted" style={{ fontFamily: "var(--ff-mono)" }}>id · {block.id}</div>
          </div>
        </div>
      </div>

      {/* Content */}
      <PropSection label="Content" k="content" collapsed={collapsed} setCollapsed={setCollapsed}>
        <Fields p={block.props} set={updateProp} />
      </PropSection>

      {/* Layout — skip for themed blocks (their look is baked in) */}
      {!isThemed && (
        <PropSection label="Layout" k="layout" collapsed={collapsed} setCollapsed={setCollapsed}>
          <div className="prop-row prop-row-h">
            <label>Padding</label>
            <Segmented
              value={block.layout?.padding || "md"}
              onChange={v => updateLayout("padding", v)}
              options={PADDING_OPTS}
            />
          </div>
          <div className="prop-row prop-row-h">
            <label>Alignment</label>
            <Segmented
              value={block.layout?.align || "center"}
              onChange={v => updateLayout("align", v)}
              options={ALIGN_OPTS}
            />
          </div>
          <div className="prop-row">
            <label>Background</label>
            <BgSwatchPicker value={block.layout?.bg || "surface"} onChange={v => updateLayout("bg", v)} />
            <div className="field-hint">
              {BG_OPTS.find(o => o.value === (block.layout?.bg || "surface"))?.label}
            </div>
          </div>
        </PropSection>
      )}

      {/* Visibility */}
      <PropSection label="Visibility" k="visibility" collapsed={collapsed} setCollapsed={setCollapsed} defaultOpen={false}>
        <div className="prop-row prop-row-h">
          <label>
            <Icon name="monitor" size={12} style={{ marginRight: 6, color: "var(--fg-subtle)", verticalAlign: "-2px" }} />
            Show on desktop
          </label>
          <EditorToggle on={block.visibility?.desktop !== false} onChange={v => updateVisibility("desktop", v)} />
        </div>
        <div className="prop-row prop-row-h">
          <label>
            <Icon name="smartphone" size={12} style={{ marginRight: 6, color: "var(--fg-subtle)", verticalAlign: "-2px" }} />
            Show on mobile
          </label>
          <EditorToggle on={block.visibility?.mobile !== false} onChange={v => updateVisibility("mobile", v)} />
        </div>
        <div className="field-hint" style={{ marginTop: 8 }}>
          Hidden blocks render as placeholders in the editor and don't appear in the published page.
        </div>
      </PropSection>

      {/* Actions */}
      <div className="prop-section" style={{ borderBottom: 0 }}>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" icon="copy" onClick={onDuplicate} style={{ flex: 1 }}>
            Duplicate
          </Button>
          <Button size="sm" variant="ghost" icon="trash" onClick={onDelete}
            style={{ color: "var(--red-fg)", flex: 1, border: "1px solid var(--red-border)", background: "var(--red-soft)" }}>
            Delete
          </Button>
        </div>
        <div className="text-xs muted mt-4" style={{ textAlign: "center", fontFamily: "var(--ff-mono)" }}>
          ⌘D duplicate · ⌫ delete · ⌘↑↓ move
        </div>
      </div>
    </>
  );
}

window.ViewEditor = ViewEditor;
