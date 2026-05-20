import React, { useCallback, useEffect, useRef, useState } from "react";

/* ── Types ── */
export interface TweakValues {
  theme: "light" | "dark";
  accent: string;
  density: "compact" | "regular";
  sidebarCollapsed: boolean;
}

export const TWEAK_DEFAULTS: TweakValues = {
  theme: "light",
  accent: "#2563EB",
  density: "regular",
  sidebarCollapsed: false,
};

const ACCENT_PRESETS = [
  { value: "#2563EB", name: "Blue"    },
  { value: "#7C3AED", name: "Violet"  },
  { value: "#16A34A", name: "Emerald" },
  { value: "#D97706", name: "Amber"   },
  { value: "#DB2777", name: "Pink"    },
];

/* ── Helpers ── */
function isLight(hex: string) {
  const h = hex.replace("#", "").padEnd(6, "0");
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return true;
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return r * 299 + g * 587 + b * 114 > 148000;
}

/* ── CSS ── */
const PANEL_CSS = `
.twk-panel {
  position: fixed; right: 16px; bottom: 16px; z-index: 9999;
  width: 272px; max-height: calc(100vh - 32px);
  display: flex; flex-direction: column;
  background: rgba(250,249,247,.82); color: #29261b;
  -webkit-backdrop-filter: blur(24px) saturate(160%);
  backdrop-filter: blur(24px) saturate(160%);
  border: .5px solid rgba(255,255,255,.65);
  border-radius: 14px;
  box-shadow: 0 1px 0 rgba(255,255,255,.5) inset, 0 12px 40px rgba(0,0,0,.2);
  font: 12px/1.4 ui-sans-serif, system-ui, -apple-system, sans-serif;
  overflow: hidden;
  user-select: none;
}
html[data-theme="dark"] .twk-panel {
  background: rgba(22, 26, 34, .88);
  color: #e6e9ef;
  border-color: rgba(255,255,255,.08);
}
.twk-hd {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 8px 10px 14px; cursor: move;
}
.twk-hd b { font-size: 12px; font-weight: 600; letter-spacing: .01em; }
.twk-x {
  appearance: none; border: 0; background: transparent;
  color: rgba(41,38,27,.5); width: 22px; height: 22px;
  border-radius: 6px; cursor: default; font-size: 13px; line-height: 1;
}
.twk-x:hover { background: rgba(0,0,0,.07); color: #29261b; }
html[data-theme="dark"] .twk-x { color: rgba(230,233,239,.5); }
html[data-theme="dark"] .twk-x:hover { background: rgba(255,255,255,.07); color: #e6e9ef; }
.twk-body {
  padding: 0 14px 14px; display: flex; flex-direction: column; gap: 10px;
  overflow-y: auto; min-height: 0;
  scrollbar-width: thin; scrollbar-color: rgba(0,0,0,.15) transparent;
}
.twk-sect {
  font-size: 9.5px; font-weight: 600; letter-spacing: .07em;
  text-transform: uppercase; color: rgba(41,38,27,.4); padding: 10px 0 0;
}
html[data-theme="dark"] .twk-sect { color: rgba(150,160,175,.6); }
.twk-sect:first-child { padding-top: 0; }
.twk-row { display: flex; flex-direction: column; gap: 5px; }
.twk-row-h { flex-direction: row; align-items: center; justify-content: space-between; }
.twk-lbl { font-weight: 500; font-size: 11.5px; color: rgba(41,38,27,.75); }
html[data-theme="dark"] .twk-lbl { color: rgba(230,233,239,.7); }
.twk-toggle {
  position: relative; width: 32px; height: 18px; border: 0; border-radius: 999px;
  background: rgba(0,0,0,.18); transition: background .15s; cursor: default; padding: 0; flex-shrink: 0;
}
.twk-toggle[data-on="1"] { background: #34c759; }
.twk-toggle i {
  position: absolute; top: 2px; left: 2px; width: 14px; height: 14px;
  border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.25);
  transition: transform .15s; pointer-events: none;
}
.twk-toggle[data-on="1"] i { transform: translateX(14px); }
.twk-seg {
  position: relative; display: flex; padding: 2px; border-radius: 8px;
  background: rgba(0,0,0,.07);
}
html[data-theme="dark"] .twk-seg { background: rgba(255,255,255,.07); }
.twk-seg-thumb {
  position: absolute; top: 2px; bottom: 2px; border-radius: 6px;
  background: rgba(255,255,255,.9); box-shadow: 0 1px 2px rgba(0,0,0,.12);
  transition: left .15s cubic-bezier(.3,.7,.4,1), width .15s;
  pointer-events: none;
}
html[data-theme="dark"] .twk-seg-thumb { background: rgba(255,255,255,.12); }
.twk-seg button {
  appearance: none; position: relative; z-index: 1; flex: 1; border: 0;
  background: transparent; color: inherit; font: inherit; font-weight: 500; font-size: 11.5px;
  min-height: 22px; border-radius: 6px; cursor: default; padding: 3px 6px; line-height: 1.2;
}
.twk-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.twk-chip {
  position: relative; flex: none; width: 28px; height: 28px;
  border: 0; border-radius: 8px; overflow: hidden; cursor: default;
  box-shadow: 0 0 0 .5px rgba(0,0,0,.14), 0 1px 2px rgba(0,0,0,.08);
  transition: transform .12s, box-shadow .12s;
}
.twk-chip:hover { transform: translateY(-1px); box-shadow: 0 0 0 .5px rgba(0,0,0,.2), 0 4px 10px rgba(0,0,0,.14); }
.twk-chip[data-on="1"] { box-shadow: 0 0 0 2px var(--accent, #2563eb), 0 2px 6px rgba(0,0,0,.15); }
.twk-chip-check {
  position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none;
}
.twk-open-btn {
  position: fixed; right: 16px; bottom: 16px; z-index: 9998;
  width: 36px; height: 36px; border-radius: 50%;
  background: var(--bg-surface, #fff); border: 1px solid var(--border, #E7EAEF);
  box-shadow: 0 2px 8px rgba(0,0,0,.12);
  display: grid; place-items: center;
  cursor: default; transition: all .14s;
  color: var(--fg-muted, #5B6573);
}
.twk-open-btn:hover { background: var(--bg-hover, #F4F5F8); color: var(--fg-strong, #050912); transform: scale(1.06); }
`;

/* ── TweaksPanel component ── */
interface TweaksPanelProps {
  values: TweakValues;
  onChange: (key: keyof TweakValues, value: TweakValues[keyof TweakValues]) => void;
}

export function TweaksPanel({ values, onChange }: TweaksPanelProps) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef({ x: 16, y: 16 });
  const PAD = 16;

  const clamp = useCallback(() => {
    const p = panelRef.current;
    if (!p) return;
    const w = p.offsetWidth, h = p.offsetHeight;
    offsetRef.current = {
      x: Math.min(window.innerWidth - w - PAD,  Math.max(PAD, offsetRef.current.x)),
      y: Math.min(window.innerHeight - h - PAD, Math.max(PAD, offsetRef.current.y)),
    };
    p.style.right  = offsetRef.current.x + "px";
    p.style.bottom = offsetRef.current.y + "px";
  }, []);

  useEffect(() => {
    if (!open) return;
    clamp();
    window.addEventListener("resize", clamp);
    return () => window.removeEventListener("resize", clamp);
  }, [open, clamp]);

  const onDragStart = (e: React.MouseEvent) => {
    const p = panelRef.current;
    if (!p) return;
    const r = p.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY;
    const startR = window.innerWidth - r.right;
    const startB = window.innerHeight - r.bottom;
    const move = (ev: MouseEvent) => {
      offsetRef.current = { x: startR - (ev.clientX - sx), y: startB - (ev.clientY - sy) };
      clamp();
    };
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const n = 2; // density options count
  const densityIdx = values.density === "compact" ? 0 : 1;

  if (!open) {
    return (
      <>
        <style>{PANEL_CSS}</style>
        <button className="twk-open-btn" onClick={() => setOpen(true)} title="Open tweaks panel" aria-label="Open tweaks">
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="8" cy="8" r="3"/>
            <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.22 3.22l1.42 1.42M11.36 11.36l1.42 1.42M11.36 4.64l-1.42 1.42M4.64 11.36l-1.42 1.42"/>
          </svg>
        </button>
      </>
    );
  }

  return (
    <>
      <style>{PANEL_CSS}</style>
      <div
        ref={panelRef}
        className="twk-panel"
        style={{ right: offsetRef.current.x, bottom: offsetRef.current.y }}
      >
        {/* Header */}
        <div className="twk-hd" onMouseDown={onDragStart}>
          <b>Tweaks</b>
          <button className="twk-x" onMouseDown={e => e.stopPropagation()} onClick={() => setOpen(false)}>✕</button>
        </div>

        <div className="twk-body">
          {/* Theme */}
          <div className="twk-sect">Theme</div>

          <div className="twk-row twk-row-h">
            <div className="twk-lbl">Dark mode</div>
            <button
              className="twk-toggle"
              data-on={values.theme === "dark" ? "1" : "0"}
              onClick={() => onChange("theme", values.theme === "dark" ? "light" : "dark")}
              aria-label="Toggle dark mode"
            >
              <i />
            </button>
          </div>

          {/* Accent color */}
          <div className="twk-sect">Accent</div>
          <div className="twk-row">
            <div className="twk-lbl">Color</div>
            <div className="twk-chips">
              {ACCENT_PRESETS.map(p => (
                <button
                  key={p.value}
                  className="twk-chip"
                  data-on={values.accent === p.value ? "1" : "0"}
                  onClick={() => onChange("accent", p.value)}
                  style={{ background: p.value }}
                  title={p.name}
                  aria-label={p.name}
                >
                  {values.accent === p.value && (
                    <div className="twk-chip-check">
                      <svg viewBox="0 0 14 14" width="14" height="14">
                        <path
                          d="M3 7.2 5.8 10 11 4.2"
                          fill="none"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          stroke={isLight(p.value) ? "rgba(0,0,0,.78)" : "#fff"}
                        />
                      </svg>
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Density */}
          <div className="twk-sect">Layout</div>
          <div className="twk-row">
            <div className="twk-lbl">Density</div>
            <div className="twk-seg">
              <div
                className="twk-seg-thumb"
                style={{
                  left: `calc(2px + ${densityIdx} * (100% - 4px) / ${n})`,
                  width: `calc((100% - 4px) / ${n})`,
                }}
              />
              {(["compact", "regular"] as const).map(d => (
                <button key={d} onClick={() => onChange("density", d)} style={{ textTransform: "capitalize" }}>
                  {d}
                </button>
              ))}
            </div>
          </div>

          <div className="twk-row twk-row-h">
            <div className="twk-lbl">Collapse sidebar</div>
            <button
              className="twk-toggle"
              data-on={values.sidebarCollapsed ? "1" : "0"}
              onClick={() => onChange("sidebarCollapsed", !values.sidebarCollapsed)}
              aria-label="Toggle sidebar"
            >
              <i />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
