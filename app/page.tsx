"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/store";
import { statusMeta } from "@/lib/data";
import { av } from "@/lib/visuals";
import { css, Box, Btn } from "@/components/primitives";
import { getWorkspaceStats } from "@/lib/workspace/statsActions";
import { listActivity } from "@/lib/workspace/statsActions";
import type { WorkspaceStats, ActivityItem } from "@/lib/workspace/stats";

const hubTypes: Record<string, string> = { sk: "meeting", mt: "email", ew: "research", rp: "writing", al: "call", nc: "analytics", ps: "idle", lm: "alert" };
const hubIcons: Record<string, [string, string, string]> = {
  email: ["✉", "iconFly 2.6s ease-in-out infinite", "#0EA5E9"], call: ["☏", "iconRing 1.6s ease-in-out infinite", "#2FA45C"],
  research: ["⌕", "iconSwing 2.4s ease-in-out infinite", "#F59E0B"], writing: ["✎", "iconPop 2.4s ease-in-out infinite", "#5122C1"],
  meeting: ["▦", "iconPop 2.8s ease-in-out infinite", "#F43F7E"], analytics: ["∿", "iconPop 3s ease-in-out infinite", "#8B5CF6"],
  idle: ["◌", "breathe 3s ease-in-out infinite", "#A1A1AA"], alert: ["⚠", "iconPop 1.8s ease-in-out infinite", "#EF4444"],
};

export default function Home() {
  const { s, set, agents, teams, byId } = useApp();
  const router = useRouter();
  const [dims, setDims] = useState({ w: 1280, h: 800 });
  const [ws, setWs] = useState<WorkspaceStats | null>(null);
  const [acts, setActs] = useState<ActivityItem[]>([]);
  useEffect(() => { getWorkspaceStats().then(setWs); listActivity(6).then(setActs); }, []);
  const paMap = new Map((ws?.perAgent ?? []).map((p) => [p.agentId, p]));
  const maxOut = Math.max(1, ...(ws?.perAgent ?? []).map((p) => p.leadsWorked));

  useEffect(() => {
    const on = () => setDims({ w: window.innerWidth, h: window.innerHeight });
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);

  const ct = s.countT;
  const tick = s.hubTick;
  const userFirst = s.userName.split(" ")[0];

  const hubMembers = (s.hubTeam === "all" ? agents.slice(0, 8) : (teams.find((t) => t.id === s.hubTeam) || teams[0]).members.map((id) => byId(id))).filter(Boolean) as typeof agents;
  const HN = Math.max(hubMembers.length, 1);
  const nodes = hubMembers.map((a, i) => {
    const ang = ((-90 + (i * 360) / HN) * Math.PI) / 180;
    const x = Math.round(380 + Math.cos(ang) * 272);
    const y = Math.round(262 + Math.sin(ang) * 186);
    const ic = hubIcons[hubTypes[a.id] || "writing"];
    const m = statusMeta(a.status);
    const latest = acts.find((f) => f.agentId === a.id);
    return { a, i, x, y, m, ic, badge: latest ? latest.text.slice(0, 40) : (a.status === "working" ? "Working…" : "Idle") };
  });
  const collabs = HN >= 5 ? [[0, 2], [1, 4]] : [];

  const hubWorking = ws?.activeAgents ?? 0;
  const leadsWorked = ws?.leadsWorked ?? 0;
  const tasksRunning = ws?.tasksRunning ?? 0;
  const monthLabel = new Date().toLocaleString("en-US", { month: "long" }).toUpperCase();

  const actLine = (f?: ActivityItem) => (f ? (byId(f.agentId)?.name ?? "Agent") + " " + f.text : "");
  const hubLive = actLine(acts[0]).slice(0, 90);
  const hubLive2 = actLine(acts[1]).slice(0, 90);

  const sbW = s.sidebarOpen ? 224 : 70;
  const hubCardW = dims.w - sbW - 52 - 2;
  const hubScale = Math.max(0.7, Math.min((dims.h - 250) / 524, (hubCardW - 40) / 760, 1.45));

  const teamPills = [{ id: "all", label: "Everyone" }].concat(teams.map((t) => ({ id: t.id, label: t.name })));

  return (
    <div style={css("padding:24px 26px;display:flex;flex-direction:column;gap:18px;animation:fadeUp .3s ease")}>
      <div style={css("display:flex;align-items:baseline;gap:12px")}>
        <div style={css("font-family:'Poetsen One',sans-serif;font-size:24px;font-weight:400;letter-spacing:-.01em;white-space:nowrap")}>Good morning, {userFirst}!</div>
        <div style={css("font-size:13px;color:#71717A")}>Your AI workforce — working live</div>
        <Btn onClick={() => set({ showTeamModal: true })} style="margin-left:auto;background:#18181B;color:#fff;border:none;border-radius:99px;padding:8px 18px;font-size:12.5px;font-weight:600;cursor:pointer" styleHover="background:#3F3F46">+ New team</Btn>
      </div>

      <div style={css("position:relative;background:radial-gradient(900px 520px at 50% 38%,#2A1657,#150B33 75%);border:1px solid #2C1B5E;border-radius:24px;height:calc(100vh - 178px);min-height:540px;overflow:hidden;box-shadow:0 20px 50px rgba(21,11,51,.3)")}>
        <div style={css("position:absolute;top:16px;left:20px;right:150px;display:flex;gap:8px;z-index:3;flex-wrap:wrap")}>
          {teamPills.map((p) => (
            <Box key={p.id} onClick={() => set({ hubTeam: p.id })} style={"font-size:11.5px;font-weight:600;border-radius:99px;padding:5px 13px;cursor:pointer;transition:all .12s;backdrop-filter:blur(6px);" + (s.hubTeam === p.id ? "background:#fff;color:#2E1065;border:1px solid #fff" : "background:rgba(255,255,255,.07);color:#CFC6F2;border:1px solid rgba(255,255,255,.16)")} styleHover="border-color:#C9B8F5">{p.label}</Box>
          ))}
        </div>
        <div style={css("position:absolute;top:16px;right:20px;display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;color:#7EE2A8;background:rgba(46,164,92,.15);border:1px solid rgba(126,226,168,.3);border-radius:99px;padding:4px 12px;z-index:3;backdrop-filter:blur(6px)")}><span style={css("width:6px;height:6px;border-radius:50%;background:#2FA45C;animation:pulse 2s infinite")} />Working now</div>

        <div style={css("position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) scale(" + hubScale.toFixed(3) + ");width:760px;height:524px")}>
          <div style={css("position:absolute;left:380px;top:262px;width:560px;height:380px;transform:translate(-50%,-50%);border:1px solid rgba(255,255,255,.06);border-radius:50%")} />
          <div style={css("position:absolute;left:380px;top:262px;width:400px;height:270px;transform:translate(-50%,-50%);border:1px solid rgba(255,255,255,.06);border-radius:50%")} />

          <svg width="760" height="524" viewBox="0 0 760 524" style={{ position: "absolute", left: 0, top: 0 }}>
            {nodes.map((n) => (
              <line key={"l" + n.i} x1="380" y1="262" x2={n.x} y2={n.y} stroke="#3D2A78" strokeWidth="1.5" strokeDasharray="3 7" style={{ animation: "dashMove 1.8s linear infinite" }} />
            ))}
            {nodes.map((n) => (
              <circle key={"p" + n.i} r="2.6" fill="#C9B2FF" opacity="0.9">
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
              <div style={css("position:absolute;left:0;top:0;right:0;bottom:0;border-radius:50%;border:2px solid rgba(181,123,255,.5);animation:ringPulse 3s ease-out infinite")} />
              <div style={css("position:absolute;left:0;top:0;right:0;bottom:0;border-radius:50%;border:2px solid rgba(181,123,255,.5);animation:ringPulse 3s ease-out 1.5s infinite")} />
              <div style={css("width:124px;height:124px;border-radius:50%;background:conic-gradient(#B57BFF 0 100%,rgba(255,255,255,.12) 100% 100%);display:flex;align-items:center;justify-content:center;box-shadow:0 0 44px rgba(139,92,246,.4)")}>
                <div style={css("width:106px;height:106px;border-radius:50%;background:#190E3B;display:flex;flex-direction:column;align-items:center;justify-content:center")}>
                  <div style={css("font-family:'Poetsen One',sans-serif;font-size:24px;font-weight:700;color:#fff;line-height:1")}>{leadsWorked}</div>
                  <div style={css("font-size:8.5px;font-weight:700;letter-spacing:.12em;color:#A99BD8;margin-top:3px")}>LEADS WORKED · {monthLabel}</div>
                </div>
              </div>
            </div>
            <div style={css("display:flex;gap:8px")}>
              <div style={css("font-size:10.5px;font-weight:600;color:#E5DEFF;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);border-radius:99px;padding:4px 11px;backdrop-filter:blur(6px)")}>⚡ {hubWorking} working · {tasksRunning} tasks</div>
            </div>
          </div>

          {/* agent nodes */}
          {nodes.map((n) => (
            <Box key={n.a.id} onClick={() => router.push("/agents/" + n.a.id)} aria-label={n.a.name} style={"position:absolute;left:" + n.x + "px;top:" + n.y + "px;transform:translate(-50%,-50%);width:170px;display:flex;flex-direction:column;align-items:center;cursor:pointer;z-index:2"}>
              <div style={css("display:flex;flex-direction:column;align-items:center;gap:6px;animation:floaty " + (5 + (n.i % 3)) + "s ease-in-out " + (n.i * 0.45).toFixed(2) + "s infinite")}>
                <div style={css("position:relative")}>
                  <div style={css("padding:3px;border-radius:50%;background:#fff;box-shadow:0 0 22px " + n.a.color + "66")}><div style={css(av(n.a, 46) + ";border:2px solid #190E3B")}>{n.a.initials}</div></div>
                  <div style={css("position:absolute;top:-8px;right:-10px;width:22px;height:22px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;color:#18181B;box-shadow:0 3px 10px rgba(0,0,0,.35);animation:" + n.ic[1])}>{n.ic[0]}</div>
                </div>
                <div style={css("display:flex;align-items:center;gap:5px;margin-top:2px")}><span style={css("width:7px;height:7px;border-radius:50%;background:" + n.m.dot + ";flex:none;" + (n.a.status === "working" ? "animation:pulse 2s infinite" : ""))} /><span style={css("font-size:12px;font-weight:700;color:#F4F1FF")}>{n.a.name}</span></div>
                <div style={css("width:60px;height:3px;border-radius:2px;background:rgba(255,255,255,.14);overflow:hidden")}><div style={css("width:" + Math.round(((paMap.get(n.a.id)?.leadsWorked ?? 0) / maxOut) * 100) + "%;height:100%;border-radius:2px;background:linear-gradient(90deg," + n.a.color + ",#B57BFF)")} /></div>
                <div style={css("display:flex;align-items:center;gap:6px;font-size:10.5px;font-weight:600;color:#E5DEFF;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);backdrop-filter:blur(6px);border-radius:99px;padding:4px 10px;white-space:nowrap;max-width:168px;overflow:hidden;text-overflow:ellipsis;animation:" + (tick % 2 ? "badgePopA" : "badgePopB") + " .4s ease")}><span>{n.badge}</span></div>
              </div>
            </Box>
          ))}
        </div>

        {/* floating particles */}
        <div style={css("position:absolute;left:18%;bottom:30%;width:5px;height:5px;border-radius:50%;background:rgba(181,123,255,.6);animation:rise 7s ease-in-out infinite")} />
        <div style={css("position:absolute;left:72%;bottom:24%;width:4px;height:4px;border-radius:50%;background:rgba(126,226,168,.5);animation:rise 9s ease-in-out 2s infinite")} />
        <div style={css("position:absolute;left:48%;bottom:18%;width:3px;height:3px;border-radius:50%;background:rgba(244,63,126,.5);animation:rise 8s ease-in-out 4s infinite")} />
        <div style={css("position:absolute;left:85%;bottom:55%;width:4px;height:4px;border-radius:50%;background:rgba(201,178,255,.5);animation:rise 10s ease-in-out 1s infinite")} />

        {/* live activity labels */}
        <div style={css("position:absolute;bottom:16px;left:20px;display:flex;flex-direction:column;align-items:flex-start;gap:6px;z-index:3;max-width:70%")}>
          <div style={css("display:flex;align-items:center;gap:7px;font-size:11px;font-weight:600;color:#CFC6F2;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:99px;padding:5px 13px;backdrop-filter:blur(8px);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;opacity:.75")}><span style={css("color:#8F7EC9")}>✦</span>{hubLive2}</div>
          <div style={css("display:flex;align-items:center;gap:7px;font-size:11px;font-weight:600;color:#E5DEFF;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);border-radius:99px;padding:5px 13px;backdrop-filter:blur(8px);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%")}><span style={css("color:#B57BFF")}>✦</span>{hubLive}</div>
        </div>
      </div>

      {/* team cards */}
      <div style={css("display:grid;grid-template-columns:1fr 1fr;gap:14px")}>
        {teams.map((t) => {
          const avatars = t.members.slice(0, 3).map((id) => byId(id)).filter(Boolean);
          return (
            <Box key={t.id} onClick={() => router.push("/teams/" + t.id)} style="background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:18px 20px;box-shadow:0 1px 3px rgba(24,24,27,.04);cursor:pointer;transition:transform .15s,box-shadow .15s" styleHover="transform:translateY(-3px);box-shadow:0 10px 24px rgba(24,24,27,.08)">
              <div style={css("display:flex;align-items:center;gap:12px")}>
                <div style={css("width:42px;height:42px;border-radius:12px;background:" + t.iconBg + ";display:flex;align-items:center;justify-content:center;font-size:19px;flex:none")}>{t.icon}</div>
                <div><div style={css("font-size:14.5px;font-weight:700")}>{t.name}</div><div style={css("font-size:12px;color:#71717A")}>{t.desc}</div></div>
                <div style={css("margin-left:auto;display:flex")}>
                  {avatars.map((a, i) => <div key={a!.id} style={css(av(a!, 26) + ";border:2px solid #fff;margin-left:" + (i ? "-8" : "0") + "px")}>{a!.initials}</div>)}
                </div>
              </div>
              <div style={css("display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:16px")}>
                <div style={css("background:#FAFAFB;border-radius:10px;padding:10px 12px")}><div style={css("font-size:10.5px;color:#A1A1AA")}>Leads</div><div style={css("font-size:17px;font-weight:700;margin-top:2px")}>{t.members.reduce((n, id) => n + (paMap.get(id)?.leadsWorked ?? 0), 0)}</div></div>
                <div style={css("background:#FAFAFB;border-radius:10px;padding:10px 12px")}><div style={css("font-size:10.5px;color:#A1A1AA")}>Members</div><div style={css("font-size:17px;font-weight:700;margin-top:2px")}>{t.members.length}</div></div>
                <div style={css("background:#FAFAFB;border-radius:10px;padding:10px 12px")}><div style={css("font-size:10.5px;color:#A1A1AA")}>Working</div><div style={css("font-size:17px;font-weight:700;margin-top:2px")}>{t.members.filter((id) => byId(id)?.status === "working").length}</div></div>
              </div>
            </Box>
          );
        })}
      </div>
    </div>
  );
}
