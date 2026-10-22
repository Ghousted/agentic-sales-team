"use client";
import { useApp } from "@/lib/store";
import { updateSettings } from "@/lib/auth/actions";
import { css } from "@/components/primitives";

// Notification toggles (meeting booked / needs approval / daily digest) are
// hidden: the app has no email or notification sender, so nothing reads them.
// Saved values in users.notifications are left as they are.
const inputStyle = "width:100%;border:none;background:#F2F2F2;border-radius:12px;padding:16px 15px;font-size:14px";

export default function SettingsPage() {
  const { s, set } = useApp();

  const persist = (patch: { name?: string; workspaceName?: string }) =>
    updateSettings(patch).catch((e) => console.error("[settings] persist failed:", e));

  return (
    <div style={css("padding:24px 26px;display:flex;flex-direction:column;gap:18px;max-width:680px;animation:fadeUp .3s ease")}>
      <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:20px 22px;display:flex;flex-direction:column;gap:16px")}>
        <div style={css("font-size:13.5px;font-weight:700")}>Workspace</div>
        <div>
          <div style={css("font-size:12px;font-weight:600;color:#3F3F46;margin-bottom:6px")}>Workspace name</div>
          <input aria-label="Workspace name" value={s.workspaceName} onChange={(e) => set({ workspaceName: e.target.value })} onBlur={(e) => persist({ workspaceName: e.target.value })} style={css(inputStyle)} />
        </div>
        <div>
          <div style={css("font-size:12px;font-weight:600;color:#3F3F46;margin-bottom:6px")}>Your name</div>
          <input aria-label="Your name" value={s.userName} onChange={(e) => set({ userName: e.target.value })} onBlur={(e) => persist({ name: e.target.value })} style={css(inputStyle)} />
        </div>
      </div>
    </div>
  );
}
