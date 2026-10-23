"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/** Next state of a two-click confirm: the first click on `key` arms it, a
 *  second click on the same key fires it, a click on another key re-arms. */
export function confirmStep(armed: string | null, key: string): { armed: string | null; fire: boolean } {
  return armed === key ? { armed: null, fire: true } : { armed: key, fire: false };
}

/** Two-click confirm for destructive buttons, the same pattern as lead delete:
 *  `confirm(key)` returns false and arms on the first click (show "Delete?"),
 *  and true on a second click within `ms`. Auto-disarms after `ms`. */
export function useConfirmClick(ms = 3000) {
  const [armed, setArmed] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const confirm = useCallback((key: string): boolean => {
    if (timer.current) clearTimeout(timer.current);
    const next = confirmStep(armed, key);
    setArmed(next.armed);
    if (next.armed) timer.current = setTimeout(() => setArmed(null), ms);
    return next.fire;
  }, [armed, ms]);
  return { armed, confirm };
}
