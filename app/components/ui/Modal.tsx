import { useEffect, type ReactNode } from "react";
import { Icon } from "./Icon";
import { t } from "../../lib/i18n";

interface ModalProps {
  open: boolean;
  title: string;
  subtitle?: string;
  children?: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  /** Wider layout for content-heavy dialogs. */
  wide?: boolean;
}

/** App modal (same look as ConfirmDialog): Escape and backdrop click close it. */
export function Modal({ open, title, subtitle, children, footer, onClose, wide }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${wide ? "modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-modal-title"
      >
        <div className="modal-head">
          <div>
            <div id="app-modal-title" className="modal-title">{title}</div>
            {subtitle && <div className="modal-sub">{subtitle}</div>}
          </div>
          <button className="modal-close" onClick={onClose} aria-label={t("Close")}>
            <Icon name="x" size={15} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
