import { useEffect, useRef } from 'react';

/**
 * Confirmation modal for destructive actions.
 *
 * Deliberately not a native <dialog> — Safari support for showModal() is recent
 * enough that a plain overlay is the safer bet, and we need custom styling anyway.
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  detail,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  busy = false,
  onConfirm,
  onCancel,
}) {
  const cancelRef = useRef(null);

  // Escape closes. Registered on document so it works regardless of focus.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  // Focus Cancel, not Delete — the safe option should be the default target so
  // a stray Enter keypress can't destroy anything.
  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  // Stop the page behind the modal from scrolling.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={() => !busy && onCancel()}
      role="presentation"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-3xl border border-white/15 bg-[#161228] p-8 shadow-2xl"
      >
        <h3 id="confirm-title" className="text-2xl font-bold text-white mb-3">
          {title}
        </h3>

        <p id="confirm-message" className="text-indigo-200/90 mb-2">
          {message}
        </p>

        {detail && (
          <p className="text-sm text-amber-200/80 mb-6">{detail}</p>
        )}

        <div className="flex gap-3 justify-end mt-8">
          <button
            ref={cancelRef}
            onClick={onCancel}
            disabled={busy}
            className="px-6 py-3 rounded-xl font-semibold text-indigo-200 bg-white/5 hover:bg-white/10
                       focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-all disabled:opacity-40"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="px-6 py-3 rounded-xl font-bold text-white bg-red-600 hover:bg-red-500
                       focus:outline-none focus:ring-2 focus:ring-red-400 transition-all
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? 'Deleting…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
