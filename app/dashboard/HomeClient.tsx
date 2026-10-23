"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/store";
import { statusMeta } from "@/lib/data";
import { av } from "@/lib/visuals";
import { css, Box, Btn } from "@/components/primitives";
import type { WorkspaceStats, ActivityItem } from "@/lib/workspace/stats";
import { useLiveWork } from "@/lib/useLiveWork";
import { agentNow, liveAgentCount, teamSubtitle } from "@/lib/agents/derive";
import { greetingFor, hubScaleFor } from "@/lib/greeting";

const hubTypes: Record<string, string> = { sk: "meeting", mt: "email", ew: "research", rp: "writing", al: "call", nc: "analytics", ps: "idle", lm: "alert" };
const hubIcons: Record<string, [string, string, string]> = {
  email: ["✉", "iconFly 2.6s ease-in-out infinite", "#0EA5E9"], call: ["☏", "iconRing 1.6s ease-in-out infinite", "#2FA45C"],
  research: ["⌕", "iconSwing 2.4s ease-in-out infinite", "#F59E0B"], writing: ["✎", "iconPop 2.4s ease-in-out infinite", "#006AFF"],
  meeting: ["▦", "iconPop 2.8s ease-in-out infinite", "#F43F7E"], analytics: ["∿", "iconPop 3s ease-in-out infinite", "#8B5CF6"],
  idle: ["◌", "breathe 3s ease-in-out infinite", "#A1A1AA"], alert: ["⚠", "iconPop 1.8s ease-in-out infinite", "#EF4444"],
};

export default function HomeClient({ initialStats, initialActs }: { initialStats: WorkspaceStats | null; initialActs: ActivityItem[] }) {
  const { s, set, agents, teams, byId } = useApp();
  const router = useRouter();
  // The hub card's measured size; null until mounted.
  const hubRef = useRef<HTMLDivElement>(null);
  const [card, setCard] = useState<{ w: number; h: number } | null>(null);
  // Date-dependent text is computed after mount so server and client markup match.
  const [clock, setClock] = useState<{ greeting: string; month: string } | null>(null);
  // Badge re-pop tick. Local to the dashboard so it doesn't re-render the app.
  const [tick, setTick] = useState(0);
  const { live } = useLiveWork();
  const ws = initialStats;
  const acts = initialActs;
  const paMap = new Map((ws?.perAgent ?? []).map((p) => [p.agentId, p]));
  const maxOut = Math.max(1, ...(ws?.perAgent ?? []).map((p) => p.leadsWorked));

  useEffect(() => {
    const el = hubRef.current;
    if (!el) return;
    const on = () => setCard({ w: el.clientWidth, h: el.clientHeight });
    on();
    const ro = new ResizeObserver(on);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const now = new Date();
    setClock({ greeting: greetingFor(now.getHours()), month: now.toLocaleString("en-US", { month: "long" }).toUpperCase() });
    const t = setInterval(() => setTick((n) => n + 1), 3200);
    return () => clearInterval(t);
  }, []);

  const userFirst = s.userName.split(" ")[0];

  const hubMembers = (s.hubTeam === "all" ? agents.slice(0, 8) : ((teams.find((t) => t.id === s.hubTeam) || teams[0])?.members ?? []).map((id) => byId(id))).filter(Boolean) as typeof agents;
  const HN = Math.max(hubMembers.length, 1);
  const nodes = hubMembers.map((a, i) => {
    const ang = ((-90 + (i * 360) / HN) * Math.PI) / 180;
    const x = Math.round(380 + Math.cos(ang) * 272);
    const y = Math.round(262 + Math.sin(ang) * 186);
    const ic = hubIcons[hubTypes[a.id] || "writing"];
    const now = agentNow(a.id, live, !!s.paused[a.id]);
    const m = statusMeta(now.status);
    const latest = acts.find((f) => f.agentId === a.id);
    return { a, i, x, y, m, ic, working: now.status === "working", badge: now.status === "working" ? now.task.slice(0, 40) : latest ? latest.text.slice(0, 40) : now.task };
  });
  const collabs = HN >= 5 ? [[0, 2], [1, 4]] : [];

  const hubWorking = ws?.activeAgents ?? 0;
  const leadsWorked = ws?.leadsWorked ?? 0;
  const tasksRunning = ws?.tasksRunning ?? 0;
  const monthLabel = clock?.month ?? "THIS MONTH";

  const actLine = (f?: ActivityItem) => (f ? (byId(f.agentId)?.name ?? "Agent") + " " + f.text : "");
  const hubLive = actLine(acts[0]).slice(0, 90);
  const hubLive2 = actLine(acts[1]).slice(0, 90);

  const hubScale = card ? hubScaleFor(card.w, card.h) : 1;

  const teamPills = [{ id: "all", label: "Everyone" }].concat(teams.map((t) => ({ id: t.id, label: t.name })));

  return (
    <div style={css("padding:24px 26px;display:flex;flex-direction:column;gap:18px;animation:fadeUp .3s ease")}>
      <div style={css("display:flex;align-items:baseline;gap:12px")}>
        <div style={css("font-family:'General Sans',Inter,sans-serif;font-size:24px;font-weight:400;letter-spacing:-.01em;white-space:nowrap;transition:opacity .2s;" + (clock ? "" : "opacity:0"))}>{clock?.greeting ?? "Hello"}, {userFirst}!</div>
        <Btn onClick={() => router.push("/agents")} style="margin-left:auto;background:#fff;color:#344054;border:1px solid #D0D5DD;border-radius:99px;padding:8px 18px;font-size:12.5px;font-weight:600;cursor:pointer" styleHover="background:#F9FAFB">All agents</Btn>
        <Btn onClick={() => set({ showTeamModal: true })} style="background:#18181B;color:#fff;border:none;border-radius:99px;padding:8px 18px;font-size:12.5px;font-weight:600;cursor:pointer" styleHover="background:#3F3F46">+ New team</Btn>
      </div>

      <div ref={hubRef} style={css("position:relative;background:radial-gradient(900px 520px at 50% 38%,#123A8C,#07183F 75%);border:1px solid #1A3A80;border-radius:24px;height:calc(100vh - 178px);min-height:540px;overflow:hidden;box-shadow:0 20px 50px rgba(7,24,63,.3)")}>
        <div style={css("position:absolute;top:16px;left:20px;right:150px;display:flex;gap:8px;z-index:3;flex-wrap:wrap")}>
          {teamPills.map((p) => (
            <Box key={p.id} onClick={() => set({ hubTeam: p.id })} style={"font-size:11.5px;font-weight:600;border-radius:99px;padding:5px 13px;cursor:pointer;transition:all .12s;backdrop-filter:blur(6px);" + (s.hubTeam === p.id ? "background:#fff;color:#0B2A6B;border:1px solid #fff" : "background:rgba(255,255,255,.07);color:#C7D7F5;border:1px solid rgba(255,255,255,.16)")} styleHover="border-color:#CFE0FF">{p.label}</Box>
          ))}
        </div>
        {hubWorking > 0 && <div style={css("position:absolute;top:16px;right:20px;display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;color:#7EE2A8;background:rgba(46,164,92,.15);border:1px solid rgba(126,226,168,.3);border-radius:99px;padding:4px 12px;z-index:3;backdrop-filter:blur(6px)")}><span style={css("width:6px;height:6px;border-radius:50%;background:#2FA45C;animation:pulse 2s infinite")} />Working now</div>}

        <div style={css("position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) scale(" + hubScale.toFixed(3) + ");width:760px;height:524px")}>
          <div style={css("position:absolute;left:380px;top:262px;width:560px;height:380px;transform:translate(-50%,-50%);border:1px solid rgba(255,255,255,.06);border-radius:50%")} />
          <div style={css("position:absolute;left:380px;top:262px;width:400px;height:270px;transform:translate(-50%,-50%);border:1px solid rgba(255,255,255,.06);border-radius:50%")} />

          <svg width="760" height="524" viewBox="0 0 760 524" style={{ position: "absolute", left: 0, top: 0 }}>
            {nodes.map((n) => (
              <line key={"l" + n.i} x1="380" y1="262" x2={n.x} y2={n.y} stroke="#2B57B5" strokeWidth="1.5" strokeDasharray="3 7" style={{ animation: "dashMove 1.8s linear infinite" }} />
            ))}
            {nodes.map((n) => (
              <circle key={"p" + n.i} r="2.6" fill="#93C5FD" opacity="0.9">
                <animateMotion dur={2.4 + (n.i % 4) * 0.6 + "s"} begin={n.i * 0.4 + "s"} repeatCount="indefinite" path={"M" + n.x + " " + n.y + " L380 262"} />
              </circle>
            ))}
            {collabs.map((c, i) => (
              <line key={"c" + i} x1={nodes[c[0]].x} y1={nodes[c[0]].y} x2={nodes[c[1]].x} y2={nodes[c[1]].y} stroke="rgba(244,63,126,.55)" strokeWidth="1.5" strokeDasharray="2 6" style={{ animation: "dashMove 1.2s linear infinite" }} />
            ))}
          </svg>

          {/* center goal ring */}
          <div style={css("position:absolute;left:380px;top:262px;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:10px;z-index:2")}>
            <div style={css("position:relative;width:124px;height:124px;display:flex;align-items:center;justify-content:center")}>
              <div style={css("position:absolute;left:0;top:0;right:0;bottom:0;border-radius:50%;border:2px solid rgba(96,165,250,.5);animation:ringPulse 3s ease-out infinite")} />
              <div style={css("position:absolute;left:0;top:0;right:0;bottom:0;border-radius:50%;border:2px solid rgba(96,165,250,.5);animation:ringPulse 3s ease-out 1.5s infinite")} />
              <div style={css("width:124px;height:124px;border-radius:50%;background:conic-gradient(#60A5FA 0 100%,rgba(255,255,255,.12) 100% 100%);display:flex;align-items:center;justify-content:center;box-shadow:0 0 44px rgba(59,130,246,.4)")}>
                <div style={css("width:106px;height:106px;border-radius:50%;background:#0A1E4D;display:flex;flex-direction:column;align-items:center;justify-content:center")}>
                  <div style={css("font-family:'General Sans',Inter,sans-serif;font-size:24px;font-weight:700;color:#fff;line-height:1")}>{leadsWorked}</div>
                  <div style={css("font-size:8.5px;font-weight:700;letter-spacing:.1em;color:#9DB5E6;margin-top:4px;text-align:center;line-height:1.4")}>LEADS WORKED<br />{monthLabel}</div>
                </div>
              </div>
            </div>
            <div style={css("display:flex;gap:8px")}>
              <div style={css("font-size:10.5px;font-weight:600;color:#DCE7FF;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);border-radius:99px;padding:4px 11px;backdrop-filter:blur(6px)")}>⚡ {hubWorking} working · {tasksRunning} tasks</div>
            </div>
          </div>

          {/* agent nodes */}
          {nodes.map((n) => (
            <Box key={n.a.id} onClick={() => router.push("/agents/" + n.a.id)} aria-label={n.a.name} style={"position:absolute;left:" + n.x + "px;top:" + n.y + "px;transform:translate(-50%,-50%);width:170px;display:flex;flex-direction:column;align-items:center;cursor:pointer;z-index:2"}>
              <div style={css("display:flex;flex-direction:column;align-items:center;gap:6px;animation:floaty " + (5 + (n.i % 3)) + "s ease-in-out " + (n.i * 0.45).toFixed(2) + "s infinite")}>
                <div style={css("position:relative")}>
                  <div style={css("padding:3px;border-radius:50%;background:#fff;box-shadow:0 0 22px " + n.a.color + "66")}><div style={css(av(n.a, 46) + ";border:2px solid #0A1E4D")}>{n.a.initials}</div></div>
                  <div style={css("position:absolute;top:-8px;right:-10px;width:22px;height:22px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;color:#18181B;box-shadow:0 3px 10px rgba(0,0,0,.35);animation:" + n.ic[1])}>{n.ic[0]}</div>
                </div>
                <div style={css("display:flex;align-items:center;gap:5px;margin-top:2px")}><span style={css("width:7px;height:7px;border-radius:50%;background:" + n.m.dot + ";flex:none;" + (n.working ? "animation:pulse 2s infinite" : ""))} /><span style={css("font-size:12px;font-weight:700;color:#F1F6FF")}>{n.a.name}</span></div>
                <div style={css("width:60px;height:3px;border-radius:2px;background:rgba(255,255,255,.14);overflow:hidden")}><div style={css("width:" + Math.round(((paMap.get(n.a.id)?.leadsWorked ?? 0) / maxOut) * 100) + "%;height:100%;border-radius:2px;background:linear-gradient(90deg," + n.a.color + ",#60A5FA)")} /></div>
                <div style={css("display:flex;align-items:center;gap:6px;font-size:10.5px;font-weight:600;color:#DCE7FF;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);backdrop-filter:blur(6px);border-radius:99px;padding:4px 10px;white-space:nowrap;max-width:168px;overflow:hidden;text-overflow:ellipsis;animation:" + (tick % 2 ? "badgePopA" : "badgePopB") + " .4s ease")}><span>{n.badge}</span></div>
              </div>
            </Box>
          ))}
        </div>

        {/* floating particles */}
        <div style={css("position:absolute;left:18%;bottom:30%;width:5px;height:5px;border-radius:50%;background:rgba(96,165,250,.6);animation:rise 7s ease-in-out infinite")} />
        <div style={css("position:absolute;left:72%;bottom:24%;width:4px;height:4px;border-radius:50%;background:rgba(126,226,168,.5);animation:rise 9s ease-in-out 2s infinite")} />
        <div style={css("position:absolute;left:48%;bottom:18%;width:3px;height:3px;border-radius:50%;background:rgba(244,63,126,.5);animation:rise 8s ease-in-out 4s infinite")} />
        <div style={css("position:absolute;left:85%;bottom:55%;width:4px;height:4px;border-radius:50%;background:rgba(201,178,255,.5);animation:rise 10s ease-in-out 1s infinite")} />

        {/* live activity labels */}
        <div style={css("position:absolute;bottom:16px;left:20px;display:flex;flex-direction:column;align-items:flex-start;gap:6px;z-index:3;max-width:70%")}>
          {hubLive2 && <div style={css("display:flex;align-items:center;gap:7px;font-size:11px;font-weight:600;color:#C7D7F5;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:99px;padding:5px 13px;backdrop-filter:blur(8px);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;opacity:.75")}><span style={css("color:#7E9CD6")}>✦</span>{hubLive2}</div>}
          {hubLive && <div style={css("display:flex;align-items:center;gap:7px;font-size:11px;font-weight:600;color:#DCE7FF;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);border-radius:99px;padding:5px 13px;backdrop-filter:blur(8px);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%")}><span style={css("color:#60A5FA")}>✦</span>{hubLive}</div>}
        </div>
      </div>

      {/* team cards */}
      {teams.length === 0 ? (
        <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:44px 18px;display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center")}>
          <div style={css("width:52px;height:52px;border-radius:14px;background:#EAF2FF;display:flex;align-items:center;justify-content:center;font-size:24px")}>🌐</div>
          <div style={css("font-size:15px;font-weight:700")}>No teams yet</div>
          <Btn onClick={() => set({ showTeamModal: true })} style="margin-top:6px;background:#006AFF;color:#fff;border:none;border-radius:99px;padding:9px 18px;font-size:12.5px;font-weight:600;cursor:pointer" styleHover="background:#0052CC">+ Create your first team</Btn>
        </div>
      ) : (
      <div style={css("display:grid;grid-template-columns:1fr 1fr;gap:14px")}>
        {teams.map((t) => {
          const avatars = t.members.slice(0, 3).map((id) => byId(id)).filter(Boolean);
          return (
            <Box key={t.id} onClick={() => router.push("/teams/" + t.id)} style="background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:18px 20px;box-shadow:0 1px 3px rgba(24,24,27,.04);cursor:pointer;transition:transform .15s,box-shadow .15s" styleHover="transform:translateY(-3px);box-shadow:0 10px 24px rgba(24,24,27,.08)">
              <div style={css("display:flex;align-items:center;gap:12px")}>
                <div style={css("width:42px;height:42px;border-radius:12px;background:" + t.iconBg + ";display:flex;align-items:center;justify-content:center;font-size:19px;flex:none")}>{t.icon}</div>
                <div><div style={css("font-size:14.5px;font-weight:700")}>{t.name}</div><div style={css("font-size:12px;color:#71717A")}>{teamSubtitle(t)}</div></div>
                <div style={css("margin-left:auto;display:flex")}>
                  {avatars.map((a, i) => <div key={a!.id} style={css(av(a!, 26) + ";border:2px solid #fff;margin-left:" + (i ? "-8" : "0") + "px")}>{a!.initials}</div>)}
                </div>
              </div>
              <div style={css("display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:16px")}>
                <div style={css("background:#FAFAFB;border-radius:10px;padding:10px 12px")}><div style={css("font-size:10.5px;color:#A1A1AA")}>Leads</div><div style={css("font-size:17px;font-weight:700;margin-top:2px")}>{t.members.reduce((n, id) => n + (paMap.get(id)?.leadsWorked ?? 0), 0)}</div></div>
                <div style={css("background:#FAFAFB;border-radius:10px;padding:10px 12px")}><div style={css("font-size:10.5px;color:#A1A1AA")}>Members</div><div style={css("font-size:17px;font-weight:700;margin-top:2px")}>{t.members.length}</div></div>
                <div style={css("background:#FAFAFB;border-radius:10px;padding:10px 12px")}><div style={css("font-size:10.5px;color:#A1A1AA")}>Working</div><div style={css("font-size:17px;font-weight:700;margin-top:2px")}>{liveAgentCount(live, t.members)}</div></div>
              </div>
            </Box>
          );
        })}
      </div>
      )}
    </div>
  );
}
