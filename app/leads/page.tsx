"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "@/lib/store";
import { addLead as addLeadAction, listLeads as listLeadsAction, setStage as setStageAction, listCandidates, acceptLeads, dismissLeads } from "@/lib/leads/actions";
import { enqueueOutreachJob } from "@/lib/jobs/actions";
import { LEAD_STAGES, type LeadDTO } from "@/lib/leads/types";
import { av, chip } from "@/lib/visuals";
import { css, Box, Btn } from "@/components/primitives";
import { useLiveWork } from "@/lib/useLiveWork";
import { WorkedBy, LivePulse } from "@/components/LeadBits";

const STAGE_COLORS: Record<string, [string, string]> = {
  new: ["#F4F4F5", "#71717A"], contacted: ["#FEF6E8", "#B45309"], engaged: ["#E9F5FE", "#0369A1"],
  replied: ["#E7F7EC", "#1B7A3D"], meeting: ["#F1EDFD", "#5122C1"],
};
const INPUT = "border:1px solid #E4E4E7;background:#fff;border-radius:10px;padding:9px 12px;font-size:13px;color:#18181B;outline:none";
const LABEL = "font-size:12px;font-weight:600;color:#3F3F46;margin-bottom:6px";
const FIELD = "width:100%;border:1px solid #E4E4E7;border-radius:10px;padding:9px 13px;font-size:13px;color:#18181B;outline:none";

export default function LeadsPage() {
  const { agents, byId, showToast } = useApp();
  const { byLead } = useLiveWork();
  const [leads, setLeads] = useState<LeadDTO[]>([]);
  const [candidates, setCandidates] = useState<LeadDTO[]>([]);
  const [view, setView] = useState<"active" | "pending">("active");
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<string | null>(null); // agentId being run, or "all"
  const [fAgent, setFAgent] = useState("");
  const [fStage, setFStage] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", title: "", company: "", email: "", agentId: "" });

  const refetch = useCallback(async () => {
    setLoading(true);
    const [rows, cands] = await Promise.all([listLeadsAction(), listCandidates()]);
    setLeads(rows);
    setCandidates(cands);
    setLoading(false);
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  const filtered = useMemo(
    () => leads.filter((l) => (!fAgent || l.agentId === fAgent) && (!fStage || l.status === fStage)),
    [leads, fAgent, fStage]
  );

  const submitAdd = async () => {
    const agentId = form.agentId || agents[0]?.id;
    if (!form.name.trim() || !form.email.trim() || !agentId) { showToast("Name, email, and agent are required"); return; }
    await addLeadAction({ agentId, name: form.name, title: form.title, company: form.company, email: form.email });
    setForm({ name: "", title: "", company: "", email: "", agentId: "" });
    setShowAdd(false);
    showToast("Lead added");
    refetch();
  };

  const review = async (ids: string[], accept: boolean) => {
    if (!ids.length) return;
    if (accept) await acceptLeads(ids); else await dismissLeads(ids);
    showToast(accept ? ids.length + " accepted" : ids.length + " dismissed");
    refetch();
  };

  // Enqueue an outreach run, kick the runner (cookies flow with the browser
  // fetch), then refetch. Small batches complete within the awaited request.
  const runOutreach = async (agentId: string, leadIds?: string[]) => {
    const a = byId(agentId);
    if (!a) return;
    setRunning(leadIds ? leadIds[0] : agentId);
    const res = await enqueueOutreachJob({
      agent: { id: a.id, name: a.name, role: a.role, goal: a.goal, task: a.task },
      leadIds,
    });
    if ("error" in res) { showToast(res.error); setRunning(null); return; }
    try {
      const r = await fetch("/api/jobs/run", { method: "POST" });
      const j = await r.json();
      showToast(j.drafts ? j.drafts + " draft" + (j.drafts === 1 ? "" : "s") + " created" : "No new drafts");
    } catch { showToast("Run failed"); }
    setRunning(null);
    refetch();
  };

  const advance = async (l: LeadDTO) => {
    const idx = LEAD_STAGES.indexOf(l.status as (typeof LEAD_STAGES)[number]);
    const next = LEAD_STAGES[Math.min(LEAD_STAGES.length - 1, idx + 1)];
    if (next === l.status) return;
    await setStageAction(l.id, next);
    refetch();
  };

  return (
    <div style={css("padding:24px 26px;display:flex;flex-direction:column;gap:16px;animation:fadeUp .3s ease")}>
      <div style={css("display:flex;align-items:center;gap:12px;flex-wrap:wrap")}>
        <div style={css("display:flex;background:#F4F4F5;border-radius:99px;padding:3px")}>
          <Box onClick={() => setView("active")} style={"padding:6px 14px;font-size:12.5px;font-weight:600;border-radius:99px;cursor:pointer;" + (view === "active" ? "background:#fff;color:#18181B;box-shadow:0 1px 2px rgba(0,0,0,.08)" : "color:#71717A")}>Active</Box>
          <Box onClick={() => setView("pending")} style={"padding:6px 14px;font-size:12.5px;font-weight:600;border-radius:99px;cursor:pointer;display:flex;align-items:center;gap:6px;" + (view === "pending" ? "background:#fff;color:#18181B;box-shadow:0 1px 2px rgba(0,0,0,.08)" : "color:#71717A")}>Pending{candidates.length > 0 && <span style={css("background:#5122C1;color:#fff;border-radius:99px;font-size:10px;font-weight:700;padding:1px 6px")}>{candidates.length}</span>}</Box>
        </div>
        <div style={css("font-size:13px;color:#71717A")}>{view === "active" ? leads.length + " lead" + (leads.length === 1 ? "" : "s") : candidates.length + " to review"}</div>
        <div style={css("margin-left:auto;display:flex;gap:8px;align-items:center")}>
          {view === "active" && (
            <>
              <select value={fAgent} onChange={(e) => setFAgent(e.target.value)} style={css(INPUT + ";cursor:pointer")}>
                <option value="">All agents</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <select value={fStage} onChange={(e) => setFStage(e.target.value)} style={css(INPUT + ";cursor:pointer")}>
                <option value="">All stages</option>
                {LEAD_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </>
          )}
          <Btn onClick={() => setShowAdd(true)} style="background:#18181B;color:#fff;border:none;border-radius:99px;padding:9px 16px;font-size:12.5px;font-weight:600;cursor:pointer" styleHover="background:#3F3F46">+ Add lead</Btn>
        </div>
      </div>

      {showAdd && (
        <div onClick={() => setShowAdd(false)} style={css("position:fixed;inset:0;background:rgba(24,24,27,.45);z-index:60;display:flex;align-items:center;justify-content:center;padding:24px;animation:fadeUp .2s ease")}>
          <div onClick={(e) => e.stopPropagation()} style={css("background:#fff;border-radius:18px;width:100%;max-width:460px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 60px rgba(24,24,27,.28)")}>
            <div style={css("padding:18px 20px;border-bottom:1px solid #F0F0F3")}>
              <div style={css("font-size:15px;font-weight:700")}>Add a lead</div>
              <div style={css("font-size:12px;color:#71717A;margin-top:3px")}>Create a prospect and assign it to an agent.</div>
            </div>
            <div style={css("padding:18px 20px;display:flex;flex-direction:column;gap:14px")}>
              <div>
                <div style={css(LABEL)}>Name</div>
                <input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") submitAdd(); }} placeholder="Full name" style={css(FIELD)} />
              </div>
              <div style={css("display:grid;grid-template-columns:1fr 1fr;gap:12px")}>
                <div>
                  <div style={css(LABEL)}>Title</div>
                  <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") submitAdd(); }} placeholder="e.g. VP Data" style={css(FIELD)} />
                </div>
                <div>
                  <div style={css(LABEL)}>Company</div>
                  <input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") submitAdd(); }} placeholder="e.g. Ramp" style={css(FIELD)} />
                </div>
              </div>
              <div>
                <div style={css(LABEL)}>Email</div>
                <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") submitAdd(); }} placeholder="name@company.com" style={css(FIELD)} />
              </div>
              <div>
                <div style={css(LABEL)}>Assign to agent</div>
                <select value={form.agentId} onChange={(e) => setForm({ ...form, agentId: e.target.value })} style={css(FIELD + ";cursor:pointer;appearance:none;background:#fff")}>
                  <option value="">{agents[0] ? agents[0].name : "No agents"}</option>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            </div>
            <div style={css("padding:14px 20px;border-top:1px solid #F0F0F3;display:flex;gap:10px;justify-content:flex-end")}>
              <Btn onClick={() => setShowAdd(false)} style="background:#F4F4F5;color:#3F3F46;border:none;border-radius:99px;padding:9px 18px;font-size:12.5px;font-weight:600;cursor:pointer" styleHover="background:#E4E4E7">Cancel</Btn>
              <Btn onClick={submitAdd} style="background:#5122C1;color:#fff;border:none;border-radius:99px;padding:9px 20px;font-size:12.5px;font-weight:600;cursor:pointer" styleHover="background:#42199E">Add lead</Btn>
            </div>
          </div>
        </div>
      )}

      {view === "active" ? (
        <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;overflow:hidden")}>
          <div style={css("display:grid;grid-template-columns:1.4fr 1.2fr 1fr .7fr .6fr 1.1fr;padding:11px 18px;font-size:11px;font-weight:600;color:#71717A;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #ECECF1;background:#FAFAFB;gap:10px")}>
            <div>Lead</div><div>Company</div><div>Agent</div><div>Stage</div><div>Score</div><div>Actions</div>
          </div>
          {loading ? (
            <div style={css("padding:20px;font-size:12.5px;color:#A1A1AA")}>Loading…</div>
          ) : filtered.length === 0 ? (
            <div style={css("padding:20px;font-size:12.5px;color:#A1A1AA")}>No leads yet. Use “Add lead” to create one.</div>
          ) : filtered.map((l) => {
            const a = byId(l.agentId);
            const sc = STAGE_COLORS[l.status] || STAGE_COLORS.new;
            return (
              <div key={l.id} style={css("display:grid;grid-template-columns:1.4fr 1.2fr 1fr .7fr .6fr 1.1fr;padding:12px 18px;font-size:12.5px;border-bottom:1px solid #F4F4F6;align-items:center;gap:10px")}>
                <div style={css("font-weight:600")}>{l.name}<div style={css("font-size:11px;color:#A1A1AA;font-weight:400")}>{l.title || l.email}</div>
                  {(byLead[l.id] || l.workedBy.length > 0) && (
                    <div style={css("display:flex;align-items:center;gap:6px;margin-top:4px")}>
                      <LivePulse info={byLead[l.id]} />
                      <WorkedBy ids={l.workedBy} byId={byId} />
                    </div>
                  )}
                </div>
                <div style={css("color:#3F3F46")}>{l.company || "—"}</div>
                <div style={css("display:flex;align-items:center;gap:7px;min-width:0")}>{a && <div style={css(av(a, 22))}>{a.initials}</div>}<span style={css("white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{a ? a.name : l.agentId}</span></div>
                <div><span style={css(chip(sc[0], sc[1]))}>{l.status}</span></div>
                <div style={css("font-weight:700;color:#5122C1")}>{l.score || "—"}</div>
                <div style={css("display:flex;gap:6px")}>
                  <Btn onClick={() => runOutreach(l.agentId, [l.id])} style={"border:none;border-radius:8px;padding:5px 10px;font-size:11.5px;font-weight:600;cursor:pointer;background:#EEE9F8;color:#5122C1;" + (running === l.id ? "opacity:.6" : "")} styleHover="background:#E3DBF9">{running === l.id ? "Running…" : "Run outreach"}</Btn>
                  <Btn onClick={() => advance(l)} style="border:none;border-radius:8px;padding:5px 10px;font-size:11.5px;font-weight:600;cursor:pointer;background:#F4F4F5;color:#3F3F46" styleHover="background:#E4E4E7">Advance</Btn>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;overflow:hidden")}>
          <div style={css("display:flex;align-items:center;padding:11px 18px;border-bottom:1px solid #ECECF1;background:#FAFAFB;gap:10px")}>
            <div style={css("font-size:11px;font-weight:600;color:#71717A;text-transform:uppercase;letter-spacing:.05em")}>Scraped candidates — accept the good ones</div>
            {candidates.length > 0 && (<>
              <Btn onClick={() => review(candidates.map((c) => c.id), true)} style="margin-left:auto;background:#5122C1;color:#fff;border:none;border-radius:99px;padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer" styleHover="background:#42199E">Accept all</Btn>
              <Btn onClick={() => review(candidates.map((c) => c.id), false)} style="background:#F4F4F5;color:#3F3F46;border:none;border-radius:99px;padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer" styleHover="background:#E4E4E7">Dismiss all</Btn>
            </>)}
          </div>
          {loading ? (
            <div style={css("padding:20px;font-size:12.5px;color:#A1A1AA")}>Loading…</div>
          ) : candidates.length === 0 ? (
            <div style={css("padding:20px;font-size:12.5px;color:#A1A1AA")}>No candidates awaiting review. Run “Find leads” on a scraping agent.</div>
          ) : candidates.map((c) => {
            const a = byId(c.agentId);
            return (
              <div key={c.id} style={css("display:grid;grid-template-columns:1.4fr 1.2fr 1fr 1.2fr;padding:12px 18px;font-size:12.5px;border-bottom:1px solid #F4F4F6;align-items:center;gap:10px")}>
                <div style={css("font-weight:600")}>{c.name}<div style={css("font-size:11px;color:#A1A1AA;font-weight:400")}>{c.title || (c.platform ? c.platform : "—")}</div></div>
                <div style={css("color:#3F3F46")}>{c.company || "—"}</div>
                <div style={css("display:flex;align-items:center;gap:7px;min-width:0")}>{a && <div style={css(av(a, 20))}>{a.initials}</div>}<span style={css("white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{a ? a.name : c.agentId}</span></div>
                <div style={css("display:flex;gap:6px;align-items:center")}>
                  {c.profileUrl && <Box onClick={() => window.open(c.profileUrl!, "_blank")} style="font-size:11.5px;font-weight:600;color:#5122C1;cursor:pointer" styleHover="text-decoration:underline">Profile ↗</Box>}
                  <Btn onClick={() => review([c.id], true)} style="margin-left:auto;border:none;border-radius:8px;padding:5px 10px;font-size:11.5px;font-weight:600;cursor:pointer;background:#E7F7EC;color:#1B7A3D" styleHover="background:#D6EFDD">Accept</Btn>
                  <Btn onClick={() => review([c.id], false)} style="border:none;border-radius:8px;padding:5px 10px;font-size:11.5px;font-weight:600;cursor:pointer;background:#F4F4F5;color:#71717A" styleHover="background:#E4E4E7">Dismiss</Btn>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
