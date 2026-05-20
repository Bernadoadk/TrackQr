import React from "react";
import { Icon } from "./Icon";

interface EmptyStateProps {
  icon?: string;
  title: string;
  desc?: string;
  cta?: React.ReactNode;
}

export function EmptyState({ icon = "inbox", title, desc, cta }: EmptyStateProps) {
  return (
    <div className="empty">
      <div className="empty-icon"><Icon name={icon} size={24} /></div>
      <div className="empty-title">{title}</div>
      {desc && <div className="empty-desc">{desc}</div>}
      {cta}
    </div>
  );
}
