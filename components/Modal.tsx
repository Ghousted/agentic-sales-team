"use client";
// Shared modal: a dimmed overlay plus a role="dialog" card.
// - Escape and a click on the overlay close it.
// - Tab and Shift+Tab stay inside the card (focus trap).
// - On open, focus moves to the first form field (or the card); on close it goes back
//   to whatever had focus before (usually the button that opened it).
// Name the dialog with `labelledBy` (id of the visible title) or `label`.
// `focusField={false}` focuses the card instead of the first field (for detail views,
// so a phone keyboard doesn't pop up).
import React, { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { css, type Style } from "./primitives";

const OVERLAY = "position:fixed;inset:0;background:rgba(24,24,27,.45);z-index:60;display:flex;align-items:center;justify-content:center;padding:24px;animation:fadeUp .2s ease";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function focusablesIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getAttribute("aria-hidden") !== "true");
}

// Where Tab should go when it would leave the card: wrap to the other end.
// Returns null when the browser's own move stays inside the card.
export function wrapTarget<T>(items: T[], current: T | null, shift: boolean): T | null {
  if (items.length === 0) return null;
  const first = items[0];
  const last = items[items.length - 1];
  const i = current === null ? -1 : items.indexOf(current);
  if (shift) return i <= 0 ? last : null;
  return i === -1 || i === items.length - 1 ? first : null;
}

interface ModalProps {
  onClose: () => void;
  label?: string;
  labelledBy?: string;
  // Card style; the overlay uses the shared default unless `overlayStyle` is given.
  style?: Style;
  overlayStyle?: Style;
  className?: string;
  focusField?: boolean;
  children?: ReactNode;
}

export default function Modal({ onClose, label, labelledBy, style, overlayStyle, className, focusField = true, children }: ModalProps) {
  const card = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const root = card.current;
    if (root && !root.contains(document.activeElement)) {
      const field = !focusField ? null : root.querySelector<HTMLElement>("input:not([disabled]):not([type=hidden]),textarea:not([disabled]),select:not([disabled])");
      (field ?? root).focus();
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab" || !card.current) return;
      const items = focusablesIn(card.current);
      const active = document.activeElement as HTMLElement | null;
      const target = wrapTarget(items, active && card.current.contains(active) ? active : null, e.shiftKey);
      if (target) {
        e.preventDefault();
        target.focus();
      } else if (items.length === 0) {
        e.preventDefault();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (opener && opener.isConnected) opener.focus();
    };
    // Runs once per open. onClose is read through a ref, and focusField only matters on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div onClick={() => closeRef.current()} style={css(overlayStyle ?? OVERLAY)}>
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={className}
        style={{ outline: "none", ...css(style) }}
      >
        {children}
      </div>
    </div>
  );
}
