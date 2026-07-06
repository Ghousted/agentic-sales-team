"use client";
import { useApp } from "@/lib/store";
import { updateSettings } from "@/lib/auth/actions";
import { css } from "@/components/primitives";

const TOGGLES: [string, string][] = [
  ["Agent booked a meeting", "t0"],
  ["Agent needs approval", "t1"],
  ["Daily digest email", "t2"],
];
const inputStyle = "width:100%;border:none;background:#F2F2F2;border-radius:12px;padding:16px 15px;font-size:14px";

export default function SettingsPage() {
  const { s, set } = useApp();

  const persist = (patch: { name?: string; workspaceName?: string; notifications?: Record<string, boolean> }) =>
    updateSettings(patch).catch((e) => console.error("[settings] persist failed:", e));

  const toggle = (key: string) => {
    const next = { ...s.toggles, [key]: !s.toggles[key] };
    set({ toggles: next });
    persist({ notifications: next });
  };

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
      <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:20px 22px;display:flex;flex-direction:column;gap:12px")}>
        <div style={css("font-size:13.5px;font-weight:700")}>Notifications</div>
        {TOGGLES.map(([label, key]) => {
          const on = s.toggles[key];
          return (
            <div key={key} style={css("display:flex;align-items:center;font-size:12.5px;color:#3F3F46")}>
              {label}
              <span
                role="switch"
                aria-checked={on}
                aria-label={label}
                tabIndex={0}
                onClick={() => toggle(key)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(key); } }}
                style={css("margin-left:auto;width:34px;height:20px;border-radius:99px;padding:2px;display:flex;cursor:pointer;transition:background .15s;background:" + (on ? "#5122C1" : "#E4E4E7") + ";justify-content:" + (on ? "flex-end" : "flex-start"))}
              >
                <span style={css("width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.15)")} />
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
