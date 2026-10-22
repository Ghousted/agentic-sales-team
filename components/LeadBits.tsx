"use client";
import { useEffect, useState } from "react";
import { css } from "./primitives";
import { ensureFitReason } from "@/lib/leads/actions";
import { av } from "@/lib/visuals";
import type { Agent } from "@/lib/types";
import type { LeadDTO } from "@/lib/leads/types";

/** Overlapping avatars of the agents that have worked a lead (top 3). */
export function WorkedBy({ ids, byId }: { ids: string[]; byId: (id: string) => Agent | undefined }) {
  const agents = ids.map(byId).filter(Boolean).slice(0, 3) as Agent[];
  if (agents.length === 0) return null;
  return (
    <div style={css("display:flex;align-items:center")} title={"Worked by " + agents.map((a) => a.name).join(" · ")}>
      {agents.map((a, i) => (
        <div key={a.id} style={css(av(a, 18) + ";border:1.5px solid #fff;" + (i === 0 ? "" : "margin-left:-6px"))}>{a.initials}</div>
      ))}
    </div>
  );
}

/** Pulsing "who's on it now" badge; renders nothing when not active. */
export function LivePulse({ info }: { info?: { agentName: string; capability: string } }) {
  if (!info) return null;
  const verb = info.capability === "research" ? "researching" : info.capability === "outreach" ? "drafting" : info.capability;
  return (
    <span style={css("display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:600;color:#1B7A3D;background:#E7F7EC;border-radius:99px;padding:2px 9px;white-space:nowrap")}>
      <span style={css("width:6px;height:6px;border-radius:50%;background:#2FA45C;animation:pulse 1.4s ease-in-out infinite")} />
      {info.agentName.split(" ")[0]} {verb}…
    </span>
  );
}

/** Why the agent thinks the lead fits (or, once dismissed, why it does not). A
 *  lead with no reason yet (saved before reasons existed) gets one written now. */
export function FitReason({ lead: l }: { lead: Pick<LeadDTO, "id" | "fitReason" | "review" | "score"> }) {
  const [written, setWritten] = useState<{ id: string; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (l.fitReason) return;
    let alive = true;
    setLoading(true);
    ensureFitReason(l.id)
      .then((text) => { if (alive) setWritten({ id: l.id, text }); })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [l.id, l.fitReason]);
  const reason = l.fitReason || (written?.id === l.id ? written.text : "");
  if (!reason && !loading && !(l.score > 0)) return null;
  const dismissed = l.review === "dismissed";
  return (
    <div style={css("background:" + (dismissed ? "#F7F7F8" : "#F1FAF4") + ";border:1px solid " + (dismissed ? "#ECECF1" : "#D7F0E0") + ";border-radius:12px;padding:12px 14px")}>
      <div style={css("display:flex;align-items:center;gap:8px;margin-bottom:5px")}>
        <div style={css("font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:" + (dismissed ? "#71717A" : "#1B7A3D"))}>{dismissed ? "Why it was dismissed" : "Why it fits"}</div>
        {l.score > 0 && !dismissed && <span style={css("margin-left:auto;font-size:12px;font-weight:600;color:#1B7A3D")}>Fit {l.score}/100</span>}
      </div>
      <div style={css("font-size:13.5px;line-height:1.55;color:" + (reason ? "#27272A" : "#8a94a3"))}>{reason || (loading ? "Checking why it fits…" : "The Assessor scored this lead but gave no reason.")}</div>
    </div>
  );
}
