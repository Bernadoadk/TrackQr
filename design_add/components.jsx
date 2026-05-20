// components.jsx — shared UI primitives used by all views.

const { useState, useEffect, useRef, useMemo, useCallback } = React;

/* ───────────── Button ───────────── */
function Button({ variant = "secondary", size = "md", icon, iconRight, children, onClick, type = "button", className = "", ...props }) {
  const cls = [
    "btn",
    `btn-${variant}`,
    size === "sm" ? "btn-sm" : size === "lg" ? "btn-lg" : "",
    !children ? "btn-icon" : "",
    className,
  ].filter(Boolean).join(" ");
  return (
    <button type={type} className={cls} onClick={onClick} {...props}>
      {icon && <Icon name={icon} />}
      {children}
      {iconRight && <Icon name={iconRight} />}
    </button>
  );
}

/* ───────────── Badge ───────────── */
function Badge({ tone = "neutral", children, dot = false, live = false, className = "" }) {
  return (
    <span className={`badge ${tone} ${live ? "live" : ""} ${className}`}>
      {(dot || live) && <span className="dot"></span>}
      {children}
    </span>
  );
}

/* ───────────── Card ───────────── */
function Card({ accent, children, className = "", hoverLift = false, ...props }) {
  const cls = ["card", accent && `accent-top accent-${accent}`, hoverLift && "hover-lift", className]
    .filter(Boolean).join(" ");
  return <div className={cls} {...props}>{children}</div>;
}

function CardHead({ title, subtitle, actions, accent }) {
  return (
    <div className="card-head">
      <div>
        <div className="card-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {accent && <span style={{
            width: 6, height: 6, borderRadius: "50%",
            background: `var(--${accent === "blue" ? "accent" : accent})`,
            boxShadow: `0 0 8px var(--${accent === "blue" ? "accent" : accent})`
          }}></span>}
          {title}
        </div>
        {subtitle && <div className="card-sub">{subtitle}</div>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

/* ───────────── StatCard ───────────── */
function StatCard({ accent = "blue", label, value, icon, delta, deltaTone = "up", sub, sparklineData }) {
  return (
    <div className="stat" data-accent={accent}>
      <div className="stat-head">
        <div className="stat-label">{label}</div>
        <div className="stat-icon"><Icon name={icon} size={17} /></div>
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-meta">
        {delta && (
          <span className={`stat-delta ${deltaTone}`}>
            <Icon name={deltaTone === "up" ? "arrow-up" : "arrow-down"} size={11} />
            {delta}
          </span>
        )}
        {sub && <span>{sub}</span>}
      </div>
      {sparklineData && <Sparkline data={sparklineData} accent={accent} />}
    </div>
  );
}

/* ───────────── Sparkline ───────────── */
function Sparkline({ data, accent = "blue", height = 30 }) {
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const w = 100;
  const h = height;
  const step = w / (data.length - 1 || 1);
  const points = data.map((v, i) => {
    const x = i * step;
    const y = h - ((v - min) / (max - min || 1)) * h * 0.85 - h * 0.075;
    return [x, y];
  });
  const linePath = "M " + points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L ");
  const areaPath = linePath + ` L ${w},${h} L 0,${h} Z`;
  const accentVar = accent === "blue" ? "var(--accent)" : `var(--${accent})`;
  const gradId = "spark-" + accent;
  return (
    <svg className="stat-sparkline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={accentVar} stopOpacity="0.25" />
          <stop offset="100%" stopColor={accentVar} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} />
      <path d={linePath} fill="none" stroke={accentVar} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/* ───────────── Input field ───────────── */
function Field({ label, required, hint, error, children, className = "" }) {
  return (
    <div className={`field ${className}`.trim()}>
      {label && (
        <label className="field-label">
          {label}{required && <span className="req">*</span>}
        </label>
      )}
      {children}
      {error && <div className="field-hint" style={{ color: "var(--red-fg)" }}>{error}</div>}
      {hint && !error && <div className="field-hint">{hint}</div>}
    </div>
  );
}

function Input({ icon, ...props }) {
  if (icon) {
    return (
      <div className="input-icon">
        <Icon name={icon} />
        <input className="input" {...props} />
      </div>
    );
  }
  return <input className="input" {...props} />;
}

function Select({ children, ...props }) {
  return <select className="select" {...props}>{children}</select>;
}

function Textarea(props) {
  return <textarea className="textarea" {...props}></textarea>;
}

/* ───────────── Tabs ───────────── */
function Tabs({ value, onChange, tabs }) {
  return (
    <div className="tabs">
      {tabs.map(t => (
        <div key={t.value}
             className={`tab ${value === t.value ? "active" : ""}`}
             onClick={() => onChange(t.value)}>
          {t.label}
        </div>
      ))}
    </div>
  );
}

/* ───────────── Segmented ───────────── */
function Segmented({ value, onChange, options }) {
  return (
    <div className="segmented">
      {options.map(o => (
        <button key={o.value}
                className={value === o.value ? "active" : ""}
                onClick={() => onChange(o.value)}>
          {o.icon && <Icon name={o.icon} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ───────────── Empty state ───────────── */
function EmptyState({ icon = "inbox", title, desc, cta }) {
  return (
    <div className="empty">
      <div className="empty-icon"><Icon name={icon} size={24} /></div>
      <div className="empty-title">{title}</div>
      {desc && <div className="empty-desc">{desc}</div>}
      {cta}
    </div>
  );
}

/* ───────────── Modal / Dialog ───────────── */
function Modal({ open, onClose, title, subtitle, icon, accent = "blue", size = "md", children, footer, dismissible = true }) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => { if (e.key === "Escape" && dismissible) onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, dismissible, onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={dismissible ? onClose : undefined}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        className={`modal modal-${size}`}
        data-accent={accent}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="modal-head-left">
            {icon && (
              <div className="modal-icon" data-accent={accent}>
                <Icon name={icon} size={17} />
              </div>
            )}
            <div className="modal-head-text">
              {title && <div className="modal-title">{title}</div>}
              {subtitle && <div className="modal-sub">{subtitle}</div>}
            </div>
          </div>
          {dismissible && (
            <button className="modal-close" onClick={onClose} aria-label="Close">
              <Icon name="x" size={15} />
            </button>
          )}
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* ───────────── Toast system ───────────── */
const ToastContext = React.createContext(null);

function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((toast) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(t => [...t, { id, ...toast }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), toast.duration || 3800);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toast-stack">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.tone || ""}`}>
            <div className="toast-icon">
              <Icon name={
                t.tone === "error" ? "circle-alert" :
                t.tone === "warning" ? "alert-triangle" :
                t.tone === "info" ? "info" : "circle-check"
              } size={16} />
            </div>
            <div className="toast-body">
              <div className="toast-title">{t.title}</div>
              {t.desc && <div className="toast-desc">{t.desc}</div>}
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function useToast() { return React.useContext(ToastContext); }

/* ───────────── QR generator ───────────── */
function generateQrSvg(text, opts = {}) {
  const {
    size = 200,
    margin = 2,
    fg = "#0B1220",
    bg = "#FFFFFF",
    style = "square",
    cornerStyle = "square",
    logo = null,
  } = opts;

  if (!window.qrcode) return null;
  try {
    const qr = window.qrcode(0, "M");
    qr.addData(text || "QR Flow placeholder");
    qr.make();
    const count = qr.getModuleCount();
    const cell = (size - margin * 2) / count;
    const radius =
      style === "dot" ? cell * 0.45 :
      style === "rounded" ? cell * 0.30 :
      style === "classy" ? cell * 0.18 : 0;

    const isFinder = (r, c) => {
      if (r < 7 && c < 7) return true;
      if (r < 7 && c >= count - 7) return true;
      if (r >= count - 7 && c < 7) return true;
      return false;
    };

    let modules = "";
    let finders = "";
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (qr.isDark(r, c)) {
          const x = margin + c * cell;
          const y = margin + r * cell;
          if (isFinder(r, c)) continue;
          if (style === "dot") {
            modules += `<circle cx="${(x + cell / 2).toFixed(2)}" cy="${(y + cell / 2).toFixed(2)}" r="${(cell * 0.42).toFixed(2)}"/>`;
          } else if (radius > 0) {
            modules += `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}" rx="${radius.toFixed(2)}"/>`;
          } else {
            modules += `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}"/>`;
          }
        }
      }
    }

    // finders
    const corners = [[0, 0], [count - 7, 0], [0, count - 7]];
    const fr = cornerStyle === "rounded" ? cell * 1.3 : cornerStyle === "extra-rounded" ? cell * 2 : 0;
    corners.forEach(([cc, rr]) => {
      const x = margin + cc * cell;
      const y = margin + rr * cell;
      const outer = cell * 7;
      finders += `<rect x="${x}" y="${y}" width="${outer}" height="${outer}" rx="${fr}" fill="${fg}"/>`;
      finders += `<rect x="${x + cell}" y="${y + cell}" width="${cell * 5}" height="${cell * 5}" rx="${Math.max(0, fr - cell)}" fill="${bg}"/>`;
      finders += `<rect x="${x + cell * 2}" y="${y + cell * 2}" width="${cell * 3}" height="${cell * 3}" rx="${Math.max(0, fr - cell * 2)}" fill="${fg}"/>`;
    });

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="100%" height="100%">
      <rect width="${size}" height="${size}" fill="${bg}"/>
      <g fill="${fg}">${modules}</g>
      ${finders}
      ${logo ? `<g transform="translate(${size/2 - 18}, ${size/2 - 18})">
        <rect width="36" height="36" rx="8" fill="${bg}" stroke="${fg}" stroke-width="0.5"/>
        <rect x="4" y="4" width="28" height="28" rx="6" fill="${logo}"/>
      </g>` : ""}
    </svg>`;
  } catch (e) {
    return null;
  }
}

function QrSvg({ text, size = 200, ...opts }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    const svg = generateQrSvg(text, { size, ...opts });
    if (svg) ref.current.innerHTML = svg;
  }, [text, size, opts.fg, opts.bg, opts.style, opts.cornerStyle, opts.logo]);
  return <div ref={ref} style={{ width: "100%", height: "100%", display: "grid", placeItems: "center" }}></div>;
}

/* ───────────── Toploader hook ───────────── */
function useToploader() {
  const [active, setActive] = useState(false);
  const trigger = useCallback(() => {
    setActive(false);
    setTimeout(() => {
      setActive(true);
      setTimeout(() => setActive(false), 700);
    }, 10);
  }, []);
  return [active, trigger];
}

/* ───────────── Format helpers ───────────── */
function fmt(n) {
  if (n >= 10000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return n.toLocaleString("en-US");
}
function fmtPct(n, digits = 1) { return n.toFixed(digits) + "%"; }
function fmtRel(date) {
  const diff = Date.now() - date;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

Object.assign(window, {
  Button, Badge, Card, CardHead, StatCard, Sparkline,
  Field, Input, Select, Textarea, Tabs, Segmented, EmptyState, Modal,
  ToastProvider, useToast, QrSvg, generateQrSvg, useToploader,
  fmt, fmtPct, fmtRel,
});
