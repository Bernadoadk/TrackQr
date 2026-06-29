import { useEffect } from "react";
import { Icon } from "./Icon";
import { Button } from "./Button";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
  loading = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !loading) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [loading, onClose, open]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onMouseDown={() => !loading && onClose()}>
      <div
        className="modal confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
        onMouseDown={event => event.stopPropagation()}
      >
        <div className="modal-head">
          <div className="confirm-dialog-head">
            <div className={`confirm-dialog-icon ${tone}`}>
              <Icon name={tone === "danger" ? "trash" : "circle-check"} size={17} />
            </div>
            <div>
              <div id="confirm-dialog-title" className="modal-title">{title}</div>
              <div id="confirm-dialog-description" className="modal-sub">{description}</div>
            </div>
          </div>
          <button className="modal-close" onClick={onClose} disabled={loading} aria-label="Close confirmation dialog">
            <Icon name="x" size={15} />
          </button>
        </div>
        <div className="modal-foot">
          <Button variant="ghost" onClick={onClose} disabled={loading}>{cancelLabel}</Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} disabled={loading}>
            {loading ? "Please wait..." : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
