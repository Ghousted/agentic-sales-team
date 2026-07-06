"use client";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useApp } from "@/lib/store";
import { statusMeta } from "@/lib/data";
import { av, chip } from "@/lib/visuals";
import { css, Box, Btn } from "@/components/primitives";

const pastel = [
  { bg: "#F1EDFD", bd: "#E3DBF9", fg: "#5122C1" },
  { bg: "#FDF0F5", bd: "#F9DCE8", fg: "#DB2777" },
  { bg: "#FEF6E8", bd: "#FBE8C5", fg: "#B45309" },
  { bg: "#E9F5FE", bd: "#CBE7FB", fg: "#0369A1" },
];

const TABS: [string, string][] = [
  ["overview", "Overview"], ["leads", "Leads"], ["emails", "Emails"], ["reach", "Reach Outs"],
  ["tasks", "Tasks"], ["analytics", "Performance"], ["memory", "Memory"], ["settings", "Configuration"],
];

const leadsMaster = [
  { name: "Marcus Webb", title: "CTO", company: "Plaid", status: "Engaged", score: 92, last: "2h ago", campaign: "Fintech CTO · Seq B" },
  { name: "Dana Liu", title: "VP Data", company: "Ramp", status: "Engaged", score: 88, last: "5h ago", campaign: "Fintech CTO · Seq B" },
  { name: "Tom Okafor", title: "Head of Eng", company: "Brex", status: "Replied", score: 95, last: "1d ago", campaign: "Fintech CTO · Seq A" },
  { name: "Ines Ferreira", title: "CTO", company: "Mercury", status: "Contacted", score: 74, last: "2d ago", campaign: "Fintech CTO · Seq A" },
  { name: "Sam Whitfield", title: "VP Eng", company: "Datadog", status: "Meeting", score: 97, last: "2m ago", campaign: "Observability · Seq A" },
  { name: "Grace Nakamura", title: "CIO", company: "Chime", status: "New", score: 61, last: "—", campaign: "Fintech CTO · Seq B" },
];
const leadStatusColors: Record<string, [string, string]> = {
  Engaged: ["#E9F5FE", "#0369A1"], Replied: ["#E7F7EC", "#1B7A3D"], Contacted: ["#FEF6E8", "#B45309"], Meeting: ["#F1EDFD", "#5122C1"], New: ["#F4F4F5", "#71717A"],
};
const emailDefs: [string, string][] = [["Drafted", "14"], ["Sent", "312"], ["Opened", "131"], ["Clicked", "44"], ["Replies", "23"]];
const emailTimeline = [
  { type: "Sent", subject: "Quick idea for Plaid’s data pipeline costs", to: "Marcus Webb · Plaid", time: "Today 9:40a", c: ["#E9F5FE", "#0369A1"] },
  { type: "Reply", subject: "Re: Cutting warehouse spend 30%", to: "Tom Okafor · Brex", time: "Today 8:15a", c: ["#E7F7EC", "#1B7A3D"] },
  { type: "Opened", subject: "How Ramp teams handle data access", to: "Dana Liu · Ramp", time: "Yesterday 4:02p", c: ["#FEF6E8", "#B45309"] },
  { type: "Draft", subject: "Following up on Thursday’s meeting", to: "Sam Whitfield · Datadog", time: "Yesterday 2:30p", c: ["#F4F4F5", "#71717A"] },
  { type: "Sent", subject: "Intro — saw your AWS re:Invent talk", to: "Ines Ferreira · Mercury", time: "Mon 10:12a", c: ["#E9F5FE", "#0369A1"] },
];
const reach = [
  { type: "Meeting Booked", title: "Datadog — VP Eng", desc: "Thursday 2:00pm · Zoom · agenda drafted", time: "Today 9:12a", c: ["#F1EDFD", "#5122C1"] },
  { type: "Cold Email", title: "Plaid — Marcus Webb (CTO)", desc: "Personalized with their Q1 infra blog post", time: "Today 8:40a", c: ["#E9F5FE", "#0369A1"] },
  { type: "LinkedIn", title: "Ramp — Dana Liu (VP Data)", desc: "Connection accepted · sent voice-note intro", time: "Yesterday 5:20p", c: ["#FEF6E8", "#B45309"] },
  { type: "Follow-up", title: "Brex — Tom Okafor", desc: "3rd touch · referenced his reply about latency", time: "Yesterday 11:05a", c: ["#FDF0F5", "#DB2777"] },
  { type: "Phone Call", title: "Mercury — front desk", desc: "Asked for referral to engineering leadership", time: "Mon 3:45p", c: ["#E7F7EC", "#1B7A3D"] },
  { type: "Cold Email", title: "Chime — Grace Nakamura (CIO)", desc: "First touch · security-first angle", time: "Mon 9:00a", c: ["#E9F5FE", "#0369A1"] },
];
const taskDefs: string[][] = [
  ["Running", "Personalize outreach for 14 Fintech CTOs", "Using company news + tech stack signals", "Started 9:02a", "#E9F5FE", "#0369A1", "#0EA5E9"],
  ["Running", "Enrich 35 new Healthcare leads", "Firmographics + AWS usage detection", "Started 8:47a", "#E9F5FE", "#0369A1", "#0EA5E9"],
  ["Pending", "Draft weekly pipeline summary", "Scheduled for 4:30pm", "Queued", "#FEF6E8", "#B45309", "#F59E0B"],
  ["Completed", "Research 8 prospects using AWS", "Findings saved to memory", "Done 8:15a", "#E7F7EC", "#1B7A3D", "#2FA45C"],
  ["Failed", "Sync contacts to CRM", "API rate limit — retrying at 11:00a", "Failed 7:58a", "#FEECEC", "#B91C1C", "#EF4444"],
];
const kpiDefs: [string, string, string][] = [["Lead conversion", "8.4%", "▲ 1.2%"], ["Response rate", "24%", "▲ 3%"], ["Meeting rate", "4.1%", "▲ 0.6%"], ["Pipeline", "$412K", "▲ $38K"]];
const days = ["M", "T", "W", "T", "F", "S", "S"];
const weekVals = [62, 78, 55, 88, 70, 20, 8];
const heatShades = ["#F1EDFD", "#DCD2F8", "#C9B8F5", "#A88CF0", "#8B5CF6", "#5122C1"];
const heatSeed = [1, 3, 2, 5, 4, 2, 0, 1, 3, 4, 5, 2, 2, 4, 5, 3, 1, 0, 1, 2, 4, 5, 3, 1, 0, 2, 3, 4, 5, 4, 2, 1, 0, 2, 3, 4, 3, 5, 4, 2, 1, 2, 3, 4, 5, 3, 2, 1];
const memory = [
  { icon: "👤", title: "User preferences", bg: "#F1EDFD", items: ["Jordan prefers meetings booked 10am–4pm ET", "Never contact existing customers", "CC jordan@ on enterprise threads"] },
  { icon: "🏢", title: "Company knowledge", bg: "#E9F5FE", items: ["Best case study: 30% warehouse cost cut at Ramp-sized co", "Pricing starts at $24/seat, volume discount at 100+", "Q3 focus: observability + fintech verticals"] },
  { icon: "🧭", title: "Prospect history", bg: "#FEF6E8", items: ["Brex replied positively to latency angle (reuse)", "Mercury gatekeeper redirects to eng-leads@", "Chime requires security one-pager before calls"] },
  { icon: "✨", title: "Successful messaging", bg: "#FDF0F5", items: ["Subject lines with a number → +12% opens", "Referencing a recent blog post → 2.1× replies", "Tuesday 9am sends perform best"] },
];
// [key, label, default] — key is the stable id stored in agent_config.permissions.
const PERM_DEFS: [string, string, boolean][] = [
  ["emails", "Send emails autonomously", true],
  ["meetings", "Book meetings on your calendar", true],
  ["calls", "Make phone calls", false],
];
const ROLE_OPTIONS = ["SDR", "BDR", "Account Executive", "Sales Manager", "Customer Success", "Recruiter"];

function permsFrom(saved?: Record<string, boolean>): Record<string, boolean> {
  const base: Record<string, boolean> = {};
  for (const [key, , def] of PERM_DEFS) base[key] = def;
  return { ...base, ...(saved ?? {}) };
}

function SectionTitle({ id, children }: { id: string; children: React.ReactNode }) {
  return <div id={id} style={css("font-family:'Poetsen One',sans-serif;font-size:15px;font-weight:700;margin-top:4px")}>{children}</div>;
}

export default function AgentDetail() {
  const { s, agents, byId, togglePause, deleteAgent, saveConfig } = useApp();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [tab, setTab] = useState("overview");

  const sel = byId(params.id) || agents[0];

  // Editable Configuration state, seeded from the (config-applied) agent + saved
  // permissions. Reset whenever the viewed agent changes (route stays mounted).
  const selId = sel?.id;
  const [cfgRole, setCfgRole] = useState(sel?.role ?? "");
  const [cfgGoal, setCfgGoal] = useState(sel?.goal ?? "");
  const [cfgPerms, setCfgPerms] = useState<Record<string, boolean>>(() => permsFrom(selId ? s.agentConfig[selId]?.permissions : undefined));
  useEffect(() => {
    if (!selId) return;
    setCfgRole(sel.role);
    setCfgGoal(sel.goal);
    setCfgPerms(permsFrom(s.agentConfig[selId]?.permissions));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selId]);

  if (!sel) return null;
  const paused = !!s.paused[sel.id];
  const selM = statusMeta(paused ? "waiting" : sel.status);

  const gotoTab = (key: string) => {
    setTab(key);
    const el = document.getElementById("sec-" + key);
    const sc = document.getElementById("mainScroll");
    const bar = document.getElementById("detailTabBar");
    const off = (bar ? bar.offsetHeight : 46) + 12;
    if (el && sc) sc.scrollTo({ top: el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - off, behavior: "smooth" });
  };

  const goals = ["Book 30 meetings every month", "Target CTOs at 51–200 person SaaS companies", "Prioritize companies using AWS", "Always personalize outreach"];

  return (
    <div style={css("padding:24px 26px;display:flex;flex-direction:column;gap:18px;animation:fadeUp .3s ease")}>
      <Box onClick={() => router.push("/agents")} style="font-size:12px;color:#71717A;cursor:pointer;display:flex;align-items:center;gap:6px" styleHover="color:#5122C1">← All agents</Box>

      {/* header card */}
      <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:20px;padding:22px 24px;box-shadow:0 1px 3px rgba(24,24,27,.04);display:flex;align-items:center;gap:18px")}>
        <div style={css(av(sel, 64))}>{sel.initials}</div>
        <div style={css("min-width:0")}>
          <div style={css("display:flex;align-items:center;gap:10px")}>
            <span style={css("font-size:19px;font-weight:700")}>{sel.name}</span>
            <span style={css("display:inline-flex;align-items:center;gap:5px;" + chip(selM.bg, selM.color))}>
              <span style={css("width:6px;height:6px;border-radius:50%;background:" + selM.dot)} />
              {paused ? "Paused" : selM.label}
            </span>
          </div>
          <div style={css("font-size:13px;color:#71717A;margin-top:2px")}>{sel.role}</div>
          <div style={css("font-size:12px;color:#5122C1;background:#F1EDFD;border-radius:99px;padding:3px 12px;display:inline-block;margin-top:8px;font-weight:600")}>🎯 {sel.goal}</div>
        </div>
        <div style={css("margin-left:auto;display:flex;gap:8px;flex:none")}>
          <Btn onClick={() => router.push("/chats?agent=" + sel.id)} style="background:#5122C1;color:#fff;border:none;border-radius:99px;padding:8px 18px;font-size:12.5px;font-weight:600;cursor:pointer" styleHover="background:#42199E">Chat</Btn>
          <Btn onClick={() => togglePause(sel.id)} style="background:#FEF6E8;color:#B45309;border:none;border-radius:99px;padding:8px 18px;font-size:12.5px;font-weight:600;cursor:pointer" styleHover="background:#FDEBCB">{paused ? "Resume" : "Pause"}</Btn>
          <Btn onClick={() => gotoTab("settings")} style="background:#F4F4F5;color:#3F3F46;border:none;border-radius:99px;padding:8px 18px;font-size:12.5px;font-weight:600;cursor:pointer" styleHover="background:#E4E4E7">Edit</Btn>
          <Btn onClick={() => { deleteAgent(sel.id); router.push("/agents"); }} style="background:#FEECEC;color:#B91C1C;border:none;border-radius:99px;padding:8px 18px;font-size:12.5px;font-weight:600;cursor:pointer" styleHover="background:#FDD8D8">Delete</Btn>
        </div>
      </div>

      {/* sticky tab bar */}
      <div id="detailTabBar" style={css("position:sticky;top:0;z-index:5;background:#FAFAFB;padding:8px 0;display:flex;gap:4px;flex-wrap:wrap;border-bottom:1px solid #ECECF1")}>
        {TABS.map(([key, label]) => (
          <Box key={key} onClick={() => gotoTab(key)} style={"padding:7px 14px;font-size:12.5px;cursor:pointer;border-radius:99px;transition:all .12s;" + (tab === key ? "background:#18181B;color:#fff;font-weight:600" : "color:#52525B;font-weight:500")} styleHover="color:#18181B">{label}</Box>
        ))}
      </div>

      {/* Overview */}
      <div id="sec-overview" style={css("display:grid;grid-template-columns:1fr 300px;gap:14px;align-items:start;animation:fadeUp .25s ease")}>
        <div style={css("display:flex;flex-direction:column;gap:14px")}>
          <div style={css("background:linear-gradient(135deg,#F3EFFE,#FDEEF6);border-radius:16px;padding:18px")}>
            <div style={css("font-size:11px;font-weight:700;color:#5122C1;text-transform:uppercase;letter-spacing:.06em")}>✦ AI Summary — Today</div>
            <div style={css("font-size:13.5px;color:#3F3F46;margin-top:8px;line-height:1.6")}>
              {sel.name} is on pace this month. Today: 23 emails sent with a 48% open rate, 4 replies, and 1 meeting booked with Datadog. Reply rate is up 3% week-over-week. Focus for the rest of the day: 14 remaining Fintech CTOs and a follow-up pass on double-openers.
            </div>
          </div>
          <div style={css("display:grid;grid-template-columns:repeat(3,1fr);gap:14px")}>
            {[["Emails today", "23"], ["Replies", "4"], ["Meetings booked", "1"]].map(([l, v]) => (
              <div key={l} style={css("background:#fff;border:1px solid #ECECF1;border-radius:14px;padding:14px 16px")}>
                <div style={css("font-size:11.5px;color:#71717A")}>{l}</div>
                <div style={css("font-size:22px;font-weight:700;margin-top:4px")}>{v}</div>
              </div>
            ))}
          </div>
          <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:16px 18px")}>
            <div style={css("font-size:13.5px;font-weight:700;margin-bottom:10px")}>Recent accomplishments</div>
            <div style={css("display:flex;flex-direction:column;gap:9px")}>
              {["Booked Datadog VP Eng — Thursday 2pm", "Got a positive reply from Brex on the latency angle", "Sequence B reply rate reached 27%"].map((w) => (
                <div key={w} style={css("display:flex;gap:9px;align-items:center;font-size:12.5px;color:#3F3F46")}><span style={css("color:#2FA45C;font-weight:700")}>✓</span>{w}</div>
              ))}
            </div>
          </div>
        </div>
        <div style={css("display:flex;flex-direction:column;gap:14px")}>
          <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:16px 18px")}>
            <div style={css("font-size:13.5px;font-weight:700;margin-bottom:10px")}>Goals</div>
            <div style={css("display:flex;flex-direction:column;gap:8px")}>
              {goals.map((g) => <div key={g} style={css("font-size:12px;color:#3F3F46;background:#FAFAFB;border:1px solid #F0F0F3;border-radius:10px;padding:8px 11px")}>{g}</div>)}
            </div>
          </div>
          <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:16px 18px")}>
            <div style={css("font-size:13.5px;font-weight:700;margin-bottom:10px")}>Next actions</div>
            <div style={css("display:flex;flex-direction:column;gap:9px")}>
              {["Contact remaining 14 Fintech CTOs", "Follow up with double-openers", "Prep Datadog meeting brief"].map((n) => (
                <div key={n} style={css("display:flex;gap:9px;align-items:center;font-size:12px;color:#3F3F46")}><span style={css("width:7px;height:7px;border-radius:50%;background:#5122C1;flex:none")} />{n}</div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Leads */}
      <SectionTitle id="sec-leads">Leads</SectionTitle>
      <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;overflow:hidden;animation:fadeUp .25s ease")}>
        <div style={css("display:grid;grid-template-columns:1.4fr 1.2fr .8fr .6fr .9fr 1fr;padding:11px 18px;font-size:11px;font-weight:600;color:#71717A;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #ECECF1;background:#FAFAFB;gap:10px")}>
          <div>Lead</div><div>Company</div><div>Status</div><div>Score</div><div>Last contact</div><div>Campaign</div>
        </div>
        {leadsMaster.map((l) => (
          <div key={l.name} style={css("display:grid;grid-template-columns:1.4fr 1.2fr .8fr .6fr .9fr 1fr;padding:12px 18px;font-size:12.5px;border-bottom:1px solid #F4F4F6;align-items:center;gap:10px")}>
            <div style={css("font-weight:600")}>{l.name}<div style={css("font-size:11px;color:#A1A1AA;font-weight:400")}>{l.title}</div></div>
            <div style={css("color:#3F3F46")}>{l.company}</div>
            <div><span style={css(chip(leadStatusColors[l.status][0], leadStatusColors[l.status][1]))}>{l.status}</span></div>
            <div style={css("font-weight:700;color:#5122C1")}>{l.score}</div>
            <div style={css("color:#71717A")}>{l.last}</div>
            <div style={css("color:#71717A;font-size:12px")}>{l.campaign}</div>
          </div>
        ))}
      </div>

      {/* Emails */}
      <SectionTitle id="sec-emails">Emails</SectionTitle>
      <div style={css("display:flex;flex-direction:column;gap:14px;animation:fadeUp .25s ease")}>
        <div style={css("display:grid;grid-template-columns:repeat(5,1fr);gap:14px")}>
          {emailDefs.map((d, i) => {
            const p = pastel[i % 4];
            return (
              <div key={d[0]} style={css("background:" + p.bg + ";border:1px solid " + p.bd + ";border-radius:14px;padding:20px 16px;text-align:center")}>
                <div style={css("font-size:13px;font-weight:600;color:" + p.fg)}>{d[0]}</div>
                <div style={css("font-size:34px;font-weight:700;margin-top:6px;color:#18181B")}>{d[1]}</div>
              </div>
            );
          })}
        </div>
        <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:16px 18px")}>
          <div style={css("font-size:13.5px;font-weight:700;margin-bottom:12px")}>Email timeline</div>
          <div style={css("display:flex;flex-direction:column")}>
            {emailTimeline.map((et, i) => (
              <div key={i} style={css("display:flex;gap:14px;padding:10px 0;border-bottom:1px solid #F4F4F6;align-items:center")}>
                <span style={css(chip(et.c[0], et.c[1]))}>{et.type}</span>
                <div style={css("font-size:12.5px;color:#3F3F46;font-weight:500")}>{et.subject}<div style={css("font-size:11px;color:#A1A1AA;font-weight:400")}>to {et.to}</div></div>
                <div style={css("margin-left:auto;font-size:11px;color:#A1A1AA")}>{et.time}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Reach Outs */}
      <SectionTitle id="sec-reach">Reach outs</SectionTitle>
      <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:20px 22px;animation:fadeUp .25s ease")}>
        <div style={css("display:flex;flex-direction:column")}>
          {reach.map((r, i) => (
            <div key={i} style={css("display:flex;gap:16px")}>
              <div style={css("display:flex;flex-direction:column;align-items:center")}>
                <div style={css("width:12px;height:12px;border-radius:50%;background:" + r.c[1] + ";border:3px solid " + r.c[0] + ";flex:none;margin-top:2px")} />
                <div style={css("width:2px;flex:1;background:#F0F0F3")} />
              </div>
              <div style={css("padding-bottom:20px;min-width:0;flex:1")}>
                <div style={css("display:flex;align-items:center;gap:8px")}><span style={css(chip(r.c[0], r.c[1]))}>{r.type}</span><span style={css("font-size:11px;color:#A1A1AA")}>{r.time}</span></div>
                <div style={css("font-size:13px;font-weight:600;margin-top:6px")}>{r.title}</div>
                <div style={css("font-size:12px;color:#71717A;margin-top:2px")}>{r.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tasks */}
      <SectionTitle id="sec-tasks">Tasks</SectionTitle>
      <div style={css("display:flex;flex-direction:column;gap:10px;animation:fadeUp .25s ease")}>
        {taskDefs.map((t, i) => (
          <div key={i} style={css("background:#fff;border:1px solid #ECECF1;border-radius:14px;padding:14px 18px;display:flex;align-items:center;gap:14px")}>
            <span style={css("display:inline-flex;align-items:center;gap:5px;" + chip(t[4], t[5]))}><span style={css("width:6px;height:6px;border-radius:50%;background:" + t[6])} />{t[0]}</span>
            <div style={css("font-size:13px;font-weight:600")}>{t[1]}<div style={css("font-size:11.5px;color:#A1A1AA;font-weight:400;margin-top:1px")}>{t[2]}</div></div>
            <div style={css("margin-left:auto;font-size:11px;color:#A1A1AA")}>{t[3]}</div>
          </div>
        ))}
      </div>

      {/* Performance */}
      <SectionTitle id="sec-analytics">Performance</SectionTitle>
      <div style={css("display:flex;flex-direction:column;gap:14px;animation:fadeUp .25s ease")}>
        <div style={css("display:grid;grid-template-columns:repeat(4,1fr);gap:14px")}>
          {kpiDefs.map((k) => (
            <div key={k[0]} style={css("background:#fff;border:1px solid #ECECF1;border-radius:14px;padding:14px 16px")}>
              <div style={css("font-size:11.5px;color:#71717A")}>{k[0]}</div>
              <div style={css("font-size:22px;font-weight:700;margin-top:4px")}>{k[1]}</div>
              <div style={css("display:inline-block;font-size:11px;font-weight:600;margin-top:6px;border-radius:99px;padding:2px 8px;color:#1B7A3D;background:#E7F7EC")}>{k[2]}</div>
            </div>
          ))}
        </div>
        <div style={css("display:grid;grid-template-columns:1fr 1fr;gap:14px")}>
          <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:16px 18px")}>
            <div style={css("font-size:13px;font-weight:700;margin-bottom:12px")}>Weekly outreach</div>
            <div style={css("display:flex;align-items:flex-end;gap:8px;height:110px")}>
              {weekVals.map((v, i) => (
                <div key={i} style={css("flex:1;display:flex;flex-direction:column;align-items:center;gap:5px;height:100%;justify-content:flex-end")}>
                  <div style={css("width:100%;max-width:34px;background:linear-gradient(180deg,#8B5CF6,#5122C1);border-radius:6px 6px 3px 3px;height:" + v + "%")} />
                  <div style={css("font-size:10px;color:#A1A1AA")}>{days[i]}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:16px 18px")}>
            <div style={css("font-size:13px;font-weight:700;margin-bottom:12px")}>Activity heatmap</div>
            <div style={css("display:grid;grid-template-columns:repeat(12,1fr);gap:4px")}>
              {heatSeed.map((v, i) => <div key={i} style={css("aspect-ratio:1;border-radius:4px;background:" + heatShades[v])} />)}
            </div>
            <div style={css("display:flex;gap:6px;margin-top:10px;font-size:10px;color:#A1A1AA;align-items:center")}>
              Less<span style={css("width:9px;height:9px;border-radius:3px;background:#F1EDFD")} /><span style={css("width:9px;height:9px;border-radius:3px;background:#C9B8F5")} /><span style={css("width:9px;height:9px;border-radius:3px;background:#8B5CF6")} /><span style={css("width:9px;height:9px;border-radius:3px;background:#5122C1")} />More
            </div>
          </div>
        </div>
      </div>

      {/* Memory */}
      <SectionTitle id="sec-memory">Memory</SectionTitle>
      <div style={css("display:grid;grid-template-columns:1fr 1fr;gap:14px;animation:fadeUp .25s ease")}>
        {memory.map((mm) => (
          <div key={mm.title} style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:16px 18px")}>
            <div style={css("display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700")}>
              <span style={css("width:26px;height:26px;border-radius:8px;background:" + mm.bg + ";display:flex;align-items:center;justify-content:center;font-size:13px")}>{mm.icon}</span>{mm.title}
            </div>
            <div style={css("display:flex;flex-direction:column;gap:7px;margin-top:11px")}>
              {mm.items.map((mi) => <div key={mi} style={css("font-size:12px;color:#3F3F46;background:#FAFAFB;border:1px solid #F0F0F3;border-radius:9px;padding:7px 11px")}>{mi}</div>)}
            </div>
          </div>
        ))}
      </div>

      {/* Configuration */}
      <SectionTitle id="sec-settings">Configuration</SectionTitle>
      <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:20px 22px;max-width:640px;display:flex;flex-direction:column;gap:16px;animation:fadeUp .25s ease")}>
        <div>
          <div style={css("font-size:12px;font-weight:600;color:#3F3F46;margin-bottom:6px")}>Role</div>
          <select
            value={cfgRole}
            onChange={(e) => setCfgRole(e.target.value)}
            style={css("width:100%;border:1px solid #E4E4E7;border-radius:10px;padding:9px 13px;font-size:13px;color:#18181B;background:#fff;cursor:pointer;appearance:none;outline:none")}
          >
            {(ROLE_OPTIONS.includes(cfgRole) ? ROLE_OPTIONS : [cfgRole, ...ROLE_OPTIONS]).map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
        <div>
          <div style={css("font-size:12px;font-weight:600;color:#3F3F46;margin-bottom:6px")}>Goal</div>
          <textarea
            value={cfgGoal}
            onChange={(e) => setCfgGoal(e.target.value)}
            rows={3}
            style={css("width:100%;border:1px solid #E4E4E7;border-radius:10px;padding:11px 13px;font-size:12.5px;color:#3F3F46;line-height:1.6;resize:vertical;font-family:inherit;outline:none")}
          />
        </div>
        <div><div style={css("font-size:12px;font-weight:600;color:#3F3F46;margin-bottom:6px")}>Prospect targeting</div><div style={css("display:flex;gap:6px;flex-wrap:wrap")}>{["SaaS", "51–200 employees", "CTO / VP Eng", "North America"].map((tg) => <span key={tg} style={css("font-size:11.5px;font-weight:600;color:#5122C1;background:#F1EDFD;border-radius:99px;padding:4px 12px")}>{tg}</span>)}</div></div>
        <div>
          <div style={css("font-size:12px;font-weight:600;color:#3F3F46;margin-bottom:6px")}>Permissions</div>
          <div style={css("display:flex;flex-direction:column;gap:8px")}>
            {PERM_DEFS.map(([key, label]) => {
              const on = !!cfgPerms[key];
              return (
                <div key={key} style={css("display:flex;align-items:center;font-size:12.5px;color:#3F3F46")}>{label}
                  <Box
                    onClick={() => setCfgPerms((p) => ({ ...p, [key]: !p[key] }))}
                    aria-label={"Toggle " + label}
                    style={"margin-left:auto;width:34px;height:20px;border-radius:99px;padding:2px;display:flex;cursor:pointer;transition:background .15s;background:" + (on ? "#5122C1" : "#E4E4E7") + ";justify-content:" + (on ? "flex-end" : "flex-start")}
                  ><span style={css("width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.15)")} /></Box>
                </div>
              );
            })}
          </div>
        </div>
        <Btn onClick={() => saveConfig(sel.id, { role: cfgRole, goal: cfgGoal, permissions: cfgPerms })} style="background:#5122C1;color:#fff;border:none;border-radius:99px;padding:9px 20px;font-size:12.5px;font-weight:600;cursor:pointer;align-self:flex-start" styleHover="background:#42199E">Save changes</Btn>
      </div>
    </div>
  );
}
