"use client";
import { css } from "./primitives";
import { av } from "@/lib/visuals";
import type { Agent } from "@/lib/types";

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
