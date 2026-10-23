"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/store";
import { useLiveWork } from "@/lib/useLiveWork";
import { agentNow } from "@/lib/agents/derive";
import { getWorkspaceStats } from "@/lib/workspace/statsActions";
import type { WorkspaceStats } from "@/lib/workspace/stats";
import { statusMeta } from "@/lib/data";
import { av, statusPill } from "@/lib/visuals";
import { css, Box, Btn } from "@/components/primitives";
import { useConfirmClick } from "@/lib/useConfirmClick";

export default function AgentsPage() {
  const { s, agents, deleteAgent } = useApp();
  const router = useRouter();
  const { live } = useLiveWork();
  const del = useConfirmClick();
  const [perAgent, setPerAgent] = useState<WorkspaceStats["perAgent"]>([]);
  useEffect(() => { getWorkspaceStats().then((w) => setPerAgent(w.perAgent), () => {}); }, []);

  return (
    <div className="m-page" style={css("padding:24px 26px;display:flex;flex-direction:column;gap:18px;animation:fadeUp .3s ease")}>
      {agents.length === 0 && (
        <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:44px 18px;display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center")}>
          <div style={css("width:52px;height:52px;border-radius:14px;background:#EAF2FF;display:flex;align-items:center;justify-content:center;font-size:24px")}>🤖</div>
          <div style={css("font-size:15px;font-weight:700")}>No agents yet</div>
          <Btn onClick={() => router.push("/create")} style="margin-top:6px;background:#006AFF;color:#fff;border:none;border-radius:99px;padding:9px 18px;font-size:12.5px;font-weight:600;cursor:pointer" styleHover="background:#0052CC">+ Create your first agent</Btn>
        </div>
      )}
      <div className="m-stack" style={css("display:grid;grid-template-columns:repeat(3,1fr);gap:14px")}>
        {agents.map((a) => {
          const now = agentNow(a.id, live, !!s.paused[a.id]);
          const m = statusMeta(now.status);
          const out = perAgent.find((p) => p.agentId === a.id);
          return (
            <Box
              key={a.id}
              noButton
              onClick={() => router.push("/agents/" + a.id)}
              style="background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:18px;box-shadow:0 1px 3px rgba(24,24,27,.04);transition:transform .15s,box-shadow .15s;cursor:pointer"
              styleHover="transform:translateY(-3px);box-shadow:0 10px 24px rgba(24,24,27,.08)"
            >
              <div style={css("display:flex;align-items:center;gap:12px")}>
                <div style={css(av(a, 42))}>{a.initials}</div>
                <div style={css("min-width:0")}>
                  <div style={css("font-size:14px;font-weight:700")}>{a.name}</div>
                  <div style={css("font-size:12px;color:#71717A")}>{a.role}</div>
                </div>
                <span style={css(statusPill(m))}>
                  <span style={css("width:6px;height:6px;border-radius:50%;background:" + m.dot)} />
                  {m.label}
                </span>
              </div>
              <div style={css("margin-top:14px;background:#FAFAFB;border:1px solid #F0F0F3;border-radius:10px;padding:9px 12px;font-size:12px;color:#52525B;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>
                {now.task}
              </div>
              <div style={css("display:flex;align-items:center;gap:12px;margin-top:14px")}>
                <div style={css("font-size:11px;color:#A1A1AA;line-height:1.5")}>
                  {out ? <><b style={css("color:#18181B")}>{out.leadsWorked}</b> leads · <b style={css("color:#18181B")}>{out.sent}</b> sent</> : "No work yet"}
                </div>
                <div style={css("margin-left:auto;display:flex;gap:6px")}>
                  <Btn
                    onClick={(e) => { e.stopPropagation(); if (del.confirm(a.id)) deleteAgent(a.id); }}
                    aria-label={(del.armed === a.id ? "Confirm delete " : "Delete ") + a.name}
                    style={"color:#B91C1C;border:1px solid #F3C7C7;border-radius:99px;padding:6px 12px;font-size:11.5px;font-weight:600;cursor:pointer;" + (del.armed === a.id ? "background:#FDE8E8" : "background:#fff")}
                    styleHover={del.armed === a.id ? "background:#F9D4D4" : "background:#FEECEC"}
                  >
                    {del.armed === a.id ? "Delete?" : "Delete"}
                  </Btn>
                  <Btn
                    onClick={(e) => { e.stopPropagation(); router.push("/agents/" + a.id); }}
                    style="background:#18181B;color:#fff;border:none;border-radius:99px;padding:6px 13px;font-size:11.5px;font-weight:600;cursor:pointer"
                    styleHover="background:#3F3F46"
                  >
                    Open
                  </Btn>
                </div>
              </div>
            </Box>
          );
        })}
      </div>
    </div>
  );
}
