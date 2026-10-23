"use client";
import { useEffect, useState } from "react";

/** Phones and small tablets. Keep in step with the @media block in app/globals.css. */
export const MOBILE_QUERY = "(max-width: 767px)";

/** The bits of a MediaQueryList the hook needs, so tests can pass fakes. */
export interface MediaList {
  matches: boolean;
  addEventListener(t: "change", l: () => void): void;
  removeEventListener(t: "change", l: () => void): void;
}

/** Call `onChange` with the current match now and on every change. Returns a stop function. */
export function watchMedia(mq: MediaList, onChange: (matches: boolean) => void): () => void {
  const on = () => onChange(mq.matches);
  on();
  mq.addEventListener("change", on);
  return () => mq.removeEventListener("change", on);
}

/** False on the server and on the first client render, so it never causes a
 *  hydration mismatch. Layout that must be right on first paint uses the CSS
 *  classes in globals.css instead. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => watchMedia(window.matchMedia(query), setMatches), [query]);
  return matches;
}

export const useIsMobile = () => useMediaQuery(MOBILE_QUERY);
