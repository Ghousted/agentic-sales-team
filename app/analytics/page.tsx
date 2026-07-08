"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/store";
import { getWorkspaceStats, listActivity } from "@/lib/workspace/statsActions";
import type { WorkspaceStats, ActivityItem } from "@/lib/workspace/stats";
import { av, chip } from "@/lib/visuals";
import { css, Box } from "@/components/primitives";

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

const compareColors = ["#5122C1", "#F43F7E", "#F59E0B", "#0EA5E9"];
const filters = ["Last 30 days", "All teams", "All roles"];
const timeSlots = ["3:00p", "4:30p", "6:00p", "7:15p"];

export default function AnalyticsPage() {
  const { s, agents, teams, byId, showToast } = useApp();
  const router = useRouter();
  const activeCount = agents.filter((a) => a.status === "working").length;

  const [ws, setWs] = useState<WorkspaceStats | null>(null);
  const [acts, setActs] = useState<ActivityItem[]>([]);
  useEffect(() => { getWorkspaceStats().then(setWs); listActivity(8).then(setActs); }, []);
  const paMap = new Map((ws?.perAgent ?? []).map((p) => [p.agentId, p]));

  // ----- Real aggregates derived from the live agents + teams -----
  const waitingCount = agents.filter((a) => a.status === "waiting").length;
  const attentionCount = agents.filter((a) => a.status === "error" || a.status === "offline").length;

  const metricDefs: [string, string, string, string, boolean][] = [
    ["Active Agents", String(ws?.activeAgents ?? 0), "of " + agents.length, (ws?.tasksRunning ?? 0) + " running", true],
    ["Leads Worked", String(ws?.leadsWorked ?? 0), "accepted", "▲ pipeline", true],
    ["Emails Sent", String(ws?.sent ?? 0), "of " + (ws?.drafted ?? 0) + " drafts", "▲ outreach", true],
    ["Reply Rate", (ws?.replyRate ?? 0) + "%", "", (ws?.replyRate ?? 0) >= 20 ? "▲ healthy" : "building", (ws?.replyRate ?? 0) >= 20],
  ];

  const orgKpiDefs: [string, string, string][] = [
    ["Leads worked", String(ws?.leadsWorked ?? 0), "▲ accepted"],
    ["Drafts", String(ws?.drafted ?? 0), "▲ written"],
    ["Sent", String(ws?.sent ?? 0), "▲ outreach"],
    ["Reply rate", (ws?.replyRate ?? 0) + "%", "▲ engaged"],
  ];

  const teamLeads = (t: typeof teams[number]) => t.members.reduce((n, id) => n + (paMap.get(id)?.leadsWorked ?? 0), 0);
  const maxTeamLeads = Math.max(1, ...teams.map(teamLeads));

  // Upcoming tasks = what the working agents are actually doing right now.
  const upcoming = agents.filter((a) => a.status === "working").slice(0, 4).map((a, i) => ({
    label: a.name.split(" ")[0] + " · " + a.task,
    time: timeSlots[i] || "—",
    c: a.color,
  }));

  // Activity feed: real workspace activity; drop any deleted agents.
  const feed = acts.map((f) => ({ f, a: byId(f.agentId) })).filter((x) => x.a).slice(0, 6);

  // Recent conversations = agents the user has actually chatted with.
  const recentConvs = Object.keys(s.chats)
    .map((id) => byId(id))
    .filter((a) => a && (s.chats[a.id] || []).length > 0)
    .slice(0, 4);

  const ranking = agents.slice().sort((a, b) => (paMap.get(b.id)?.leadsWorked ?? 0) - (paMap.get(a.id)?.leadsWorked ?? 0)).slice(0, 5);

  return (
    <div style={css("padding:24px 26px;display:flex;flex-direction:column;gap:20px;animation:fadeUp .3s ease")}>
      <div style={css("display:flex;align-items:center;gap:12px;flex-wrap:wrap")}>
        <div style={css("font-size:13px;color:#71717A")}>{ws?.activeAgents ?? 0} agents active · {ws?.leadsWorked ?? 0} leads worked · {ws?.sent ?? 0} emails sent</div>
        <div style={css("margin-left:auto;display:flex;gap:8px")}>
          {filters.map((f) => <Box key={f} onClick={() => showToast("Filter: " + f)} style="font-size:12.5px;font-weight:600;color:#5122C1;background:#EEE9F8;border:none;border-radius:99px;padding:8px 16px;cursor:pointer" styleHover="background:#E3DBF9">{f} ⌄</Box>)}
        </div>
      </div>

      {/* metric cards */}
      <div style={css("display:grid;grid-template-columns:repeat(4,1fr);gap:14px")}>
        {metricDefs.map((d) => (
          <Box key={d[0]} style="background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:22px 18px;display:flex;flex-direction:column;align-items:center;text-align:center;transition:transform .15s,box-shadow .15s;cursor:default" styleHover="transform:translateY(-2px);box-shadow:0 6px 16px rgba(24,24,27,.07)">
            <div style={css("font-size:14px;font-weight:600;color:#606B79")}>{d[0]}</div>
            <div style={css("display:flex;align-items:baseline;gap:8px;margin-top:10px")}><span style={css("font-size:34px;font-weight:700;letter-spacing:-.02em;color:#18181B")}>{d[1]}</span><span style={css("font-size:12px;color:#A1A1AA")}>{d[2]}</span></div>
            <div style={css("display:inline-block;font-size:11px;font-weight:600;border-radius:99px;padding:2px 8px;margin-top:8px;width:fit-content;" + (d[4] ? "color:#1B7A3D;background:#E7F7EC" : "color:#B45309;background:#FDEBCB"))}>{d[3]}</div>
          </Box>
        ))}
      </div>

      {/* activity + side column */}
      <div style={css("display:grid;grid-template-columns:1fr 320px;gap:14px;align-items:start")}>
        <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;box-shadow:0 1px 3px rgba(24,24,27,.04)")}>
          <div style={css("display:flex;align-items:center;padding:14px 18px;border-bottom:1px solid #F0F0F3")}>
            <div style={css("font-size:13.5px;font-weight:700")}>Agent activity</div>
            <div style={css("margin-left:auto;display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;color:#1B7A3D;background:#E7F7EC;border-radius:99px;padding:3px 10px")}><span style={css("width:6px;height:6px;border-radius:50%;background:#2FA45C;animation:pulse 2s infinite")} />Live</div>
          </div>
          <div style={css("display:flex;flex-direction:column")}>
            {feed.map(({ f, a }, i) => (
              <div key={i} style={css("display:flex;align-items:center;gap:12px;padding:12px 18px;border-bottom:1px solid #F4F4F6;animation:fadeUp .35s ease")}>
                <div style={css(av(a!, 30))}>{a!.initials}</div>
                <div style={css("font-size:12.5px;color:#52525B")}><strong style={{ color: "#18181B", fontWeight: 600 }}>{a!.name}</strong> {f.text}</div>
                <div style={css("margin-left:auto;display:flex;align-items:center;gap:8px;flex:none")}><span style={css(chip(actChip(f.type).bg, actChip(f.type).fg))}>{actChip(f.type).label}</span><span style={css("font-size:11px;color:#A1A1AA")}>{relTime(f.createdAt)}</span></div>
              </div>
            ))}
          </div>
        </div>
        <div style={css("display:flex;flex-direction:column;gap:14px")}>
          <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:15px 18px;box-shadow:0 1px 3px rgba(24,24,27,.04)")}>
            <div style={css("font-size:13.5px;font-weight:700;margin-bottom:11px")}>Upcoming tasks</div>
            <div style={css("display:flex;flex-direction:column;gap:10px")}>
              {upcoming.map((u) => <div key={u.label} style={css("display:flex;gap:9px;align-items:center;font-size:12px;color:#3F3F46")}><span style={css("width:8px;height:8px;border-radius:3px;background:" + u.c + ";flex:none")} />{u.label}<span style={css("margin-left:auto;color:#A1A1AA;font-size:11px")}>{u.time}</span></div>)}
            </div>
          </div>
          <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:15px 18px;box-shadow:0 1px 3px rgba(24,24,27,.04)")}>
            <div style={css("font-size:13.5px;font-weight:700;margin-bottom:11px")}>Recent conversations</div>
            <div style={css("display:flex;flex-direction:column;gap:11px")}>
              {recentConvs.map((a) => {
                const msgs = s.chats[a!.id] || [];
                const last = msgs[msgs.length - 1];
                return (
                  <Box key={a!.id} onClick={() => router.push("/chats?agent=" + a!.id)} style="display:flex;gap:10px;align-items:center;cursor:pointer;border-radius:10px;padding:4px;margin:-4px" styleHover="background:#F8F7FB">
                    <div style={css(av(a!, 26))}>{a!.initials}</div>
                    <div style={css("min-width:0")}><div style={css("font-size:12px;font-weight:600")}>{a!.name}</div><div style={css("font-size:11px;color:#A1A1AA;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{(last ? last.text : "").slice(0, 38)}…</div></div>
                  </Box>
                );
              })}
            </div>
          </div>
          <Box onClick={() => router.push("/chats")} style="background:#1B1140;border-radius:16px;padding:16px 18px;color:#fff;cursor:pointer;transition:transform .15s" styleHover="transform:translateY(-2px)">
            <div style={css("font-size:13px;font-weight:700")}>Ask your workforce</div>
            <div style={css('font-size:11.5px;color:#C9B8F5;margin-top:3px')}>&quot;Who should we contact next?&quot;</div>
            <div style={css("display:inline-block;background:#fff;color:#5122C1;border-radius:99px;padding:6px 14px;font-size:11.5px;font-weight:700;margin-top:11px")}>Open chat →</div>
          </Box>
        </div>
      </div>

      {/* outreach trend */}
      <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:18px;box-shadow:0 1px 3px rgba(24,24,27,.04)")}>
        <div style={css("display:flex;align-items:baseline;gap:10px;margin-bottom:14px")}>
          <div style={css("font-size:13.5px;font-weight:700")}>Outreach trend</div>
          <div style={css("font-size:11px;color:#A1A1AA")}>Last 14 days</div>
          <div style={css("margin-left:auto;display:flex;gap:12px;font-size:11px;color:#71717A")}>
            <span style={css("display:flex;align-items:center;gap:5px")}><span style={css("width:8px;height:8px;border-radius:3px;background:#5122C1")} />Drafts</span>
            <span style={css("display:flex;align-items:center;gap:5px")}><span style={css("width:8px;height:8px;border-radius:3px;background:#F43F7E")} />Sent</span>
          </div>
        </div>
        <div style={css("display:flex;align-items:flex-end;gap:10px;height:120px")}>
          {(ws?.daily ?? []).map((d, i) => {
            const max = Math.max(1, ...(ws?.daily ?? []).map((x) => x.drafted + x.sent));
            return (
              <div key={i} style={css("flex:1;display:flex;flex-direction:column;gap:2px;justify-content:flex-end;height:100%")}>
                <div style={css("background:#5122C1;border-radius:4px 4px 0 0;height:" + Math.round((d.drafted / max) * 90) + "%")} />
                <div style={css("background:#F9BDD3;border-radius:0 0 4px 4px;height:" + Math.round((d.sent / max) * 90) + "%")} />
              </div>
            );
          })}
        </div>
      </div>

      {/* ===== Organization ===== */}
      <div style={css("font-family:'Poetsen One',sans-serif;font-size:15px;font-weight:700")}>Organization</div>
      <div style={css("display:grid;grid-template-columns:repeat(4,1fr);gap:14px")}>
        {orgKpiDefs.map((k) => (
          <div key={k[0]} style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:22px 18px;display:flex;flex-direction:column;align-items:center;text-align:center")}>
            <div style={css("font-size:14px;font-weight:600;color:#606B79")}>{k[0]}</div>
            <div style={css("font-size:34px;font-weight:700;margin-top:8px;letter-spacing:-.02em;color:#18181B")}>{k[1]}</div>
            <div style={css("display:inline-block;font-size:11px;color:#1B7A3D;background:#E7F7EC;border-radius:99px;padding:2px 8px;margin-top:8px;font-weight:600")}>{k[2]}</div>
          </div>
        ))}
      </div>
      <div style={css("display:grid;grid-template-columns:1.4fr 1fr;gap:14px;align-items:start")}>
        <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:18px")}>
          <div style={css("font-size:13.5px;font-weight:700;margin-bottom:14px")}>Team comparison — leads</div>
          <div style={css("display:flex;flex-direction:column;gap:12px")}>
            {teams.map((t, i) => (
              <div key={t.id} style={css("display:flex;align-items:center;gap:12px")}>
                <div style={css("width:130px;font-size:12px;font-weight:600;color:#3F3F46;flex:none")}>{t.name}</div>
                <div style={css("flex:1;height:22px;background:#F4F4F5;border-radius:6px;overflow:hidden")}><div style={css("height:100%;border-radius:6px;background:" + compareColors[i % 4] + ";width:" + Math.round((teamLeads(t) / maxTeamLeads) * 100) + "%;transition:width .4s")} /></div>
                <div style={css("width:30px;font-size:12.5px;font-weight:700;text-align:right")}>{teamLeads(t)}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={css("display:flex;flex-direction:column;gap:14px")}>
          <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:16px 18px")}>
            <div style={css("font-size:13.5px;font-weight:700;margin-bottom:12px")}>Agent ranking</div>
            <div style={css("display:flex;flex-direction:column;gap:4px")}>
              {ranking.map((a, i) => (
                <Box key={a.id} onClick={() => router.push("/agents/" + a.id)} style="display:flex;align-items:center;gap:11px;padding:7px 8px;border-radius:10px;cursor:pointer" styleHover="background:#FAFAFB">
                  <div style={css("width:20px;height:20px;border-radius:6px;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex:none;" + (i === 0 ? "background:#FDE68A;color:#92400E" : "background:#F4F4F5;color:#71717A"))}>{i + 1}</div>
                  <div style={css(av(a, 28))}>{a.initials}</div>
                  <div style={css("font-size:12.5px;font-weight:600")}>{a.name}<div style={css("font-size:10.5px;color:#A1A1AA;font-weight:400")}>{a.role}</div></div>
                  <div style={css("margin-left:auto;font-size:13px;font-weight:700;color:#5122C1")}>{paMap.get(a.id)?.leadsWorked ?? 0}</div>
                </Box>
              ))}
            </div>
          </div>
          <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:16px 18px")}>
            <div style={css("font-size:13.5px;font-weight:700;margin-bottom:12px")}>Fleet health</div>
            <div style={css("display:flex;align-items:center;gap:16px")}>
              <div style={css("width:84px;height:84px;border-radius:50%;background:conic-gradient(#5122C1 0 " + (ws?.replyRate ?? 0) + "%,#F1EDFD " + (ws?.replyRate ?? 0) + "% 100%);display:flex;align-items:center;justify-content:center;flex:none")}><div style={css("width:62px;height:62px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700")}>{(ws?.replyRate ?? 0)}%</div></div>
              <div style={css("display:flex;flex-direction:column;gap:6px;font-size:12px;color:#3F3F46")}>
                <div style={css("display:flex;align-items:center;gap:7px")}><span style={css("width:8px;height:8px;border-radius:3px;background:#5122C1")} />{activeCount} working</div>
                <div style={css("display:flex;align-items:center;gap:7px")}><span style={css("width:8px;height:8px;border-radius:3px;background:#F59E0B")} />{waitingCount} waiting</div>
                <div style={css("display:flex;align-items:center;gap:7px")}><span style={css("width:8px;height:8px;border-radius:3px;background:#EF4444")} />{attentionCount} need attention</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
