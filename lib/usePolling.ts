"use client";
import { useEffect, useRef } from "react";

type Listener = () => void;
/** The bits of window/document the poller needs, so tests can pass fakes. */
export interface PollEnv {
  win: { addEventListener(t: "focus", l: Listener): void; removeEventListener(t: "focus", l: Listener): void };
  doc: {
    visibilityState: string;
    addEventListener(t: "visibilitychange", l: Listener): void;
    removeEventListener(t: "visibilitychange", l: Listener): void;
  };
}

/** Run `fn` now, every `intervalMs` while the tab is visible, and when the tab
 *  regains focus or becomes visible. Skips a tick while the previous run is
 *  still in flight. Returns a stop function. */
export function startPolling(fn: () => Promise<unknown>, intervalMs: number, env: PollEnv): () => void {
  let running = false;
  let stopped = false;
  const run = () => {
    if (stopped || running || env.doc.visibilityState !== "visible") return;
    running = true;
    Promise.resolve()
      .then(fn)
      .catch(() => { /* temporary error. Try again on the next tick. */ })
      .finally(() => { running = false; });
  };
  run();
  const iv = setInterval(run, intervalMs);
  env.win.addEventListener("focus", run);
  env.doc.addEventListener("visibilitychange", run);
  return () => {
    stopped = true;
    clearInterval(iv);
    env.win.removeEventListener("focus", run);
    env.doc.removeEventListener("visibilitychange", run);
  };
}

/** startPolling for a component: runs while mounted, always calls the latest `fn`. */
export function usePolling(fn: () => Promise<unknown>, intervalMs: number) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(
    () => startPolling(() => fnRef.current(), intervalMs, { win: window, doc: document }),
    [intervalMs],
  );
}
