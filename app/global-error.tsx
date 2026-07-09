"use client";
// Last-resort boundary for errors thrown in the ROOT layout (which segment-level
// error.tsx cannot catch). It replaces the whole document, so it renders its own
// <html>/<body> and relies on the system font stack (the layout's font link is
// gone at this point). The data fetches in layout.tsx are already hardened to not
// throw; this is defense-in-depth for anything unexpected.
import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[global error]", error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px", background: "#FAFAFB", fontFamily: "Inter, system-ui, -apple-system, sans-serif", color: "#18181B" }}>
        <div style={{ maxWidth: "460px", textAlign: "center" }}>
          <div style={{ fontFamily: "ui-monospace, monospace", fontSize: "15px", fontWeight: 700, letterSpacing: "-.01em", marginBottom: "24px" }}>
            <span style={{ color: "#5122C1" }}>agentic</span> salesforce
          </div>
          <h1 style={{ fontSize: "22px", fontWeight: 700, letterSpacing: "-.01em", margin: "0 0 10px" }}>Something went wrong</h1>
          <p style={{ fontSize: "15px", color: "#71717A", lineHeight: 1.55, margin: "0 0 26px" }}>
            The app hit an unexpected error while loading. This is usually temporary — please try again.
          </p>
          <div style={{ display: "flex", gap: "10px", justifyContent: "center", flexWrap: "wrap" }}>
            <button
              onClick={() => reset()}
              style={{ background: "#5122C1", color: "#fff", border: "none", borderRadius: "100px", padding: "11px 24px", fontSize: "15px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", boxShadow: "0 2px 8px rgba(81,34,193,.3)" }}
            >
              Try again
            </button>
            <button
              onClick={() => { window.location.href = "/"; }}
              style={{ background: "#fff", color: "#414651", border: "1px solid #E4E4E7", borderRadius: "100px", padding: "11px 24px", fontSize: "15px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
            >
              Reload
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
