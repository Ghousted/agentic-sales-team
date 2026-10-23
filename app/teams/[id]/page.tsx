"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useApp } from "@/lib/store";
import { statusMeta, TEAMS_BASE } from "@/lib/data";
import { av, chip } from "@/lib/visuals";
import { css, Box, Btn } from "@/components/primitives";
import Modal from "@/components/Modal";
import { templateById, type Capability } from "@/lib/agentTypes";
import { listLeadsForAgents } from "@/lib/leads/actions";
import type { LeadDTO } from "@/lib/leads/types";
import { listPendingApprovals, approveJob, rejectJob } from "@/lib/pod/actions";
import type { ApprovalDTO } from "@/lib/pod/types";
import { settleDecision } from "@/lib/pod/decide";
import { actionPhrase } from "@/lib/pod/summary";
import { useLiveWork } from "@/lib/useLiveWork";
import { WorkedBy, LivePulse } from "@/components/LeadBits";
import { agentNow, liveAgentCount, teamKpis, teamSubtitle, teamActivity } from "@/lib/agents/derive";
import { listActivity } from "@/lib/workspace/statsActions";
import type { ActivityItem } from "@/lib/workspace/stats";

const ICONS = ["🚀", "🌎", "🏛", "📣", "🎯", "💎"];

export default function TeamDetail() {
  const { s, agents, teams, byId, addTeamMembers, updateTeam, removeTeamMember, deleteTeam, showToast, showError } = useApp();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [showAdd, setShowAdd] = useState(false);
  const [pick, setPick] = useState<Record<string, boolean>>({});
  const [teamLeads, setTeamLeads] = useState<LeadDTO[]>([]);
  const [approvals, setApprovals] = useState<ApprovalDTO[]>([]);
  const [deciding, setDeciding] = useState<Set<string>>(new Set());
  const [acts, setActs] = useState<ActivityItem[]>([]);
  const [confirmDel, setConfirmDel] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [eName, setEName] = useState("");
  const [eIcon, setEIcon] = useState("🚀");
  const [eGoal, setEGoal] = useState("");
  const { live, byLead } = useLiveWork();

  // No fallback to another team: Edit/Delete would act on the wrong record.
  const team = teams.find((t) => t.id === params.id);
  // Only user-created teams can be deleted; the 4 seed teams are fixtures.
  const isSeedTeam = TEAMS_BASE.some((t) => t.id === team?.id);

  const memberIds = team ? team.members : [];
  useEffect(() => {
    if (memberIds.length) listLeadsForAgents(memberIds).then(setTeamLeads);
    else setTeamLeads([]);
    if (team) listPendingApprovals(team.id).then(setApprovals);
    listActivity(100).then(setActs, () => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberIds.join(","), team?.id]);

  if (!team) return (
    <div className="m-page" style={css("padding:24px 26px;display:flex;flex-direction:column;gap:18px")}>
      <Box onClick={() => router.push("/dashboard")} style="font-size:12px;color:#71717A;cursor:pointer" styleHover="color:#006AFF">← Dashboard</Box>
      <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:20px;padding:32px 24px;text-align:center")}>
        <div style={css("font-size:17px;font-weight:700")}>Team not found</div>
        <div style={css("font-size:13px;color:#71717A;margin-top:6px")}>This team was deleted or the link is wrong.</div>
      </div>
    </div>
  );

  const members = team.members.map((id) => byId(id)).filter(Boolean);
  const workingCount = liveAgentCount(live, team.members);
  const k = teamKpis(teamLeads);
  const recent = teamActivity(acts, team.members);

  // Agents not already on this team, for the add picker.
  const candidates = agents.filter((a) => !team.members.includes(a.id));
  const chosen = Object.keys(pick).filter((id) => pick[id]);

  const openAdd = () => { setPick({}); setShowAdd(true); };
  const confirmAdd = () => {
    if (chosen.length) addTeamMembers(team.id, chosen);
    setShowAdd(false);
  };
  const openEdit = () => { setEName(team.name); setEIcon(team.icon); setEGoal(team.goal); setShowEdit(true); };
  const saveEdit = () => { updateTeam(team.id, { name: eName, icon: eIcon, goal: eGoal }); setShowEdit(false); };
  const refetchPod = () => {
    if (!team) return;
    listPendingApprovals(team.id).then(setApprovals);
    if (memberIds.length) listLeadsForAgents(memberIds).then(setTeamLeads);
  };
  // The row and its buttons stay (disabled) until the server accepts the click;
  // on failure they come back with an error notice instead of vanishing.
  const decide = async (id: string, proceed: boolean) => {
    if (deciding.has(id)) return;
    setDeciding((d) => new Set(d).add(id));
    const res = await settleDecision(() => (proceed ? approveJob(id) : rejectJob(id)), proceed);
    setDeciding((d) => { const n = new Set(d); n.delete(id); return n; });
    if ("error" in res) { showError(res.error); return; }
    setApprovals((list) => list.filter((ap) => ap.id !== id));
    if (proceed) { try { await fetch("/api/jobs/run", { method: "POST" }); } catch { /* the cron runs it */ } }
    refetchPod();
  };

  const kpis: [string, string][] = [
    ["Meetings", k.meetings], ["In pipeline", k.pipeline], ["Leads", k.leads], ["Avg lead score", k.avgScore],
  ];

  return (
    <div className="m-page" style={css("padding:24px 26px;display:flex;flex-direction:column;gap:18px;animation:fadeUp .3s ease")}>
      <Box onClick={() => router.push("/dashboard")} style="font-size:12px;color:#71717A;cursor:pointer" styleHover="color:#006AFF">← Dashboard</Box>

      <div className="m-wrap" style={css("background:#fff;border:1px solid #ECECF1;border-radius:20px;padding:22px 24px;display:flex;align-items:center;gap:16px")}>
        <div style={css("width:52px;height:52px;border-radius:14px;background:" + team.iconBg + ";display:flex;align-items:center;justify-content:center;font-size:24px;flex:none")}>{team.icon}</div>
        <div style={css("min-width:0")}>
          <div style={css("font-size:19px;font-weight:700")}>{team.name}</div>
          <div style={css("font-size:13px;color:#71717A;margin-top:2px")}>{teamSubtitle(team)}</div>
          <div style={css("font-size:12px;color:#006AFF;background:#EAF2FF;border-radius:99px;padding:3px 12px;display:inline-block;margin-top:8px;font-weight:600")}>{members.length} member{members.length === 1 ? "" : "s"} · {workingCount} working now</div>
        </div>
        <div className="m-wrap m-fluid" style={css("margin-left:auto;display:flex;gap:8px;flex:none")}>
          <Btn onClick={openEdit} style="background:#F4F4F5;color:#3F3F46;border:none;border-radius:99px;padding:8px 18px;font-size:12.5px;font-weight:600;cursor:pointer" styleHover="background:#E4E4E7">Edit</Btn>
          <Btn onClick={openAdd} style="background:#F4F4F5;color:#3F3F46;border:none;border-radius:99px;padding:8px 18px;font-size:12.5px;font-weight:600;cursor:pointer" styleHover="background:#E4E4E7">+ Add agents</Btn>
          {!isSeedTeam && (confirmDel ? (<>
            <Btn onClick={() => { deleteTeam(team.id); router.push("/dashboard"); }} style="background:#FEECEC;color:#B91C1C;border:none;border-radius:99px;padding:8px 16px;font-size:12.5px;font-weight:600;cursor:pointer" styleHover="background:#FBD9D9">Confirm delete</Btn>
            <Btn onClick={() => setConfirmDel(false)} style="background:#F4F4F5;color:#3F3F46;border:none;border-radius:99px;padding:8px 16px;font-size:12.5px;font-weight:600;cursor:pointer" styleHover="background:#E4E4E7">Cancel</Btn>
          </>) : (
            <Btn onClick={() => setConfirmDel(true)} style="background:#fff;color:#B91C1C;border:1px solid #F3C7C7;border-radius:99px;padding:8px 16px;font-size:12.5px;font-weight:600;cursor:pointer" styleHover="background:#FEECEC">Delete team</Btn>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="m-2col" style={css("display:grid;grid-template-columns:repeat(4,1fr);gap:14px")}>
        {kpis.map(([l, v]) => (
          <div key={l} style={css("background:#fff;border:1px solid #ECECF1;border-radius:14px;padding:16px 18px")}>
            <div style={css("font-size:11.5px;color:#71717A")}>{l}</div>
            <div style={css("font-size:24px;font-weight:700;margin-top:4px;letter-spacing:-.01em")}>{v}</div>
          </div>
        ))}
      </div>

      {(() => {
        const active = live.filter((w) => team.members.includes(w.agentId));
        if (active.length === 0) return null;
        return (
          <div style={css("display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:#F0FBF3;border:1px solid #CFEBD8;border-radius:12px;padding:10px 14px")}>
            <span style={css("font-size:12px;font-weight:700;color:#1B7A3D")}>Working now</span>
            {active.map((w) => {
              const verb = w.capability === "research" ? "researching" : w.capability === "outreach" ? "drafting" : w.capability;
              return <span key={w.agentId + w.capability} style={css("display:inline-flex;align-items:center;gap:5px;font-size:12px;color:#3F3F46")}><span style={css("width:6px;height:6px;border-radius:50%;background:#2FA45C;animation:pulse 1.4s ease-in-out infinite")} />{w.agentName.split(" ")[0]}: {verb} {w.leadIds.length}</span>;
            })}
          </div>
        );
      })()}

      {(() => {
        const req = (templateById(team.template)?.requiredCapabilities ?? []) as Capability[];
        if (!req.length) return null;
        const covered = new Set<string>();
        for (const a of members) if (a) for (const c of a.capabilities) covered.add(c);
        return (
          <div style={css("display:flex;align-items:center;gap:8px;flex-wrap:wrap")}>
            <div style={css("font-size:12px;font-weight:600;color:#71717A")}>Coverage:</div>
            {req.map((c) => {
              const ok = covered.has(c);
              return <span key={c} style={css("font-size:11px;font-weight:600;border-radius:99px;padding:4px 11px;" + (ok ? "color:#1B7A3D;background:#E7F7EC" : "color:#B45309;background:#FDEBCB"))}>{ok ? "✓ " : "missing "}{c}</span>;
            })}
          </div>
        );
      })()}

      <div className="m-stack" style={css("display:grid;grid-template-columns:1fr 300px;gap:14px;align-items:start")}>
        <div style={css("display:flex;flex-direction:column;gap:14px")}>
          <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:16px 18px")}>
            <div style={css("font-size:13.5px;font-weight:700;margin-bottom:12px")}>Members</div>
            <div style={css("display:flex;flex-direction:column;gap:6px")}>
              {members.length === 0 ? (
                <div style={css("font-size:12.5px;color:var(--text-muted);padding:8px 10px")}>No agents on this team yet. Use “Add agents” to build it out.</div>
              ) : members.map((a) => {
                const m = statusMeta(agentNow(a!.id, live, !!s.paused[a!.id]).status);
                return (
                  <Box key={a!.id} noButton onClick={() => router.push("/agents/" + a!.id)} style="display:flex;align-items:center;gap:12px;padding:9px 10px;border-radius:12px;cursor:pointer" styleHover="background:#FAFAFB">
                    <div style={css(av(a!, 34))}>{a!.initials}</div>
                    <div><Link href={"/agents/" + a!.id} onClick={(e) => e.stopPropagation()} style={css("display:block;font-size:13px;font-weight:600;color:inherit;text-decoration:none")}>{a!.name}</Link><div style={css("font-size:11.5px;color:#71717A")}>{a!.role}</div></div>
                    <span style={css("display:inline-flex;align-items:center;gap:5px;margin-left:10px;" + chip(m.bg, m.color))}><span style={css("width:6px;height:6px;border-radius:50%;background:" + m.dot)} />{m.label}</span>
                    <div style={css("margin-left:auto;font-size:12px;color:#71717A")}>{teamLeads.filter((l) => l.agentId === a!.id).length} leads</div>
                    <Btn onClick={(e) => { e.stopPropagation(); removeTeamMember(team.id, a!.id); }} aria-label={"Remove " + a!.name} title="Remove from team" style="width:24px;height:24px;border-radius:50%;border:none;background:transparent;color:var(--text-muted);font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex:none" styleHover="background:#FEECEC;color:#B91C1C">✕</Btn>
                  </Box>
                );
              })}
            </div>
          </div>
          <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:16px 18px")}>
            <div style={css("font-size:13.5px;font-weight:700;margin-bottom:12px")}>Team leads <span style={css("font-size:12px;font-weight:400;color:var(--text-muted)")}>· {teamLeads.length}</span></div>
            {teamLeads.length === 0 ? (
              <div style={css("font-size:12.5px;color:var(--text-muted);padding:6px 2px")}>No leads in this team’s book yet.</div>
            ) : (
              <div style={css("display:flex;flex-direction:column")}>
                {teamLeads.slice(0, 12).map((l) => {
                  const a = byId(l.agentId);
                  return (
                    <div key={l.id} style={css("display:flex;align-items:center;gap:10px;padding:8px 2px;border-bottom:1px solid #F4F4F6")}>
                      <div style={css("font-size:12.5px;font-weight:600;min-width:0;flex:1")}>{l.name}<span style={css("font-size:11px;color:var(--text-muted);font-weight:400")}>{l.company ? " · " + l.company : ""}</span>
                        {(byLead[l.id] || l.workedBy.length > 0) && (
                          <div style={css("display:flex;align-items:center;gap:6px;margin-top:3px")}>
                            <LivePulse info={byLead[l.id]} />
                            <WorkedBy ids={l.workedBy} byId={byId} />
                          </div>
                        )}
                      </div>
                      {a && <div style={css("display:flex;align-items:center;gap:5px;flex:none")}><div style={css(av(a, 18))}>{a.initials}</div><span style={css("font-size:11px;color:#71717A")}>{a.name.split(" ")[0]}</span></div>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        <div style={css("display:flex;flex-direction:column;gap:14px")}>
          <div style={css("background:linear-gradient(135deg,#EAF2FF,#FDEEF6);border-radius:16px;padding:16px 18px")}>
            <div style={css("font-size:12.5px;font-weight:700;color:#0047B3")}>Shared goal</div>
            <div style={css("font-size:12.5px;color:#0052CC;margin-top:5px;line-height:1.55")}>{team.goal}</div>
          </div>
          {approvals.length > 0 && (
            <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:16px 18px")}>
              <div style={css("font-size:13.5px;font-weight:700;margin-bottom:10px")}>Pending approvals <span style={css("font-size:11px;font-weight:700;color:#fff;background:#006AFF;border-radius:99px;padding:1px 7px")}>{approvals.length}</span></div>
              <div style={css("display:flex;flex-direction:column;gap:10px")}>
                {approvals.map((ap) => {
                  const busy = deciding.has(ap.id);
                  const cur = busy ? "opacity:.6;cursor:default" : "cursor:pointer";
                  return (
                    <div key={ap.id} style={css("border:1px solid #F0F0F3;border-radius:12px;padding:10px 12px")}>
                      <div style={css("font-size:12px;color:#3F3F46")}><span style={css("font-weight:600")}>{ap.agentName}</span> wants to {actionPhrase(ap.capability, ap.leadCount)}.</div>
                      <div style={css("display:flex;gap:8px;margin-top:9px")}>
                        <Btn onClick={() => decide(ap.id, true)} disabled={busy} aria-busy={busy} style={"border:none;border-radius:8px;padding:5px 12px;font-size:11.5px;font-weight:600;background:#E7F7EC;color:#1B7A3D;" + cur} styleHover={busy ? undefined : "background:#D6EFDD"}>Approve</Btn>
                        <Btn onClick={() => decide(ap.id, false)} disabled={busy} style={"border:none;border-radius:8px;padding:5px 12px;font-size:11.5px;font-weight:600;background:#F4F4F5;color:#71717A;" + cur} styleHover={busy ? undefined : "background:#E4E4E7"}>Reject</Btn>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:16px 18px")}>
            <div style={css("font-size:13.5px;font-weight:700;margin-bottom:10px")}>Recent activity</div>
            <div style={css("display:flex;flex-direction:column;gap:9px")}>
              {recent.length === 0 ? (
                <div style={css("font-size:12px;color:var(--text-muted)")}>No activity yet.</div>
              ) : recent.map((f, i) => <div key={f.createdAt + i} style={css("font-size:12px;color:#3F3F46;display:flex;gap:8px")}><span style={css("color:#006AFF")}>•</span><span><b>{byId(f.agentId)?.name ?? "Agent"}</b> {f.text}</span></div>)}
            </div>
          </div>
        </div>
      </div>

      {/* Add-agents picker */}
      {showAdd && (
        <Modal onClose={() => setShowAdd(false)} labelledBy="add-agents-title" style="background:#fff;border-radius:18px;width:100%;max-width:440px;max-height:80vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 60px rgba(24,24,27,.28)">
            <div style={css("padding:18px 20px;border-bottom:1px solid #F0F0F3")}>
              <h2 id="add-agents-title" style={css("margin:0;font-size:15px;font-weight:700")}>Add agents to {team.name}</h2>
              <div style={css("font-size:12px;color:#71717A;margin-top:3px")}>Pick from agents not already on this team.</div>
            </div>
            <div style={css("flex:1;overflow-y:auto;padding:8px")}>
              {candidates.length === 0 ? (
                <div style={css("padding:20px;font-size:12.5px;color:var(--text-muted);text-align:center")}>Every agent is already on this team.</div>
              ) : candidates.map((a) => {
                const on = !!pick[a.id];
                return (
                  <Box key={a.id} onClick={() => setPick((p) => ({ ...p, [a.id]: !p[a.id] }))} aria-pressed={on} style={"display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:12px;cursor:pointer;" + (on ? "background:#EAF2FF" : "")} styleHover="background:#FAFAFB">
                    <div style={css(av(a, 32))}>{a.initials}</div>
                    <div style={css("min-width:0")}><div style={css("font-size:13px;font-weight:600")}>{a.name}</div><div style={css("font-size:11.5px;color:#71717A")}>{a.role}</div></div>
                    <span aria-hidden="true" style={css("margin-left:auto;width:20px;height:20px;border-radius:6px;flex:none;display:flex;align-items:center;justify-content:center;border:1px solid " + (on ? "#006AFF" : "#D4D4D8") + ";background:" + (on ? "#006AFF" : "#fff"))}>
                      {on && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}
                    </span>
                  </Box>
                );
              })}
            </div>
            <div style={css("padding:14px 20px;border-top:1px solid #F0F0F3;display:flex;gap:10px;justify-content:flex-end")}>
              <Btn onClick={() => setShowAdd(false)} style="background:#F4F4F5;color:#3F3F46;border:none;border-radius:99px;padding:9px 18px;font-size:12.5px;font-weight:600;cursor:pointer" styleHover="background:#E4E4E7">Cancel</Btn>
              <Btn onClick={confirmAdd} disabled={chosen.length === 0} style={"color:#fff;border:none;border-radius:99px;padding:9px 20px;font-size:12.5px;font-weight:600;background:#006AFF;" + (chosen.length === 0 ? "opacity:.5;cursor:default" : "cursor:pointer")} styleHover={chosen.length === 0 ? "" : "background:#0052CC"}>
                Add{chosen.length ? " " + chosen.length : ""}
              </Btn>
            </div>
        </Modal>
      )}

      {/* Edit-team modal */}
      {showEdit && (
        <Modal onClose={() => setShowEdit(false)} labelledBy="edit-team-title" style="background:#fff;border-radius:18px;width:100%;max-width:460px;max-height:84vh;overflow-y:auto;box-shadow:0 24px 60px rgba(24,24,27,.28)">
            <div style={css("padding:18px 22px;border-bottom:1px solid #F0F0F3")}>
              <h2 id="edit-team-title" style={css("margin:0;font-size:15px;font-weight:700")}>Edit team</h2>
              <div style={css("font-size:12px;color:#71717A;margin-top:3px")}>Change the name, icon, or shared goal.</div>
            </div>
            <div style={css("padding:20px 22px;display:flex;flex-direction:column;gap:16px")}>
              <div>
                <label htmlFor="edit-team-name" style={css("display:block;font-size:12px;font-weight:600;color:#3F3F46;margin-bottom:6px")}>Team name</label>
                <input id="edit-team-name" value={eName} onChange={(e) => setEName(e.target.value)} placeholder="e.g. EMEA Enterprise" style={css("width:100%;border:none;background:#F2F2F2;border-radius:12px;padding:14px 15px;font-size:14px")} />
              </div>
              <div>
                <div id="edit-team-icon" style={css("font-size:12px;font-weight:600;color:#3F3F46;margin-bottom:8px")}>Icon</div>
                <div role="group" aria-labelledby="edit-team-icon" style={css("display:flex;gap:8px")}>
                  {ICONS.map((ic) => (
                    <Box key={ic} onClick={() => setEIcon(ic)} aria-label={"Icon " + ic} aria-pressed={eIcon === ic} style={"width:40px;height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:18px;cursor:pointer;transition:all .12s;border:2px solid " + (eIcon === ic ? "#006AFF;background:#F2F7FF" : "#ECECF1;background:#fff")} styleHover="border-color:#CFE0FF">{ic}</Box>
                  ))}
                </div>
              </div>
              <div>
                <label htmlFor="edit-team-goal" style={css("display:block;font-size:12px;font-weight:600;color:#3F3F46;margin-bottom:6px")}>Shared goal</label>
                <textarea id="edit-team-goal" value={eGoal} onChange={(e) => setEGoal(e.target.value)} placeholder="e.g. Book 40 meetings this quarter in EMEA." style={css("width:100%;min-height:70px;border:1px solid #E4E4E7;border-radius:12px;padding:11px 13px;font-size:13px;line-height:1.55;resize:vertical;color:#18181B")} />
              </div>
            </div>
            <div style={css("padding:14px 22px;border-top:1px solid #F0F0F3;display:flex;gap:10px;justify-content:flex-end")}>
              <Btn onClick={() => setShowEdit(false)} style="background:#F4F4F5;color:#3F3F46;border:none;border-radius:99px;padding:9px 18px;font-size:12.5px;font-weight:600;cursor:pointer" styleHover="background:#E4E4E7">Cancel</Btn>
              <Btn onClick={saveEdit} style="color:#fff;border:none;border-radius:99px;padding:9px 20px;font-size:12.5px;font-weight:700;background:#006AFF;cursor:pointer" styleHover="background:#0052CC">Save changes</Btn>
            </div>
        </Modal>
      )}
    </div>
  );
}
