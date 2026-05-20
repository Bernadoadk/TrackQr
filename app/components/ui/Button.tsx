import React from "react";
import { Icon } from "./Icon";

interface ButtonProps {
  variant?: "primary" | "secondary" | "ghost" | "success" | "danger" | "outline";
  size?: "sm" | "md" | "lg";
  icon?: string;
  iconRight?: string;
  children?: React.ReactNode;
  onClick?: () => void;
  type?: "button" | "submit" | "reset";
  className?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
  title?: string;
}

export function Button({
  variant = "secondary",
  size,
  icon,
  iconRight,
  children,
  onClick,
  type = "button",
  className = "",
  disabled,
  style,
  title,
}: ButtonProps) {
  const cls = [
    "btn",
    `btn-${variant}`,
    size === "sm" ? "btn-sm" : size === "lg" ? "btn-lg" : "",
    !children ? "btn-icon" : "",
    className,
  ].filter(Boolean).join(" ");

  return (
    <button type={type} className={cls} onClick={onClick} disabled={disabled} style={style} title={title}>
      {icon && <Icon name={icon} />}
      {children}
      {iconRight && <Icon name={iconRight} />}
    </button>
  );
}
