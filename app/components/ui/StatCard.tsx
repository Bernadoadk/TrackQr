import React from "react";
import { Icon } from "./Icon";

interface SparklineProps {
  data: number[];
  accent?: string;
}

function Sparkline({ data, accent = "blue" }: SparklineProps) {
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const w = 100;
  const h = 30;
  const step = w / (data.length - 1 || 1);
  const points = data.map((v, i) => {
    const x = i * step;
    const y = h - ((v - min) / (max - min || 1)) * h * 0.85 - h * 0.075;
    return [x, y] as [number, number];
  });
  const linePath = "M " + points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L ");
  const areaPath = linePath + ` L ${w},${h} L 0,${h} Z`;
  const accentVar = accent === "blue" ? "var(--accent)" : `var(--${accent})`;
  const gradId = `spark-${accent}`;
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

interface StatCardProps {
  accent?: "blue" | "violet" | "green" | "amber";
  label: string;
  value: string | number;
  icon: string;
  delta?: string;
  deltaTone?: "up" | "down";
  sub?: string;
  sparklineData?: number[];
}

export function StatCard({ accent = "blue", label, value, icon, delta, deltaTone = "up", sub, sparklineData }: StatCardProps) {
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
