"use client";
import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useApp } from "@/lib/store";
import { statusMeta } from "@/lib/data";
import { av, chip } from "@/lib/visuals";
import { css, Box, Btn } from "@/components/primitives";
import { listWorkbook, listDraftsForAgent, markDraftSent } from "@/lib/leads/actions";
import { enqueueOutreachJob, enqueueJob } from "@/lib/jobs/actions";
import type { DraftDTO, LeadDTO } from "@/lib/leads/types";
import { CAPABILITIES, AGENT_TYPES } from "@/lib/agentTypes";
import { useLiveWork } from "@/lib/useLiveWork";
import { WorkedBy, LivePulse } from "@/components/LeadBits";
import Link from "next/link";
import { getAgentStats } from "@/lib/agents/actions";
import type { AgentStats } from "@/lib/agents/stats";
import { listProposalsForAgent, markProposalSent } from "@/lib/proposals/actions";
import type { ProposalDTO } from "@/lib/proposals/store";

// [key, label, requiredCapability?] — no capability ⇒ always shown.
const SECTIONS: [string, string, string?][] = [
  ["overview", "Overview"],
  ["leads", "Leads"],
  ["research", "Research", "research"],
  ["emails", "Emails", "outreach"],
  ["proposal", "Proposals", "proposal"],
  ["reach", "Reach Outs", "follow-up"],
  ["meetings", "Meetings", "book-meeting"],
  ["tasks", "Tasks"],
  ["analytics", "Performance"],
  ["settings", "Configuration"],
];

// Booking-window hours + a small select style for the Meeting agent's settings.
const HOURS = Array.from({ length: 11 }, (_, i) => i + 8); // 8 AM … 6 PM
const fmtHour = (h: number) => (h === 12 ? "12 PM" : h > 12 ? `${h - 12} PM` : `${h} AM`);
const MSEL = "border:1px solid #E4E4E7;border-radius:8px;padding:6px 9px;font-size:12px;color:#18181B;background:#fff;outline:none;cursor:pointer";

// Role choices mirror the current agent-type catalog so the dropdown reflects
// every kind of agent the app can build (Assessor, Meeting Booker, …), not a
// stale hand-picked subset. "Custom" is excluded — it isn't a role.
const ROLE_OPTIONS = AGENT_TYPES.filter((t) => !t.custom).map((t) => t.label);
const LEAD_STAGE_COLORS: Record<string, [string, string]> = {
  new: ["#F4F4F5", "#71717A"], contacted: ["#FEF6E8", "#B45309"], engaged: ["#E9F5FE", "#0369A1"],
  replied: ["#E7F7EC", "#1B7A3D"], meeting: ["#EAF2FF", "#006AFF"],
};
const ACT_META: Record<string, { label: string; c: [string, string] }> = {
  lead_added: { label: "Lead added", c: ["#F4F4F5", "#71717A"] },
  lead_researched: { label: "Researched", c: ["#EAF2FF", "#006AFF"] },
  lead_qualified: { label: "Qualified", c: ["#E9F5FE", "#0369A1"] },
  email_drafted: { label: "Drafted", c: ["#FEF6E8", "#B45309"] },
  email_sent: { label: "Sent", c: ["#E7F7EC", "#1B7A3D"] },
};
function actMeta(type: string) { return ACT_META[type] ?? { label: type, c: ["#F4F4F5", "#71717A"] as [string, string] }; }
function relTime(iso: string): string { return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
// Lead-qualification tier chip from the persisted score: [bg, fg, label].
const tierChip = (score: number): [string, string, string] => score >= 75 ? ["#FEECEC", "#B91C1C", "Hot"] : score >= 50 ? ["#FEF6E8", "#B45309", "Warm"] : score > 0 ? ["#E9F5FE", "#0369A1", "Cold"] : ["#F4F4F5", "#A1A1AA", "—"];

function SectionTitle({ id, children }: { id: string; children: React.ReactNode }) {
  return <div id={id} style={css("font-family:'General Sans',Inter,sans-serif;font-size:15px;font-weight:700;margin-top:4px")}>{children}</div>;
}

export default function AgentDetail() {
  const { s, agents, byId, togglePause, deleteAgent, saveConfig, showToast } = useApp();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [tab, setTab] = useState("overview");
  const { byLead } = useLiveWork();

  const sel = byId(params.id) || agents[0];

  // Editable Configuration state (role + goal), seeded from the config-applied
  // agent. Reset whenever the viewed agent changes (route stays mounted).
  const selId = sel?.id;
  const [cfgRole, setCfgRole] = useState(sel?.role ?? "");
  const [cfgGoal, setCfgGoal] = useState(sel?.goal ?? "");
  useEffect(() => {
    if (!selId) return;
    setTab("overview");
    setCfgRole(sel.role);
    setCfgGoal(sel.goal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selId]);

  const paused = sel ? !!s.paused[sel.id] : false;

  const [agentLeads, setAgentLeads] = useState<LeadDTO[]>([]);
  useEffect(() => {
    if (selId) listWorkbook(selId).then(setAgentLeads);
  }, [selId]);

  const [stats, setStats] = useState<AgentStats | null>(null);
  useEffect(() => {
    if (selId) getAgentStats(selId).then(setStats);
  }, [selId]);

  const [drafts, setDrafts] = useState<DraftDTO[]>([]);
  const [runningOutreach, setRunningOutreach] = useState(false);
  const [runningScrape, setRunningScrape] = useState(false);
  const [runningResearch, setRunningResearch] = useState(false);
  const [runningQualify, setRunningQualify] = useState(false);
  const [scrapeNote, setScrapeNote] = useState("");

  const refetchDrafts = useCallback(async (id: string) => {
    setDrafts(await listDraftsForAgent(id));
  }, []);
  useEffect(() => {
    if (selId) refetchDrafts(selId);
  }, [selId, refetchDrafts]);

  const [proposals, setProposals] = useState<ProposalDTO[]>([]);
  const [runningProposal, setRunningProposal] = useState(false);
  useEffect(() => {
    if (selId) listProposalsForAgent(selId).then(setProposals);
  }, [selId]);

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
    // Scraping is instruction-driven — ask what to look for (no stored ICP).
    const instruction = window.prompt("What leads should " + sel.name.split(" ")[0] + " look for?\n(e.g. \"property buyers near Makati\", \"startups hiring SDRs in the US\")");
    if (!instruction || !instruction.trim()) return;
    setRunningScrape(true);
    setScrapeNote("Finding leads…");
    const res = await enqueueJob({
      agent: { id: sel.id, name: sel.name, role: sel.role, goal: sel.goal, task: sel.task },
      kind: "scrape", capabilities: sel.capabilities, target: 10, instruction: instruction.trim(),
    });
    if ("error" in res) { setScrapeNote(res.error); setRunningScrape(false); return; }
    try {
      const r = await fetch("/api/scrape", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: res.jobId }) });
      const data = (await r.json().catch(() => ({}))) as { leadsFound?: number; error?: string; note?: string };
      if (!r.ok || data.error) setScrapeNote(data.error ?? "Scrape failed.");
      else if (data.note === "already running") setScrapeNote("That scrape is already running — hang tight.");
      else setScrapeNote(`Found ${data.leadsFound ?? 0} lead${data.leadsFound === 1 ? "" : "s"} to review — open the Leads module’s Pending tab.`);
    } catch { setScrapeNote("Scrape failed — please try again."); }
    setRunningScrape(false);
    listWorkbook(sel.id).then(setAgentLeads);
  }, [sel]);

  const runResearch = useCallback(async () => {
    if (!sel) return;
    setRunningResearch(true);
    const res = await enqueueJob({
      agent: { id: sel.id, name: sel.name, role: sel.role, goal: sel.goal, task: sel.task },
      kind: "research", capabilities: sel.capabilities,
    });
    if (!("error" in res)) {
      try { await fetch("/api/jobs/run", { method: "POST" }); } catch { /* best-effort; leads refetched below */ }
    } else { showToast(res.error); }
    setRunningResearch(false);
    listWorkbook(sel.id).then(setAgentLeads);
  }, [sel]);

  const runQualify = useCallback(async () => {
    if (!sel) return;
    setRunningQualify(true);
    const res = await enqueueJob({
      agent: { id: sel.id, name: sel.name, role: sel.role, goal: sel.goal, task: sel.task },
      kind: "qualify", capabilities: sel.capabilities,
    });
    if (!("error" in res)) {
      try { await fetch("/api/jobs/run", { method: "POST" }); } catch { /* best-effort; leads refetched below */ }
    } else { showToast(res.error); }
    setRunningQualify(false);
    listWorkbook(sel.id).then(setAgentLeads);
  }, [sel]);

  const runProposals = useCallback(async () => {
    if (!sel) return;
    setRunningProposal(true);
    const res = await enqueueJob({
      agent: { id: sel.id, name: sel.name, role: sel.role, goal: sel.goal, task: sel.task },
      kind: "proposal", capabilities: sel.capabilities,
    });
    if (!("error" in res)) {
      try { await fetch("/api/jobs/run", { method: "POST" }); } catch { /* best-effort; proposals refetched below */ }
    } else { showToast(res.error); }
    setRunningProposal(false);
    listProposalsForAgent(sel.id).then(setProposals);
  }, [sel]);

  const sendDraft = useCallback((d: DraftDTO) => {
    // Recipient stays literal (RFC 6068 addr-spec); only the query params are encoded.
    const url = "mailto:" + d.leadEmail + "?subject=" + encodeURIComponent(d.subject) + "&body=" + encodeURIComponent(d.body);
    window.open(url, "_blank");
  }, []);

  const copyMessage = useCallback((d: DraftDTO) => {
    navigator.clipboard?.writeText(d.body).then(() => showToast("Message copied"), () => showToast("Copy failed"));
  }, [showToast]);
  const openProfile = useCallback((url: string) => { window.open(url, "_blank"); }, []);

  const confirmSent = useCallback(async (d: DraftDTO) => {
    await markDraftSent(d.id);
    if (selId) refetchDrafts(selId);
  }, [selId, refetchDrafts]);

  if (!sel) return null;
  const selM = statusMeta(paused ? "waiting" : sel.status);

  const caps = sel.capabilities ?? [];
  const visibleSections = SECTIONS.filter(([, , cap]) => !cap || caps.includes(cap));
  const isVisible = (key: string) => visibleSections.some(([k]) => k === key);
  const researchedLeads = agentLeads.filter((l) => l.research);

  const capMode = (cap: string): "auto" | "ask" =>
    ((s.agentConfig[sel.id]?.settings?.[cap] as { mode?: string } | undefined)?.mode === "ask" ? "ask" : "auto");
  const setCapMode = (cap: string, mode: "auto" | "ask") => {
    const cur = s.agentConfig[sel.id]?.settings ?? {};
    saveConfig(sel.id, { settings: { ...cur, [cap]: { ...(cur[cap] ?? {}), mode } } });
  };
  const capSetting = (cap: string) => (s.agentConfig[sel.id]?.settings?.[cap] ?? {}) as Record<string, unknown>;
  const setCapSetting = (cap: string, patch: Record<string, unknown>) => {
    const cur = s.agentConfig[sel.id]?.settings ?? {};
    saveConfig(sel.id, { settings: { ...cur, [cap]: { ...(cur[cap] ?? {}), ...patch } } });
  };

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
      <Box onClick={() => router.push("/agents")} style="font-size:12px;color:#71717A;cursor:pointer;display:flex;align-items:center;gap:6px" styleHover="color:#006AFF">← All agents</Box>

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
          <div style={css("font-size:12px;color:#006AFF;background:#EAF2FF;border-radius:99px;padding:3px 12px;display:inline-block;margin-top:8px;font-weight:600")}>🎯 {sel.goal}</div>
        </div>
        <div style={css("margin-left:auto;display:flex;gap:8px;flex:none")}>
          <Btn onClick={() => togglePause(sel.id)} style="background:#FEF6E8;color:#B45309;border:none;border-radius:99px;padding:8px 18px;font-size:12.5px;font-weight:600;cursor:pointer" styleHover="background:#FDEBCB">{paused ? "Resume" : "Pause"}</Btn>
          <Btn onClick={() => gotoTab("settings")} style="background:#F4F4F5;color:#3F3F46;border:none;border-radius:99px;padding:8px 18px;font-size:12.5px;font-weight:600;cursor:pointer" styleHover="background:#E4E4E7">Edit</Btn>
          <Btn onClick={() => { deleteAgent(sel.id); router.push("/agents"); }} style="background:#FEECEC;color:#B91C1C;border:none;border-radius:99px;padding:8px 18px;font-size:12.5px;font-weight:600;cursor:pointer" styleHover="background:#FDD8D8">Delete</Btn>
        </div>
      </div>

      {/* sticky tab bar */}
      <div id="detailTabBar" style={css("position:sticky;top:0;z-index:5;background:#FAFAFB;padding:8px 0;display:flex;gap:4px;flex-wrap:wrap;border-bottom:1px solid #ECECF1")}>
        {visibleSections.map(([key, label]) => (
          <Box key={key} onClick={() => gotoTab(key)} style={"padding:7px 14px;font-size:12.5px;cursor:pointer;border-radius:99px;transition:all .12s;" + (tab === key ? "background:#18181B;color:#fff;font-weight:600" : "color:#52525B;font-weight:500")} styleHover="color:#18181B">{label}</Box>
        ))}
      </div>

      {/* Overview */}
      <div id="sec-overview" style={css("display:grid;grid-template-columns:1fr 300px;gap:14px;align-items:start;animation:fadeUp .25s ease")}>
        <div style={css("display:flex;flex-direction:column;gap:14px")}>
          <div style={css("background:linear-gradient(135deg,#EAF2FF,#FDEEF6);border-radius:16px;padding:18px")}>
            <div style={css("font-size:11px;font-weight:700;color:#006AFF;text-transform:uppercase;letter-spacing:.06em")}>✦ Summary</div>
            <div style={css("font-size:13.5px;color:#3F3F46;margin-top:8px;line-height:1.6")}>
              {stats ? `${stats.leadsWorked} lead${stats.leadsWorked === 1 ? "" : "s"} · ${stats.researched} researched · ${stats.drafted} draft${stats.drafted === 1 ? "" : "s"} · ${stats.sent} sent` : "Loading…"}
            </div>
          </div>
          <div style={css("display:grid;grid-template-columns:repeat(3,1fr);gap:14px")}>
            {([["Leads worked", stats?.leadsWorked ?? 0], ["Drafts sent", stats?.sent ?? 0], ["Replies", stats?.replies ?? 0]] as [string, number][]).map(([l, v]) => (
              <div key={l} style={css("background:#fff;border:1px solid #ECECF1;border-radius:14px;padding:14px 16px")}>
                <div style={css("font-size:11.5px;color:#71717A")}>{l}</div>
                <div style={css("font-size:22px;font-weight:700;margin-top:4px")}>{v}</div>
              </div>
            ))}
          </div>
          <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:16px 18px")}>
            <div style={css("font-size:13.5px;font-weight:700;margin-bottom:10px")}>Recent accomplishments</div>
            <div style={css("display:flex;flex-direction:column;gap:9px")}>
              {!stats || stats.activity.length === 0 ? (
                <div style={css("font-size:12.5px;color:#A1A1AA")}>No activity yet.</div>
              ) : stats.activity.slice(0, 5).map((a, i) => (
                <div key={i} style={css("display:flex;gap:9px;align-items:center;font-size:12.5px;color:#3F3F46")}><span style={css("color:#2FA45C;font-weight:700")}>✓</span>{a.text}</div>
              ))}
            </div>
          </div>
        </div>
        <div style={css("display:flex;flex-direction:column;gap:14px")}>
          <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:16px 18px")}>
            <div style={css("font-size:13.5px;font-weight:700;margin-bottom:10px")}>Goals</div>
            <div style={css("display:flex;flex-direction:column;gap:8px")}>
              <div style={css("font-size:12px;color:#3F3F46;background:#FAFAFB;border:1px solid #F0F0F3;border-radius:10px;padding:8px 11px")}>{sel.goal}</div>
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
            <Btn onClick={runScrape} style={"margin-left:auto;background:#006AFF;color:#fff;border:none;border-radius:99px;padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer;" + (runningScrape ? "opacity:.6" : "")} styleHover="background:#0052CC">{runningScrape ? "Finding…" : "Find leads"}</Btn>
          )}
          {sel.capabilities?.includes("qualify") && (
            <Btn onClick={runQualify} style={(sel.capabilities?.includes("scrape") ? "margin-left:14px;" : "margin-left:auto;") + "background:#006AFF;color:#fff;border:none;border-radius:99px;padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer;" + (runningQualify ? "opacity:.6" : "")} styleHover="background:#0052CC">{runningQualify ? "Qualifying…" : "Qualify leads"}</Btn>
          )}
          <Link href="/leads" style={{ ...css((sel.capabilities?.includes("scrape") || sel.capabilities?.includes("qualify") ? "margin-left:14px;" : "margin-left:auto;") + "font-size:12px;font-weight:600;color:#006AFF;text-decoration:none") }}>Open Leads module →</Link>
        </div>
        {scrapeNote && <div style={css("padding:9px 18px;font-size:12px;color:#71717A;border-bottom:1px solid #ECECF1")}>{scrapeNote}</div>}
        {agentLeads.length === 0 ? (
          <div style={css("padding:18px;font-size:12.5px;color:#A1A1AA")}>No leads in {sel.name}’s team book yet.</div>
        ) : (
          <>
            <div style={css("display:grid;grid-template-columns:.9fr 1.4fr 1.2fr .9fr .6fr .9fr;padding:11px 18px;font-size:11px;font-weight:600;color:#71717A;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #ECECF1;gap:10px")}>
              <div>Agent</div><div>Name</div><div>Company</div><div>Status</div><div>Score</div><div>Added</div>
            </div>
            {agentLeads.map((l) => {
              const sc = LEAD_STAGE_COLORS[l.status] || LEAD_STAGE_COLORS.new;
              return (
                <div key={l.id} style={css("display:grid;grid-template-columns:.9fr 1.4fr 1.2fr .9fr .6fr .9fr;padding:12px 18px;font-size:12.5px;border-bottom:1px solid #F4F4F6;align-items:center;gap:10px")}>
                  <div style={css("display:flex;align-items:center;gap:6px;min-width:0")}>{(() => { const a = byId(l.agentId); return a ? <><div style={css(av(a, 18))}>{a.initials}</div><span style={css("white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{a.name.split(" ")[0]}</span></> : <span>{l.agentId}</span>; })()}</div>
                  <div style={css("font-weight:600")}>{l.name}<div style={css("font-size:11px;color:#A1A1AA;font-weight:400")}>{l.title || l.email}</div>
                    {(byLead[l.id] || l.workedBy.length > 0) && (
                      <div style={css("display:flex;align-items:center;gap:6px;margin-top:4px")}>
                        <LivePulse info={byLead[l.id]} />
                        <WorkedBy ids={l.workedBy} byId={byId} />
                      </div>
                    )}
                  </div>
                  <div style={css("color:#3F3F46")}>{l.company || "—"}</div>
                  <div><span style={css(chip(sc[0], sc[1]))}>{l.status}</span></div>
                  <div>{(() => { const [bg, fg, label] = tierChip(l.score || 0); return <span style={css(chip(bg, fg))}>{label}{l.score ? " · " + l.score : ""}</span>; })()}</div>
                  <div style={css("color:#71717A")}>{new Date(l.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Research */}
      {isVisible("research") && (<>
        <SectionTitle id="sec-research">Research</SectionTitle>
        <div style={css("display:flex;flex-direction:column;gap:12px;animation:fadeUp .25s ease")}>
          <div style={css("display:flex;align-items:center;gap:10px")}>
            <div style={css("font-size:12.5px;color:#71717A")}>{researchedLeads.length} of {agentLeads.length} researched</div>
            <Btn onClick={runResearch} style={"margin-left:auto;background:#006AFF;color:#fff;border:none;border-radius:99px;padding:8px 16px;font-size:12.5px;font-weight:600;cursor:pointer;" + (runningResearch ? "opacity:.6" : "")} styleHover="background:#0052CC">{runningResearch ? "Researching…" : "Research leads"}</Btn>
          </div>
          {researchedLeads.length === 0 ? (
            <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:22px;font-size:12.5px;color:#A1A1AA")}>No briefs yet.</div>
          ) : researchedLeads.map((l) => (
            <div key={l.id} style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:16px 18px")}>
              <div style={css("font-size:13.5px;font-weight:700")}>{l.name}{l.company ? " · " + l.company : ""}</div>
              <div style={css("font-size:12.5px;color:#3F3F46;line-height:1.6;margin-top:6px")}>{l.research!.summary}</div>
              {l.research!.priorities.length > 0 && (
                <div style={css("margin-top:10px")}><div style={css("font-size:11px;font-weight:600;color:#71717A;text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px")}>Priorities</div><div style={css("display:flex;gap:6px;flex-wrap:wrap")}>{l.research!.priorities.map((p, i) => <span key={i} style={css(chip("#EAF2FF", "#006AFF"))}>{p}</span>)}</div></div>
              )}
              {l.research!.hooks.length > 0 && (
                <div style={css("margin-top:10px")}><div style={css("font-size:11px;font-weight:600;color:#71717A;text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px")}>Hooks</div><div style={css("display:flex;flex-direction:column;gap:4px")}>{l.research!.hooks.map((h, i) => <div key={i} style={css("font-size:12px;color:#3F3F46")}>• {h}</div>)}</div></div>
              )}
              <div style={css("margin-top:10px;font-size:12px;color:#3F3F46")}><span style={css("font-weight:600")}>Angle:</span> {l.research!.angle}</div>
            </div>
          ))}
        </div>
      </>)}

      {/* Emails */}
      {isVisible("emails") && (<>
        <SectionTitle id="sec-emails">Emails</SectionTitle>
        <div style={css("display:flex;flex-direction:column;gap:14px;animation:fadeUp .25s ease")}>
          <div style={css("display:flex;align-items:center;gap:10px")}>
            <div style={css("font-size:12.5px;color:#71717A")}>{drafts.length} draft{drafts.length === 1 ? "" : "s"} · {drafts.filter((d) => d.status === "sent").length} sent</div>
            {sel.capabilities?.includes("outreach") && (
              <Btn onClick={runOutreachForAgent} style={"margin-left:auto;background:#006AFF;color:#fff;border:none;border-radius:99px;padding:8px 16px;font-size:12.5px;font-weight:600;cursor:pointer;" + (runningOutreach ? "opacity:.6" : "")} styleHover="background:#0052CC">{runningOutreach ? "Running…" : "Run outreach"}</Btn>
            )}
          </div>
          {drafts.length === 0 ? (
            <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:22px;font-size:12.5px;color:#A1A1AA")}>No drafts yet.</div>
          ) : drafts.map((d) => (
            <div key={d.id} style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:16px 18px")}>
              <div style={css("display:flex;align-items:center;gap:8px")}>
                <span style={css(chip(d.status === "sent" ? "#E7F7EC" : "#EAF2FF", d.status === "sent" ? "#1B7A3D" : "#006AFF"))}>{d.status === "sent" ? "Sent" : "Draft"}</span>
                <div style={css("font-size:11.5px;color:#A1A1AA")}>to {d.leadName}{d.leadCompany ? " · " + d.leadCompany : ""} · {d.leadEmail || (d.leadPlatform ? d.leadPlatform + " DM" : "no email")}</div>
              </div>
              <div style={css("font-size:13.5px;font-weight:700;margin-top:10px")}>{d.subject}</div>
              <div style={css("font-size:12.5px;color:#3F3F46;line-height:1.6;margin-top:6px;white-space:pre-wrap")}>{d.body}</div>
              <div style={css("display:flex;gap:8px;margin-top:12px")}>
                {d.leadEmail ? (
                  <Btn onClick={() => sendDraft(d)} style="background:#E6F0FF;color:#006AFF;border:none;border-radius:99px;padding:7px 16px;font-size:12px;font-weight:600;cursor:pointer" styleHover="background:#D6E6FF">Open in mail</Btn>
                ) : (<>
                  <Btn onClick={() => copyMessage(d)} style="background:#E6F0FF;color:#006AFF;border:none;border-radius:99px;padding:7px 16px;font-size:12px;font-weight:600;cursor:pointer" styleHover="background:#D6E6FF">Copy message</Btn>
                  {d.leadProfileUrl && <Btn onClick={() => openProfile(d.leadProfileUrl!)} style="background:#F4F4F5;color:#3F3F46;border:none;border-radius:99px;padding:7px 16px;font-size:12px;font-weight:600;cursor:pointer" styleHover="background:#E4E4E7">Open profile</Btn>}
                </>)}
                {d.status !== "sent" && <Btn onClick={() => confirmSent(d)} style="background:#F4F4F5;color:#3F3F46;border:none;border-radius:99px;padding:7px 16px;font-size:12px;font-weight:600;cursor:pointer" styleHover="background:#E4E4E7">Mark sent</Btn>}
              </div>
            </div>
          ))}
        </div>
      </>)}

      {/* Proposals */}
      {isVisible("proposal") && (<>
        <SectionTitle id="sec-proposal">Proposals</SectionTitle>
        <div style={css("display:flex;flex-direction:column;gap:14px;animation:fadeUp .25s ease")}>
          <div style={css("display:flex;align-items:center;gap:10px")}>
            <div style={css("font-size:12.5px;color:#71717A")}>{proposals.length} proposal{proposals.length === 1 ? "" : "s"}</div>
            <Btn onClick={runProposals} style={"margin-left:auto;background:#006AFF;color:#fff;border:none;border-radius:99px;padding:8px 16px;font-size:12.5px;font-weight:600;cursor:pointer;" + (runningProposal ? "opacity:.6" : "")} styleHover="background:#0052CC">{runningProposal ? "Drafting…" : "Generate proposals"}</Btn>
          </div>
          {proposals.length === 0 ? (
            <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:22px;font-size:12.5px;color:#A1A1AA")}>No proposals yet.</div>
          ) : proposals.map((p) => (
            <div key={p.id} style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:16px 18px")}>
              <div style={css("display:flex;align-items:center;gap:8px")}>
                <span style={css(chip(p.status === "sent" ? "#E7F7EC" : "#EAF2FF", p.status === "sent" ? "#1B7A3D" : "#006AFF"))}>{p.status === "sent" ? "Sent" : "Draft"}</span>
                <div style={css("font-size:13.5px;font-weight:700")}>{p.title}</div>
              </div>
              {p.products.length > 0 && <div style={css("display:flex;gap:6px;flex-wrap:wrap;margin-top:8px")}>{p.products.map((pr, i) => <span key={i} style={css(chip("#EAF2FF", "#006AFF"))}>{pr}</span>)}</div>}
              <div style={css("font-size:12.5px;color:#3F3F46;line-height:1.6;margin-top:8px;white-space:pre-wrap")}>{p.body}</div>
              {p.status !== "sent" && <div style={css("margin-top:12px")}><Btn onClick={async () => { await markProposalSent(p.id); listProposalsForAgent(sel.id).then(setProposals); }} style="background:#F4F4F5;color:#3F3F46;border:none;border-radius:99px;padding:7px 16px;font-size:12px;font-weight:600;cursor:pointer" styleHover="background:#E4E4E7">Mark sent</Btn></div>}
            </div>
          ))}
        </div>
      </>)}

      {/* Reach Outs */}
      {isVisible("reach") && (<>
        <SectionTitle id="sec-reach">Reach outs</SectionTitle>
        <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:20px 22px;animation:fadeUp .25s ease")}>
          <div style={css("display:flex;flex-direction:column")}>
            {(() => {
              const reachActs = stats ? stats.activity.filter((a) => a.type !== "lead_added") : [];
              return reachActs.length === 0 ? (
                <div style={css("font-size:12.5px;color:#A1A1AA")}>No reach-outs yet.</div>
              ) : reachActs.map((a, i) => {
              const m = actMeta(a.type);
              return (
                <div key={i} style={css("display:flex;gap:16px")}>
                  <div style={css("display:flex;flex-direction:column;align-items:center")}>
                    <div style={css("width:12px;height:12px;border-radius:50%;background:" + m.c[1] + ";border:3px solid " + m.c[0] + ";flex:none;margin-top:2px")} />
                    <div style={css("width:2px;flex:1;background:#F0F0F3")} />
                  </div>
                  <div style={css("padding-bottom:20px;min-width:0;flex:1")}>
                    <div style={css("display:flex;align-items:center;gap:8px")}><span style={css(chip(m.c[0], m.c[1]))}>{m.label}</span><span style={css("font-size:11px;color:#A1A1AA")}>{relTime(a.createdAt)}</span></div>
                    <div style={css("font-size:13px;font-weight:600;margin-top:6px")}>{a.text}</div>
                  </div>
                </div>
              );
              });
            })()}
          </div>
        </div>
      </>)}

      {/* Meetings */}
      {isVisible("meetings") && (<>
        <SectionTitle id="sec-meetings">Meetings</SectionTitle>
        <div style={css("display:flex;flex-direction:column;gap:10px;animation:fadeUp .25s ease")}>
          <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:22px;font-size:12.5px;color:#A1A1AA")}>No meetings yet.</div>
        </div>
      </>)}

      {/* Tasks */}
      <SectionTitle id="sec-tasks">Tasks</SectionTitle>
      <div style={css("display:flex;flex-direction:column;gap:10px;animation:fadeUp .25s ease")}>
        {!stats || stats.jobs.length === 0 ? (
          <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:14px;padding:18px;font-size:12.5px;color:#A1A1AA")}>No tasks yet.</div>
        ) : stats.jobs.map((j, i) => {
          const c: [string, string] = j.status === "done" ? ["#E7F7EC", "#1B7A3D"] : j.status === "failed" ? ["#FEECEC", "#B91C1C"] : j.status === "running" ? ["#E9F5FE", "#0369A1"] : ["#FEF6E8", "#B45309"];
          return (
            <div key={i} style={css("background:#fff;border:1px solid #ECECF1;border-radius:14px;padding:14px 18px;display:flex;align-items:center;gap:14px")}>
              <span style={css("display:inline-flex;align-items:center;gap:5px;" + chip(c[0], c[1]))}><span style={css("width:6px;height:6px;border-radius:50%;background:" + c[1])} />{j.status}</span>
              <div style={css("font-size:13px;font-weight:600;text-transform:capitalize")}>{j.kind}</div>
              <div style={css("margin-left:auto;font-size:11px;color:#A1A1AA")}>{relTime(j.finishedAt ?? j.createdAt)}</div>
            </div>
          );
        })}
      </div>

      {/* Performance */}
      <SectionTitle id="sec-analytics">Performance</SectionTitle>
      <div style={css("display:flex;flex-direction:column;gap:14px;animation:fadeUp .25s ease")}>
        <div style={css("display:grid;grid-template-columns:repeat(4,1fr);gap:14px")}>
          {([["Leads worked", String(stats?.leadsWorked ?? 0)], ["Drafts sent", String(stats?.sent ?? 0)], ["Reply rate", (stats?.replyRate ?? 0) + "%"], ["Researched", String(stats?.researched ?? 0)]] as [string, string][]).map(([l, v]) => (
            <div key={l} style={css("background:#fff;border:1px solid #ECECF1;border-radius:14px;padding:14px 16px")}>
              <div style={css("font-size:11.5px;color:#71717A")}>{l}</div>
              <div style={css("font-size:22px;font-weight:700;margin-top:4px")}>{v}</div>
            </div>
          ))}
        </div>
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
        <div>
          <div style={css("font-size:12px;font-weight:600;color:#3F3F46;margin-bottom:6px")}>Capabilities</div>
          {caps.length === 0 ? (
            <div style={css("font-size:12px;color:#A1A1AA")}>No capabilities — this agent coordinates the team only.</div>
          ) : (
            <div style={css("display:flex;gap:6px;flex-wrap:wrap")}>
              {caps.map((c) => <span key={c} style={css("font-size:11.5px;font-weight:600;color:#006AFF;background:#EAF2FF;border-radius:99px;padding:4px 12px")}>{CAPABILITIES.find((x) => x.id === c)?.label ?? c}</span>)}
            </div>
          )}
        </div>
        {sel.capabilities && sel.capabilities.length > 0 && (
          <div>
            <div style={css("font-size:12px;font-weight:600;color:#3F3F46;margin-bottom:6px")}>Autonomy</div>
            <div style={css("font-size:11px;color:#A1A1AA;margin-bottom:8px")}>How this agent runs each capability. Batch stages run Auto or Ask; meeting booking has its own settings.</div>
            <div style={css("display:flex;flex-direction:column;gap:8px")}>
              {sel.capabilities.map((cap) => {
                const label = CAPABILITIES.find((c) => c.id === cap)?.label ?? cap;
                if (cap === "book-meeting") {
                  const cs = capSetting(cap);
                  const val = <T,>(k: string, d: T): T => (cs[k] === undefined ? d : (cs[k] as T));
                  return (
                    <div key={cap} style={css("border:1px solid #F0F0F3;border-radius:12px;padding:11px 13px;display:flex;flex-direction:column;gap:9px")}>
                      <div style={css("font-size:12.5px;font-weight:600;color:#3F3F46")}>{label}</div>
                      <div style={css("display:flex;gap:8px;flex-wrap:wrap;align-items:center")}>
                        <input value={String(val("type", "Meeting"))} onChange={(e) => setCapSetting(cap, { type: e.target.value })} placeholder="Meeting type (e.g. Discovery call)" style={css(MSEL + ";flex:1;min-width:150px;cursor:text")} />
                        <select value={String(val("duration", 30))} onChange={(e) => setCapSetting(cap, { duration: Number(e.target.value) })} style={css(MSEL)}>
                          {[15, 30, 45, 60].map((d) => <option key={d} value={d}>{d} min</option>)}
                        </select>
                      </div>
                      <div style={css("display:flex;gap:7px;flex-wrap:wrap;align-items:center;font-size:11.5px;color:#71717A")}>
                        <span>Book between</span>
                        <select value={String(val("windowStart", 9))} onChange={(e) => setCapSetting(cap, { windowStart: Number(e.target.value) })} style={css(MSEL)}>{HOURS.map((h) => <option key={h} value={h}>{fmtHour(h)}</option>)}</select>
                        <span>and</span>
                        <select value={String(val("windowEnd", 17))} onChange={(e) => setCapSetting(cap, { windowEnd: Number(e.target.value) })} style={css(MSEL)}>{HOURS.map((h) => <option key={h} value={h}>{fmtHour(h)}</option>)}</select>
                        <label style={css("display:flex;align-items:center;gap:5px;cursor:pointer;margin-left:auto")}>
                          <input type="checkbox" checked={cs.weekdaysOnly !== false} onChange={(e) => setCapSetting(cap, { weekdaysOnly: e.target.checked })} /> weekdays only
                        </label>
                      </div>
                    </div>
                  );
                }
                const mode = capMode(cap);
                return (
                  <div key={cap} style={css("display:flex;align-items:center;font-size:12.5px;color:#3F3F46")}>{label}
                    <div style={css("margin-left:auto;display:flex;background:#F4F4F5;border-radius:99px;padding:2px")}>
                      <Box onClick={() => setCapMode(cap, "auto")} style={"padding:4px 13px;font-size:11.5px;font-weight:600;border-radius:99px;cursor:pointer;" + (mode === "auto" ? "background:#fff;color:#18181B;box-shadow:0 1px 2px rgba(0,0,0,.08)" : "color:#71717A")}>Auto</Box>
                      <Box onClick={() => setCapMode(cap, "ask")} style={"padding:4px 13px;font-size:11.5px;font-weight:600;border-radius:99px;cursor:pointer;" + (mode === "ask" ? "background:#fff;color:#006AFF;box-shadow:0 1px 2px rgba(0,0,0,.08)" : "color:#71717A")}>Ask</Box>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <Btn onClick={() => saveConfig(sel.id, { role: cfgRole, goal: cfgGoal })} style="background:#006AFF;color:#fff;border:none;border-radius:99px;padding:9px 20px;font-size:12.5px;font-weight:600;cursor:pointer;align-self:flex-start" styleHover="background:#0052CC">Save changes</Btn>
      </div>
    </div>
  );
}
