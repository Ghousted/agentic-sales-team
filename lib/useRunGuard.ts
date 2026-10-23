"use client";
import { useCallback, useRef, useState } from "react";

/** Run `fn` unless `key` is already in flight. A second call while the first
 *  is running returns false at once (a double click starts nothing). A throw
 *  goes to `onError` and `onEnd` always runs, so a spinner can't stick. */
export async function guardedRun(
  inFlight: Set<string>,
  key: string,
  fn: () => Promise<unknown>,
  hooks: { onStart?: () => void; onEnd?: () => void; onError?: (e: unknown) => void } = {},
): Promise<boolean> {
  if (inFlight.has(key)) return false;
  inFlight.add(key);
  hooks.onStart?.();
  try {
    await fn();
  } catch (e) {
    hooks.onError?.(e);
  } finally {
    inFlight.delete(key);
    hooks.onEnd?.();
  }
  return true;
}

/** Per-key busy state for action buttons. The ref blocks a second click before
 *  React re-renders; `busy[key]` drives `disabled` and the button label. */
export function useRunGuard(onError: (e: unknown) => void) {
  const inFlight = useRef(new Set<string>());
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const run = useCallback((key: string, fn: () => Promise<unknown>) => guardedRun(inFlight.current, key, fn, {
    onStart: () => setBusy((b) => ({ ...b, [key]: true })),
    onEnd: () => setBusy((b) => ({ ...b, [key]: false })),
    onError,
  }), [onError]);
  return { busy, run };
}
