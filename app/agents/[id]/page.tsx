"use client";
import { useState, useEffect, useMemo, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useApp } from "@/lib/store";
import { statusMeta } from "@/lib/data";
import { buildAgentDetail } from "@/lib/agentDetail";
import { av, chip } from "@/lib/visuals";
import { css, Box, Btn } from "@/components/primitives";
import { listLeads, listDraftsForAgent, markDraftSent } from "@/lib/leads/actions";
import { enqueueOutreachJob, enqueueJob, getJob } from "@/lib/jobs/actions";
import type { DraftDTO, LeadDTO } from "@/lib/leads/types";
import Link from "next/link";

const TABS: [string, string][] = [
  ["overview", "Overview"], ["leads", "Leads"], ["emails", "Emails"], ["reach", "Reach Outs"],
  ["tasks", "Tasks"], ["analytics", "Performance"], ["memory", "Memory"], ["settings", "Configuration"],
];

const days = ["M", "T", "W", "T", "F", "S", "S"];
const heatShades = ["#F1EDFD", "#DCD2F8", "#C9B8F5", "#A88CF0", "#8B5CF6", "#5122C1"];
// [key, label, default] — key is the stable id stored in agent_config.permissions.
const PERM_DEFS: [string, string, boolean][] = [
  ["emails", "Send emails autonomously", true],
  ["meetings", "Book meetings on your calendar", true],
  ["calls", "Make phone calls", false],
];
const ROLE_OPTIONS = ["SDR", "BDR", "Account Executive", "Sales Manager", "Customer Success", "Recruiter"];
const LEAD_STAGE_COLORS: Record<string, [string, string]> = {
  new: ["#F4F4F5", "#71717A"], contacted: ["#FEF6E8", "#B45309"], engaged: ["#E9F5FE", "#0369A1"],
  replied: ["#E7F7EC", "#1B7A3D"], meeting: ["#F1EDFD", "#5122C1"],
};

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

  const paused = sel ? !!s.paused[sel.id] : false;
  // Deterministic, agent-specific content for every sub-tab (derived from the
  // agent's own role/task/score/status — see lib/agentDetail).
  const detail = useMemo(
    () => (sel ? buildAgentDetail(sel, { paused, userName: s.userName, roster: agents }) : null),
    [sel, paused, s.userName, agents]
  );

  const [agentLeads, setAgentLeads] = useState<LeadDTO[]>([]);
  useEffect(() => {
    if (selId) listLeads({ agentId: selId }).then(setAgentLeads);
  }, [selId]);

  const [drafts, setDrafts] = useState<DraftDTO[]>([]);
  const [runningOutreach, setRunningOutreach] = useState(false);
  const [runningScrape, setRunningScrape] = useState(false);
  const [scrapeNote, setScrapeNote] = useState("");

  const refetchDrafts = useCallback(async (id: string) => {
    setDrafts(await listDraftsForAgent(id));
  }, []);
  useEffect(() => {
    if (selId) refetchDrafts(selId);
  }, [selId, refetchDrafts]);

  const runOutreachForAgent = useCallback(async () => {
    if (!sel) return;
    setRunningOutreach(true);
    const res = await enqueueOutreachJob({ agent: { id: sel.id, name: sel.name, role: sel.role, goal: sel.goal, task: sel.task } });
    if (!("error" in res)) {
      try { await fetch("/api/jobs/run", { method: "POST" }); } catch { /* best-effort trigger; drafts are refetched below regardless */ }
    }
    setRunningOutreach(false);
    refetchDrafts(sel.id);
  }, [sel, refetchDrafts]);

  const runScrape = useCallback(async () => {
    if (!sel) return;
    setRunningScrape(true);
    setScrapeNote("");
    const res = await enqueueJob({
      agent: { id: sel.id, name: sel.name, role: sel.role, goal: sel.goal, task: sel.task },
      kind: "scrape", capabilities: sel.capabilities, target: 10,
    });
    if ("error" in res) { setScrapeNote(res.error); setRunningScrape(false); return; }
    // Poll the worker's progress. The Python worker (not this browser) runs it.
    const jobId = res.jobId;
    let waited = 0;
    const poll = async (): Promise<void> => {
      const job = await getJob(jobId);
      if (!job) { setScrapeNote("Job not found."); setRunningScrape(false); return; }
      const r = (job.result ?? {}) as { leadsFound?: number; steps?: number };
      if (job.status === "done") {
        setScrapeNote(`Found ${r.leadsFound ?? 0} lead${r.leadsFound === 1 ? "" : "s"}.`);
        setRunningScrape(false);
        listLeads({ agentId: sel.id }).then(setAgentLeads);
        return;
      }
      if (job.status === "failed") { setScrapeNote("Scrape failed: " + (job.error ?? "unknown")); setRunningScrape(false); return; }
      if (job.status === "queued" && waited > 12) setScrapeNote("Waiting for the scraper worker to start…");
      else setScrapeNote(`Working… ${r.steps ?? 0} steps, ${r.leadsFound ?? 0} found`);
      waited++;
      setTimeout(poll, 2500);
    };
    poll();
  }, [sel]);

  const sendDraft = useCallback((d: DraftDTO) => {
    // Recipient stays literal (RFC 6068 addr-spec); only the query params are encoded.
    const url = "mailto:" + d.leadEmail + "?subject=" + encodeURIComponent(d.subject) + "&body=" + encodeURIComponent(d.body);
    window.open(url, "_blank");
  }, []);

  const confirmSent = useCallback(async (d: DraftDTO) => {
    await markDraftSent(d.id);
    if (selId) refetchDrafts(selId);
  }, [selId, refetchDrafts]);

  if (!sel || !detail) return null;
  const selM = statusMeta(paused ? "waiting" : sel.status);

  const gotoTab = (key: string) => {
    setTab(key);
    const el = document.getElementById("sec-" + key);
    const sc = document.getElementById("mainScroll");
    const bar = document.getElementById("detailTabBar");
    const off = (bar ? bar.offsetHeight : 46) + 12;
    if (el && sc) sc.scrollTo({ top: el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - off, behavior: "smooth" });
  };

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
              {detail.summary}
            </div>
          </div>
          <div style={css("display:grid;grid-template-columns:repeat(3,1fr);gap:14px")}>
            {detail.overviewStats.map(([l, v]) => (
              <div key={l} style={css("background:#fff;border:1px solid #ECECF1;border-radius:14px;padding:14px 16px")}>
                <div style={css("font-size:11.5px;color:#71717A")}>{l}</div>
                <div style={css("font-size:22px;font-weight:700;margin-top:4px")}>{v}</div>
              </div>
            ))}
          </div>
          <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:16px 18px")}>
            <div style={css("font-size:13.5px;font-weight:700;margin-bottom:10px")}>Recent accomplishments</div>
            <div style={css("display:flex;flex-direction:column;gap:9px")}>
              {detail.accomplishments.map((w) => (
                <div key={w} style={css("display:flex;gap:9px;align-items:center;font-size:12.5px;color:#3F3F46")}><span style={css("color:#2FA45C;font-weight:700")}>✓</span>{w}</div>
              ))}
            </div>
          </div>
        </div>
        <div style={css("display:flex;flex-direction:column;gap:14px")}>
          <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:16px 18px")}>
            <div style={css("font-size:13.5px;font-weight:700;margin-bottom:10px")}>Goals</div>
            <div style={css("display:flex;flex-direction:column;gap:8px")}>
              {detail.goals.map((g) => <div key={g} style={css("font-size:12px;color:#3F3F46;background:#FAFAFB;border:1px solid #F0F0F3;border-radius:10px;padding:8px 11px")}>{g}</div>)}
            </div>
          </div>
          <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:16px 18px")}>
            <div style={css("font-size:13.5px;font-weight:700;margin-bottom:10px")}>Next actions</div>
            <div style={css("display:flex;flex-direction:column;gap:9px")}>
              {detail.nextActions.map((n) => (
                <div key={n} style={css("display:flex;gap:9px;align-items:center;font-size:12px;color:#3F3F46")}><span style={css("width:7px;height:7px;border-radius:50%;background:#5122C1;flex:none")} />{n}</div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Leads */}
      <SectionTitle id="sec-leads">Leads</SectionTitle>
      <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;overflow:hidden;animation:fadeUp .25s ease")}>
        <div style={css("display:flex;align-items:center;padding:11px 18px;border-bottom:1px solid #ECECF1;background:#FAFAFB")}>
          <div style={css("font-size:11px;font-weight:600;color:#71717A;text-transform:uppercase;letter-spacing:.05em")}>{agentLeads.length} lead{agentLeads.length === 1 ? "" : "s"}</div>
          {sel.capabilities?.includes("scrape") && (
            <Btn onClick={runScrape} style={"margin-left:auto;background:#5122C1;color:#fff;border:none;border-radius:99px;padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer;" + (runningScrape ? "opacity:.6" : "")} styleHover="background:#42199E">{runningScrape ? "Finding…" : "Find leads"}</Btn>
          )}
          <Link href="/leads" style={{ ...css((sel.capabilities?.includes("scrape") ? "margin-left:14px;" : "margin-left:auto;") + "font-size:12px;font-weight:600;color:#5122C1;text-decoration:none") }}>Open Leads module →</Link>
        </div>
        {scrapeNote && <div style={css("padding:9px 18px;font-size:12px;color:#71717A;border-bottom:1px solid #ECECF1")}>{scrapeNote}</div>}
        {agentLeads.length === 0 ? (
          <div style={css("padding:18px;font-size:12.5px;color:#A1A1AA")}>No leads assigned to {sel.name} yet. Add one in the Leads module.</div>
        ) : (
          <>
            <div style={css("display:grid;grid-template-columns:1.4fr 1.2fr .9fr .6fr .9fr;padding:11px 18px;font-size:11px;font-weight:600;color:#71717A;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #ECECF1;gap:10px")}>
              <div>Name</div><div>Company</div><div>Status</div><div>Score</div><div>Added</div>
            </div>
            {agentLeads.map((l) => {
              const sc = LEAD_STAGE_COLORS[l.status] || LEAD_STAGE_COLORS.new;
              return (
                <div key={l.id} style={css("display:grid;grid-template-columns:1.4fr 1.2fr .9fr .6fr .9fr;padding:12px 18px;font-size:12.5px;border-bottom:1px solid #F4F4F6;align-items:center;gap:10px")}>
                  <div style={css("font-weight:600")}>{l.name}<div style={css("font-size:11px;color:#A1A1AA;font-weight:400")}>{l.title || l.email}</div></div>
                  <div style={css("color:#3F3F46")}>{l.company || "—"}</div>
                  <div><span style={css(chip(sc[0], sc[1]))}>{l.status}</span></div>
                  <div style={css("font-weight:700;color:#5122C1")}>{l.score || "—"}</div>
                  <div style={css("color:#71717A")}>{new Date(l.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Emails */}
      <SectionTitle id="sec-emails">Emails</SectionTitle>
      <div style={css("display:flex;flex-direction:column;gap:14px;animation:fadeUp .25s ease")}>
        <div style={css("display:flex;align-items:center;gap:10px")}>
          <div style={css("font-size:12.5px;color:#71717A")}>{drafts.length} draft{drafts.length === 1 ? "" : "s"} · {drafts.filter((d) => d.status === "sent").length} sent</div>
          {sel.capabilities?.includes("outreach") && (
            <Btn onClick={runOutreachForAgent} style={"margin-left:auto;background:#5122C1;color:#fff;border:none;border-radius:99px;padding:8px 16px;font-size:12.5px;font-weight:600;cursor:pointer;" + (runningOutreach ? "opacity:.6" : "")} styleHover="background:#42199E">{runningOutreach ? "Running…" : "Run outreach"}</Btn>
          )}
        </div>
        {drafts.length === 0 ? (
          <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:22px;font-size:12.5px;color:#A1A1AA")}>No drafts yet. Add leads in the Leads tab, then hit “Run outreach”.</div>
        ) : drafts.map((d) => (
          <div key={d.id} style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:16px 18px")}>
            <div style={css("display:flex;align-items:center;gap:8px")}>
              <span style={css(chip(d.status === "sent" ? "#E7F7EC" : "#F1EDFD", d.status === "sent" ? "#1B7A3D" : "#5122C1"))}>{d.status === "sent" ? "Sent" : "Draft"}</span>
              <div style={css("font-size:11.5px;color:#A1A1AA")}>to {d.leadName}{d.leadCompany ? " · " + d.leadCompany : ""} · {d.leadEmail}</div>
            </div>
            <div style={css("font-size:13.5px;font-weight:700;margin-top:10px")}>{d.subject}</div>
            <div style={css("font-size:12.5px;color:#3F3F46;line-height:1.6;margin-top:6px;white-space:pre-wrap")}>{d.body}</div>
            <div style={css("display:flex;gap:8px;margin-top:12px")}>
              <Btn onClick={() => sendDraft(d)} style="background:#EEE9F8;color:#5122C1;border:none;border-radius:99px;padding:7px 16px;font-size:12px;font-weight:600;cursor:pointer" styleHover="background:#E3DBF9">Open in mail</Btn>
              {d.status !== "sent" && <Btn onClick={() => confirmSent(d)} style="background:#F4F4F5;color:#3F3F46;border:none;border-radius:99px;padding:7px 16px;font-size:12px;font-weight:600;cursor:pointer" styleHover="background:#E4E4E7">Mark sent</Btn>}
            </div>
          </div>
        ))}
      </div>

      {/* Reach Outs */}
      <SectionTitle id="sec-reach">Reach outs</SectionTitle>
      <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:20px 22px;animation:fadeUp .25s ease")}>
        <div style={css("display:flex;flex-direction:column")}>
          {detail.reach.map((r, i) => (
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
        {detail.tasks.map((t, i) => (
          <div key={i} style={css("background:#fff;border:1px solid #ECECF1;border-radius:14px;padding:14px 18px;display:flex;align-items:center;gap:14px")}>
            <span style={css("display:inline-flex;align-items:center;gap:5px;" + chip(t.bg, t.fg))}><span style={css("width:6px;height:6px;border-radius:50%;background:" + t.dot)} />{t.status}</span>
            <div style={css("font-size:13px;font-weight:600")}>{t.title}<div style={css("font-size:11.5px;color:#A1A1AA;font-weight:400;margin-top:1px")}>{t.sub}</div></div>
            <div style={css("margin-left:auto;font-size:11px;color:#A1A1AA")}>{t.time}</div>
          </div>
        ))}
      </div>

      {/* Performance */}
      <SectionTitle id="sec-analytics">Performance</SectionTitle>
      <div style={css("display:flex;flex-direction:column;gap:14px;animation:fadeUp .25s ease")}>
        <div style={css("display:grid;grid-template-columns:repeat(4,1fr);gap:14px")}>
          {detail.kpis.map((k) => (
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
              {detail.weekVals.map((v, i) => (
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
              {detail.heat.map((v, i) => <div key={i} style={css("aspect-ratio:1;border-radius:4px;background:" + heatShades[v])} />)}
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
        {detail.memory.map((mm) => (
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
