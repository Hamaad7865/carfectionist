"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    // Phones get a bottom sheet (thumb-reachable, keyboard-safe with dvh); sm and up a centred card.
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-[rgba(15,23,32,0.38)] backdrop-blur-[2px]" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative z-10 flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[20px] border border-line bg-card shadow-[0_30px_80px_-20px_rgba(15,23,32,0.4)] sm:max-h-[88dvh] sm:rounded-[18px] ${wide ? "sm:max-w-2xl" : "sm:max-w-md"}`}
      >
        <span aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line-2 sm:hidden" />
        <div className="flex items-start gap-3 border-b border-line px-5 pb-4 pt-2.5 sm:pt-4">
          <div className="min-w-0 flex-1">
            <div className="font-display text-[16px] font-extrabold text-ink-strong">{title}</div>
            {subtitle && <div className="mt-0.5 text-[12px] text-muted">{subtitle}</div>}
          </div>
          <button onClick={onClose} aria-label="Close" className="-mr-1.5 grid size-10 shrink-0 place-items-center rounded-[9px] text-faint hover:bg-sub hover:text-body sm:mr-0 sm:size-8">
            <X size={17} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
        {footer ? (
          <div className="border-t border-line bg-sub px-5 pt-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))]">{footer}</div>
        ) : (
          <div className="shrink-0 pb-[env(safe-area-inset-bottom)] sm:hidden" />
        )}
      </div>
    </div>
  );
}
