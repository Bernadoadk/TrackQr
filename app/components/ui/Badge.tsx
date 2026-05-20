import React from "react";

type BadgeTone = "neutral" | "brand" | "violet" | "success" | "warning" | "danger";

interface BadgeProps {
  tone?: BadgeTone;
  dot?: boolean;
  live?: boolean;
  className?: string;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

export function Badge({ tone = "neutral", dot, live, className = "", children, style }: BadgeProps) {
  return (
    <span className={["badge", tone, live ? "live" : "", className].filter(Boolean).join(" ")} style={style}>
      {(dot || live) && <span className="dot" />}
      {children}
    </span>
  );
}
