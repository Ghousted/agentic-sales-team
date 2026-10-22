"use client";
import { useCallback, useMemo, useRef, useState } from "react";
import { useApp } from "@/lib/store";
import { addLead as addLeadAction, listLeads as listLeadsAction, setStage as setStageAction, listCandidates, acceptLeads, dismissLeads, deleteLeads, importLeadsCsv, listDraftsForLead, clearDraftsForLead } from "@/lib/leads/actions";
import { listMatchesForLead } from "@/lib/matches/actions";
import { bookMeetingForLead } from "@/lib/meetings/actions";
import type { MatchDTO } from "@/lib/matches/store";
import { enqueueOutreachJob } from "@/lib/jobs/actions";
import { LEAD_STAGES, type LeadDTO, type DraftDTO } from "@/lib/leads/types";
import { av, chip } from "@/lib/visuals";
import { css, Box, Btn } from "@/components/primitives";
import { useLiveWork } from "@/lib/useLiveWork";
import { WorkedBy, LivePulse } from "@/components/LeadBits";

const STAGE_COLORS: Record<string, [string, string]> = {
  new: ["#F4F4F5", "#71717A"], contacted: ["#FEF6E8", "#B45309"], engaged: ["#E9F5FE", "#0369A1"],
  replied: ["#E7F7EC", "#1B7A3D"], meeting: ["#EAF2FF", "#006AFF"],
};
const INPUT = "border:1px solid #E4E4E7;background:#fff;border-radius:10px;padding:9px 12px;font-size:13px;color:#18181B;outline:none";
const LABEL = "font-size:12px;font-weight:600;color:#3F3F46;margin-bottom:6px";
const FIELD = "width:100%;border:1px solid #E4E4E7;border-radius:10px;padding:9px 13px;font-size:13px;color:#18181B;outline:none";
const SEC = "font-size:11px;font-weight:700;color:#A1A1AA;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px";
const MUTED = "font-size:12.5px;color:#A1A1AA";

export default function LeadsClient({ initialLeads, initialCandidates }: { initialLeads: LeadDTO[]; initialCandidates: LeadDTO[] }) {
  const { agents, byId, showToast } = useApp();
  const { byLead } = useLiveWork();
  const [leads, setLeads] = useState<LeadDTO[]>(initialLeads);
  const [candidates, setCandidates] = useState<LeadDTO[]>(initialCandidates);
  const [view, setView] = useState<"active" | "pending">("active");
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState<string | null>(null); // agentId being run, or "all"
  const [fAgent, setFAgent] = useState("");
  const [fStage, setFStage] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", title: "", company: "", email: "", agentId: "" });
  const [openLead, setOpenLead] = useState<LeadDTO | null>(null);
  const [leadMatches, setLeadMatches] = useState<MatchDTO[]>([]);
  const [leadDrafts, setLeadDrafts] = useState<DraftDTO[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [bookingWhen, setBookingWhen] = useState("");
  const [booking, setBooking] = useState(false);
  const [confirmDel, setConfirmDel] = useState<string | null>(null); // lead id armed for delete
  const delTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bookMeetingNow = async () => {
    if (!openLead || !bookingWhen.trim() || booking) return;
    setBooking(true);
    const res = await bookMeetingForLead(openLead.id, bookingWhen.trim(), Intl.DateTimeFormat().resolvedOptions().timeZone);
    setBooking(false);
    if (res.error) { showToast(res.error); return; }
    showToast(`Meeting booked${res.label ? " · " + res.label : ""}`);
    setBookingWhen("");
  };
  const openLeadDetail = useCallback(async (l: LeadDTO) => {
    setOpenLead(l); setLeadMatches([]); setLeadDrafts([]); setBookingWhen(""); setDetailLoading(true);
    try {
      const [m, d] = await Promise.all([listMatchesForLead(l.id), listDraftsForLead(l.id)]);
      setLeadMatches(m); setLeadDrafts(d);
    } finally { setDetailLoading(false); }
  }, []);

  const clearLeadDrafts = useCallback(async (leadId: string) => {
    setLeadDrafts([]);
    const n = await clearDraftsForLead(leadId);
    if (n > 0) showToast(`Cleared ${n} draft${n === 1 ? "" : "s"}`);
  }, [showToast]);

  const refetch = useCallback(async () => {
    setLoading(true);
    const [rows, cands] = await Promise.all([listLeadsAction(), listCandidates()]);
    setLeads(rows);
    setCandidates(cands);
    setLoading(false);
  }, []);

  const filtered = useMemo(
    () => leads.filter((l) => (!fAgent || l.agentId === fAgent) && (!fStage || l.status === fStage)),
    [leads, fAgent, fStage]
  );

  const fileRef = useRef<HTMLInputElement>(null);
  const onCsv = async (file: File | undefined) => {
    if (!file) return;
    const agentId = fAgent || agents[0]?.id;
    const a = agentId ? byId(agentId) : undefined;
    if (!agentId) { showToast("Create an agent first, then import."); return; }
    showToast("Importing…");
    const res = await importLeadsCsv(await file.text(), agentId);
    if (fileRef.current) fileRef.current.value = "";
    if (res.error) { showToast(res.error); return; }
    showToast(`Imported ${res.added} lead${res.added === 1 ? "" : "s"}${a ? " for " + a.name.split(" ")[0] : ""}`);
    refetch();
  };

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

  // Two-click delete: first click arms (button flips to "Delete?"), second
  // click within the window removes the lead. Auto-disarms after 3s.
  const del = async (l: LeadDTO) => {
    if (delTimer.current) clearTimeout(delTimer.current);
    if (confirmDel !== l.id) {
      setConfirmDel(l.id);
      delTimer.current = setTimeout(() => setConfirmDel(null), 3000);
      return;
    }
    setConfirmDel(null);
    await deleteLeads([l.id]);
    if (openLead?.id === l.id) setOpenLead(null);
    showToast("Lead deleted");
    refetch();
  };

  return (
    <div style={css("padding:24px 26px;display:flex;flex-direction:column;gap:16px;animation:fadeUp .3s ease")}>
      <div style={css("display:flex;align-items:center;gap:12px;flex-wrap:wrap")}>
        <div style={css("display:flex;background:#F4F4F5;border-radius:99px;padding:3px")}>
          <Box onClick={() => setView("active")} style={"padding:6px 14px;font-size:12.5px;font-weight:600;border-radius:99px;cursor:pointer;" + (view === "active" ? "background:#fff;color:#18181B;box-shadow:0 1px 2px rgba(0,0,0,.08)" : "color:#71717A")}>Active</Box>
          <Box onClick={() => setView("pending")} style={"padding:6px 14px;font-size:12.5px;font-weight:600;border-radius:99px;cursor:pointer;display:flex;align-items:center;gap:6px;" + (view === "pending" ? "background:#fff;color:#18181B;box-shadow:0 1px 2px rgba(0,0,0,.08)" : "color:#71717A")}>Pending{candidates.length > 0 && <span style={css("background:#006AFF;color:#fff;border-radius:99px;font-size:10px;font-weight:700;padding:1px 6px")}>{candidates.length}</span>}</Box>
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
          <input ref={fileRef} type="file" accept=".csv,text/csv" aria-label="Import leads CSV" onChange={(e) => onCsv(e.target.files?.[0])} style={css("display:none")} />
          <Btn onClick={() => fileRef.current?.click()} style="background:#fff;color:#3F3F46;border:1px solid #E4E4E7;border-radius:99px;padding:9px 16px;font-size:12.5px;font-weight:600;cursor:pointer" styleHover="background:#F4F4F5">Import CSV</Btn>
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
              <Btn onClick={submitAdd} style="background:#006AFF;color:#fff;border:none;border-radius:99px;padding:9px 20px;font-size:12.5px;font-weight:600;cursor:pointer" styleHover="background:#0052CC">Add lead</Btn>
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
            <div style={css("padding:20px;font-size:12.5px;color:#A1A1AA")}>No leads yet.</div>
          ) : filtered.map((l) => {
            const a = byId(l.agentId);
            const sc = STAGE_COLORS[l.status] || STAGE_COLORS.new;
            return (
              <div key={l.id} style={css("display:grid;grid-template-columns:1.4fr 1.2fr 1fr .7fr .6fr 1.1fr;padding:12px 18px;font-size:12.5px;border-bottom:1px solid #F4F4F6;align-items:center;gap:10px")}>
                <div style={css("font-weight:600")}><Box onClick={() => openLeadDetail(l)} style="font-weight:600;cursor:pointer;display:inline-block" styleHover="color:#006AFF">{l.name}</Box><div style={css("font-size:11px;color:#A1A1AA;font-weight:400")}>{l.title || l.email}</div>
                  {l.profileUrl && <Box onClick={() => window.open(l.profileUrl!, "_blank")} style="font-size:11px;font-weight:600;color:#006AFF;cursor:pointer;margin-top:2px;display:inline-block" styleHover="text-decoration:underline">View post ↗</Box>}
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
                <div style={css("font-weight:700;color:#006AFF")}>{l.score || "—"}</div>
                <div style={css("display:flex;gap:6px")}>
                  <Btn onClick={() => runOutreach(l.agentId, [l.id])} style={"border:none;border-radius:8px;padding:5px 10px;font-size:11.5px;font-weight:600;cursor:pointer;background:#E6F0FF;color:#006AFF;" + (running === l.id ? "opacity:.6" : "")} styleHover="background:#D6E6FF">{running === l.id ? "Running…" : "Run outreach"}</Btn>
                  <Btn onClick={() => advance(l)} style="border:none;border-radius:8px;padding:5px 10px;font-size:11.5px;font-weight:600;cursor:pointer;background:#F4F4F5;color:#3F3F46" styleHover="background:#E4E4E7">Advance</Btn>
                  <Btn onClick={() => del(l)} style={"border:none;border-radius:8px;padding:5px 10px;font-size:11.5px;font-weight:600;cursor:pointer;" + (confirmDel === l.id ? "background:#FDE8E8;color:#C0362C" : "background:#F4F4F5;color:#A1A1AA")} styleHover={confirmDel === l.id ? "background:#F9D4D4" : "background:#FDE8E8;color:#C0362C"}>{confirmDel === l.id ? "Delete?" : "Delete"}</Btn>
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
              <Btn onClick={() => review(candidates.map((c) => c.id), true)} style="margin-left:auto;background:#006AFF;color:#fff;border:none;border-radius:99px;padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer" styleHover="background:#0052CC">Accept all</Btn>
              <Btn onClick={() => review(candidates.map((c) => c.id), false)} style="background:#F4F4F5;color:#3F3F46;border:none;border-radius:99px;padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer" styleHover="background:#E4E4E7">Dismiss all</Btn>
            </>)}
          </div>
          {loading ? (
            <div style={css("padding:20px;font-size:12.5px;color:#A1A1AA")}>Loading…</div>
          ) : candidates.length === 0 ? (
            <div style={css("padding:20px;font-size:12.5px;color:#A1A1AA")}>No candidates awaiting review.</div>
          ) : candidates.map((c) => {
            const a = byId(c.agentId);
            return (
              <div key={c.id} style={css("display:grid;grid-template-columns:1.4fr 1.2fr 1fr 1.2fr;padding:12px 18px;font-size:12.5px;border-bottom:1px solid #F4F4F6;align-items:center;gap:10px")}>
                <div style={css("font-weight:600")}><Box onClick={() => openLeadDetail(c)} style="font-weight:600;cursor:pointer;display:inline-block" styleHover="color:#006AFF">{c.name}</Box><div style={css("font-size:11px;color:#A1A1AA;font-weight:400")}>{c.title || (c.platform ? c.platform : "—")}</div></div>
                <div style={css("color:#3F3F46")}>{c.company || "—"}</div>
                <div style={css("display:flex;align-items:center;gap:7px;min-width:0")}>{a && <div style={css(av(a, 20))}>{a.initials}</div>}<span style={css("white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{a ? a.name : c.agentId}</span></div>
                <div style={css("display:flex;gap:6px;align-items:center")}>
                  {c.profileUrl && <Box onClick={() => window.open(c.profileUrl!, "_blank")} style="font-size:11.5px;font-weight:600;color:#006AFF;cursor:pointer" styleHover="text-decoration:underline">View post ↗</Box>}
                  <Btn onClick={() => review([c.id], true)} style="margin-left:auto;border:none;border-radius:8px;padding:5px 10px;font-size:11.5px;font-weight:600;cursor:pointer;background:#E7F7EC;color:#1B7A3D" styleHover="background:#D6EFDD">Accept</Btn>
                  <Btn onClick={() => review([c.id], false)} style="border:none;border-radius:8px;padding:5px 10px;font-size:11.5px;font-weight:600;cursor:pointer;background:#F4F4F5;color:#71717A" styleHover="background:#E4E4E7">Dismiss</Btn>
                  <Btn onClick={() => del(c)} style={"border:none;border-radius:8px;padding:5px 10px;font-size:11.5px;font-weight:600;cursor:pointer;" + (confirmDel === c.id ? "background:#FDE8E8;color:#C0362C" : "background:#F4F4F5;color:#A1A1AA")} styleHover={confirmDel === c.id ? "background:#F9D4D4" : "background:#FDE8E8;color:#C0362C"}>{confirmDel === c.id ? "Delete?" : "Delete"}</Btn>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {openLead && (() => {
        const l = openLead;
        const ag = byId(l.agentId);
        const sc = STAGE_COLORS[l.status] || STAGE_COLORS.new;
        const rb = l.research;
        return (
          <div onClick={() => setOpenLead(null)} style={css("position:fixed;inset:0;background:rgba(24,24,27,.45);z-index:60;display:flex;align-items:center;justify-content:center;padding:24px;animation:fadeUp .2s ease")}>
            <div onClick={(e) => e.stopPropagation()} style={css("background:#fff;border-radius:18px;width:100%;max-width:560px;max-height:86vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 60px rgba(24,24,27,.28)")}>
              <div style={css("padding:18px 20px;border-bottom:1px solid #F0F0F3;display:flex;align-items:flex-start;gap:10px")}>
                <div style={css("flex:1;min-width:0")}>
                  <div style={css("font-size:16px;font-weight:700")}>{l.name}</div>
                  <div style={css("font-size:12px;color:#71717A;margin-top:4px;display:flex;flex-wrap:wrap;gap:8px;align-items:center")}>
                    {l.email && <a href={"mailto:" + l.email} style={css("color:#006AFF;text-decoration:none;font-weight:600")}>{l.email}</a>}
                    {l.company && <span>{l.company}</span>}
                    {l.platform && <span style={css(chip("#EAF2FF", "#006AFF"))}>{l.platform}</span>}
                    {l.profileUrl && <Box onClick={() => window.open(l.profileUrl!, "_blank")} style="color:#006AFF;cursor:pointer;font-weight:600" styleHover="text-decoration:underline">View post ↗</Box>}
                  </div>
                </div>
                <Btn onClick={() => del(l)} style={"flex:none;border:none;border-radius:8px;padding:5px 10px;font-size:11.5px;font-weight:600;cursor:pointer;" + (confirmDel === l.id ? "background:#FDE8E8;color:#C0362C" : "background:#F4F4F5;color:#A1A1AA")} styleHover={confirmDel === l.id ? "background:#F9D4D4" : "background:#FDE8E8;color:#C0362C"}>{confirmDel === l.id ? "Delete?" : "Delete"}</Btn>
                <Box onClick={() => setOpenLead(null)} style="font-size:18px;color:#A1A1AA;cursor:pointer;line-height:1;padding:2px 4px;flex:none" styleHover="color:#3F3F46">✕</Box>
              </div>
              <div style={css("padding:18px 20px;overflow-y:auto;display:flex;flex-direction:column;gap:16px")}>
                <div style={css("display:flex;flex-wrap:wrap;gap:6px;align-items:center")}>
                  <span style={css(chip(sc[0], sc[1]))}>{l.status}</span>
                  <span style={css(chip("#E6F0FF", "#006AFF"))}>score {l.score || 0}</span>
                  <span style={css(chip("#F4F4F5", "#71717A"))}>{l.source || "manual"}</span>
                  <span style={css(chip(l.review === "accepted" ? "#E7F7EC" : "#FEF3E7", l.review === "accepted" ? "#1B7A3D" : "#B7791F"))}>{l.review}</span>
                  {ag && <span style={css("font-size:11.5px;color:#71717A")}>· {ag.name}</span>}
                </div>
                <div>
                  <div style={css(SEC)}>Book a meeting</div>
                  <div style={css("display:flex;gap:8px;align-items:center;flex-wrap:wrap")}>
                    <input value={bookingWhen} onChange={(e) => setBookingWhen(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") bookMeetingNow(); }} placeholder='e.g. "tomorrow 2pm" or "next Tue 10am"' style={css(FIELD + ";flex:1;min-width:180px")} />
                    <Btn onClick={bookMeetingNow} style={"background:#006AFF;color:#fff;border:none;border-radius:99px;padding:9px 16px;font-size:12.5px;font-weight:600;cursor:pointer;flex:none;" + (booking ? "opacity:.6" : "")} styleHover="background:#0052CC">{booking ? "Booking…" : "Book"}</Btn>
                  </div>
                </div>
                {l.title && <div><div style={css(SEC)}>Intent</div><div style={css("font-size:13px;color:#3F3F46;line-height:1.55")}>{l.title}</div></div>}
                {rb && (
                  <div>
                    <div style={css(SEC)}>Research</div>
                    {rb.summary && <div style={css("font-size:12.5px;color:#3F3F46;line-height:1.55")}>{rb.summary}</div>}
                    {rb.priorities.length > 0 && <div style={css("font-size:12px;color:#52525B;margin-top:6px")}><b>Priorities:</b> {rb.priorities.join("; ")}</div>}
                    {rb.hooks.length > 0 && <div style={css("font-size:12px;color:#52525B;margin-top:3px")}><b>Hooks:</b> {rb.hooks.join("; ")}</div>}
                    {rb.angle && <div style={css("font-size:12px;color:#52525B;margin-top:3px")}><b>Angle:</b> {rb.angle}</div>}
                  </div>
                )}
                <div>
                  <div style={css(SEC)}>Matches</div>
                  {detailLoading ? <div style={css(MUTED)}>Loading…</div>
                    : leadMatches.length === 0 ? <div style={css(MUTED)}>No matches yet — ask a Matchmaker to match this lead to your listings.</div>
                    : <div style={css("display:flex;flex-direction:column;gap:8px")}>{leadMatches.map((m) => (
                        <div key={m.id} style={css("border:1px solid #ECECF1;border-radius:12px;padding:11px 13px")}>
                          <div style={css("display:flex;align-items:center;gap:8px")}>
                            <div style={css("font-weight:600;font-size:13px;flex:1;min-width:0")}>{m.productName}{m.productPrice ? " · " + m.productPrice : ""}{m.productCategory ? " · " + m.productCategory : ""}</div>
                            <span style={css(chip(m.score >= 75 ? "#E7F7EC" : m.score >= 50 ? "#FEF6E8" : "#F4F4F5", m.score >= 75 ? "#1B7A3D" : m.score >= 50 ? "#B45309" : "#71717A"))}>{m.score}</span>
                          </div>
                          {m.reason && <div style={css("font-size:12px;color:#52525B;margin-top:4px;line-height:1.5")}>{m.reason}</div>}
                        </div>
                      ))}</div>}
                </div>
                {leadDrafts.length > 0 && (
                  <div>
                    <div style={css("display:flex;align-items:center;gap:8px;margin-bottom:6px")}>
                      <div style={css(SEC + ";margin-bottom:0")}>Emails</div>
                      <Btn onClick={() => openLead && clearLeadDrafts(openLead.id)} style="margin-left:auto;background:transparent;border:none;color:#71717A;font-size:11px;font-weight:600;cursor:pointer;padding:2px 4px" styleHover="color:#F43F7E">Clear all</Btn>
                    </div>
                    <div style={css("display:flex;flex-direction:column;gap:8px")}>{leadDrafts.map((d) => (
                      <div key={d.id} style={css("border:1px solid #ECECF1;border-radius:12px;padding:11px 13px")}>
                        <div style={css("font-size:13px;font-weight:700")}>{d.subject}</div>
                        <div style={css("font-size:12px;color:#52525B;line-height:1.5;margin-top:4px;white-space:pre-wrap")}>{d.body.length > 200 ? d.body.slice(0, 200) + "…" : d.body}</div>
                        <div style={css("display:flex;gap:6px;margin-top:8px")}>
                          {d.leadEmail
                            ? <Btn onClick={() => window.open("mailto:" + d.leadEmail + "?subject=" + encodeURIComponent(d.subject) + "&body=" + encodeURIComponent(d.body), "_blank")} style="background:#E6F0FF;color:#006AFF;border:none;border-radius:99px;padding:5px 13px;font-size:11.5px;font-weight:600;cursor:pointer" styleHover="background:#D6E6FF">Open in mail</Btn>
                            : <Btn onClick={() => navigator.clipboard?.writeText(d.body).then(() => showToast("Message copied"), () => showToast("Copy failed"))} style="background:#E6F0FF;color:#006AFF;border:none;border-radius:99px;padding:5px 13px;font-size:11.5px;font-weight:600;cursor:pointer" styleHover="background:#D6E6FF">Copy message</Btn>}
                        </div>
                      </div>
                    ))}</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
