"use client";
import { useEffect } from "react";

// Text fields match :focus-visible on a mouse click too, so CSS alone can't show
// a ring for keyboard users only. This marks <html data-kbd> while the user is
// moving focus with Tab, and clears it on any pointer press; app/globals.css
// draws the field focus ring only under html[data-kbd].

type Handler = (e: { key?: string }) => void;
/** The bits of document the tracker needs, so tests can pass a fake. */
export interface ModalityDoc {
  documentElement: { dataset: Record<string, string | undefined> };
  addEventListener(t: "keydown" | "pointerdown", l: Handler, capture: boolean): void;
  removeEventListener(t: "keydown" | "pointerdown", l: Handler, capture: boolean): void;
}

/** Start tracking keyboard vs pointer use. Returns a stop function. */
export function startKeyboardModality(doc: ModalityDoc): () => void {
  const onKey: Handler = (e) => {
    if (e.key === "Tab") doc.documentElement.dataset.kbd = "";
  };
  const onPointer: Handler = () => {
    delete doc.documentElement.dataset.kbd;
  };
  doc.addEventListener("keydown", onKey, true);
  doc.addEventListener("pointerdown", onPointer, true);
  return () => {
    doc.removeEventListener("keydown", onKey, true);
    doc.removeEventListener("pointerdown", onPointer, true);
    delete doc.documentElement.dataset.kbd;
  };
}

export function useKeyboardModality(): void {
  useEffect(() => startKeyboardModality(document as unknown as ModalityDoc), []);
}
