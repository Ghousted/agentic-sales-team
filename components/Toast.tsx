"use client";
import { useApp } from "@/lib/store";
import { css } from "./primitives";

export default function Toast() {
  const { s } = useApp();
  if (!s.toast) return null;
  return (
    <div
      role={s.toastError ? "alert" : "status"}
      style={css(
        "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);color:#fff;border-radius:99px;padding:11px 22px;font-size:12.5px;font-weight:600;box-shadow:0 8px 24px rgba(24,24,27,.25);animation:toastIn .25s ease;z-index:99;display:flex;align-items:center;gap:9px;" +
          (s.toastError ? "background:#991B1B" : "background:#18181B")
      )}
    >
      <span style={{ color: s.toastError ? "#FECACA" : "#7EE2A8" }}>{s.toastError ? "✕" : "✓"}</span>
      {s.toast}
    </div>
  );
}
