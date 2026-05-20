import React from "react";
import { Icon } from "./Icon";

interface FieldProps {
  label?: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children?: React.ReactNode;
  className?: string;
}

export function Field({ label, required, hint, error, children, className = "" }: FieldProps) {
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

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: string;
}

export function Input({ icon, className = "", ...props }: InputProps) {
  if (icon) {
    return (
      <div className="input-icon">
        <Icon name={icon} />
        <input className={`input ${className}`.trim()} {...props} />
      </div>
    );
  }
  return <input className={`input ${className}`.trim()} {...props} />;
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  children: React.ReactNode;
}

export function Select({ children, className = "", ...props }: SelectProps) {
  return (
    <select className={`select ${className}`.trim()} {...props}>
      {children}
    </select>
  );
}

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

export function Textarea({ className = "", ...props }: TextareaProps) {
  return <textarea className={`textarea ${className}`.trim()} {...props} />;
}
