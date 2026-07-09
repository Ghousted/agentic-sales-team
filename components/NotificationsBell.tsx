"use client";
// Notifications bell + dropdown panel of recent agent activity.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useApp } from "@/lib/store";
import { listActivity } from "@/lib/workspace/statsActions";
import type { ActivityItem } from "@/lib/workspace/stats";
import { av, chip } from "@/lib/visuals";
import { css, Box } from "./primitives";

const ACT_CHIP: Record<string, { label: string; bg: string; fg: string }> = {
  lead_added: { label: "Lead", bg: "#E7F7EC", fg: "#1B7A3D" },
  lead_researched: { label: "Research", bg: "#F1EDFD", fg: "#5122C1" },
  email_drafted: { label: "Draft", bg: "#FEF6E8", fg: "#B45309" },
  email_sent: { label: "Sent", bg: "#E9F5FE", fg: "#0369A1" },
};
function actChip(type: string) { return ACT_CHIP[type] ?? { label: type, bg: "#F4F4F5", fg: "#71717A" }; }
function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "now"; if (m < 60) return m + "m"; const h = Math.round(m / 60);
  if (h < 24) return h + "h"; return Math.round(h / 24) + "d";
}

export default function NotificationsBell() {
  const { s, byId, agents } = useApp();
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on click outside the bell + panel. Use "click" (not "mousedown") so a
  // click on a Link row navigates before the panel unmounts.
  useEffect(() => {
    if (!open) return;
    const onClickAway = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", onClickAway);
    return () => document.removeEventListener("click", onClickAway);
  }, [open]);

  const [acts, setActs] = useState<ActivityItem[]>([]);
  useEffect(() => { listActivity(12).then(setActs); }, []);
  const items = acts.map((f) => ({ f, a: byId(f.agentId) })).filter((x) => x.a);
  const unread = !seen && items.length > 0;

  const toggle = () => {
    setOpen((o) => !o);
    setSeen(true);
  };

  return (
    <div ref={ref} style={css("position:relative;flex:none")}>
      <Box
        onClick={toggle}
        aria-label={unread ? items.length + " new notifications" : "Notifications"}
        style="position:relative;width:48px;height:48px;border-radius:50%;background:#EEE9F8;display:flex;align-items:center;justify-content:center;color:#5122C1;cursor:pointer"
        styleHover="background:#E3DBF9"
      >
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={{ transformOrigin: "50% 4px", animation: unread ? "iconRing 1.1s ease-in-out" : undefined }}>
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread && <span style={css("position:absolute;top:5px;right:5px;min-width:17px;height:17px;padding:0 4px;border-radius:99px;background:#F43F7E;color:#fff;font-size:10px;font-weight:700;line-height:1;display:flex;align-items:center;justify-content:center;border:2px solid #EEE9F8")}>{items.length}</span>}
      </Box>

      {open && (
          <div style={css("position:absolute;top:56px;right:0;width:360px;background:#fff;border:1px solid #ECECF1;border-radius:14px;box-shadow:0 12px 32px rgba(24,24,27,.14);z-index:40;overflow:hidden")}>
            <div style={css("display:flex;align-items:center;padding:14px 16px;border-bottom:1px solid #F0F0F3")}>
              <div style={css("font-size:13.5px;font-weight:700")}>Notifications</div>
              <div style={css("margin-left:auto;font-size:11px;font-weight:600;color:#1B7A3D;background:#E7F7EC;border-radius:99px;padding:2px 9px")}>{agents.filter((a) => a.status === "working").length} live</div>
            </div>
            <div style={css("max-height:60vh;overflow-y:auto")}>
              {items.length === 0 ? (
                <div style={css("padding:16px;font-size:12.5px;color:#A1A1AA")}>No recent activity.</div>
              ) : (
                items.map(({ f, a }, i) => (
                  <Link
                    key={i}
                    href={"/agents/" + a!.id}
                    onClick={() => setOpen(false)}
                    style={{ ...css("display:flex;align-items:center;gap:11px;padding:11px 16px;border-bottom:1px solid #F4F4F6;cursor:pointer;text-decoration:none") }}
                  >
                    <div style={css(av(a!, 32))}>{a!.initials}</div>
                    <div style={css("font-size:12.5px;color:#52525B;min-width:0;flex:1")}>
                      <strong style={{ color: "#18181B", fontWeight: 600 }}>{a!.name}</strong> {f.text}
                    </div>
                    <div style={css("display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex:none")}>
                      <span style={css(chip(actChip(f.type).bg, actChip(f.type).fg))}>{actChip(f.type).label}</span>
                      <span style={css("font-size:10.5px;color:#A1A1AA")}>{relTime(f.createdAt)}</span>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>
      )}
    </div>
  );
}
