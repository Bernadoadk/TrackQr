import React from "react";

interface CardProps {
  accent?: "blue" | "violet" | "green" | "amber";
  children?: React.ReactNode;
  className?: string;
  hoverLift?: boolean;
  style?: React.CSSProperties;
  onClick?: () => void;
}

export function Card({ accent, children, className = "", hoverLift, style, onClick }: CardProps) {
  const cls = [
    "card",
    accent && "accent-top",
    accent && `accent-${accent}`,
    hoverLift && "hover-lift",
    className,
  ].filter(Boolean).join(" ");
  if (onClick) {
    return (
      <div
        className={cls}
        style={style}
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={e => {
          if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
          e.preventDefault();
          onClick();
        }}
      >
        {children}
      </div>
    );
  }
  return <div className={cls} style={style}>{children}</div>;
}

interface CardHeadProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  accent?: string;
}

export function CardHead({ title, subtitle, actions, accent }: CardHeadProps) {
  return (
    <div className="card-head">
      <div>
        <div className="card-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {accent && (
            <span style={{
              width: 6, height: 6, borderRadius: "50%",
              background: `var(--${accent === "blue" ? "accent" : accent})`,
              boxShadow: `0 0 8px var(--${accent === "blue" ? "accent" : accent})`,
              flexShrink: 0,
            }} />
          )}
          {title}
        </div>
        {subtitle && <div className="card-sub">{subtitle}</div>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}
