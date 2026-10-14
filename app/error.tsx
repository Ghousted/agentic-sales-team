"use client";
// Segment error boundary: catches runtime errors in a routed page (e.g. the
// dashboard or a detail page) and shows a graceful retry inside the app shell
// instead of a raw crash. Does NOT catch root-layout errors — see global-error.tsx.
import { useEffect } from "react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[route error]", error);
  }, [error]);

  return (
    <div style={{ minHeight: "70vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px", fontFamily: "Inter, system-ui, sans-serif", color: "#18181B" }}>
      <div style={{ maxWidth: "440px", textAlign: "center" }}>
        <div style={{ width: "56px", height: "56px", borderRadius: "16px", background: "#EEF4FF", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 18px" }} aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
        <h2 style={{ fontSize: "20px", fontWeight: 700, letterSpacing: "-.01em", margin: "0 0 8px" }}>This page didn’t load</h2>
        <p style={{ fontSize: "14px", color: "#71717A", lineHeight: 1.55, margin: "0 0 22px" }}>
          A temporary hiccup — nothing was lost. Try again, and if it keeps happening, reload the page.
        </p>
        <button
          onClick={() => reset()}
          style={{ background: "#2563EB", color: "#fff", border: "none", borderRadius: "100px", padding: "10px 22px", fontSize: "14px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", boxShadow: "0 2px 8px rgba(37,99,235,.3)" }}
        >
          Try again
        </button>
      </div>
    </div>
  );
}
