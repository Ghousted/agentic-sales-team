"use client";
// Notifications bell + dropdown panel of recent agent activity.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useApp } from "@/lib/store";
import { ACTIVITY_FEED } from "@/lib/data";
import { av, chip } from "@/lib/visuals";
import { css, Box } from "./primitives";

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

  // Live activity (feedExtra) first, then the base feed. Drop deleted agents.
  const items = s.feedExtra
    .concat(ACTIVITY_FEED)
    .map((f) => ({ f, a: byId(f.id) }))
    .filter((x) => x.a)
    .slice(0, 8);
  const unread = !seen && items.length > 0;

  const toggle = () => {
    setOpen((o) => !o);
    setSeen(true);
  };

  return (
    <div ref={ref} style={css("position:relative;flex:none")}>
      <Box
        onClick={toggle}
        aria-label="Notifications"
        style="position:relative;width:48px;height:48px;border-radius:50%;background:#EEE9F8;display:flex;align-items:center;justify-content:center;font-size:18px;color:#5122C1;cursor:pointer"
      >
        ◔
        {unread && <span style={css("position:absolute;top:7px;right:9px;width:9px;height:9px;border-radius:50%;background:#F43F7E;border:2px solid #EEE9F8")} />}
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
                      <span style={css(chip(f.chipBg, f.chipColor))}>{f.chip}</span>
                      <span style={css("font-size:10.5px;color:#A1A1AA")}>{f.time}</span>
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
