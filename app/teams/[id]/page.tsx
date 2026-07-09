"use client";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useApp } from "@/lib/store";
import { statusMeta, TEAMS_BASE } from "@/lib/data";
import { av, chip } from "@/lib/visuals";
import { css, Box, Btn } from "@/components/primitives";
import { templateById, type Capability } from "@/lib/agentTypes";
import { listLeadsForAgents } from "@/lib/leads/actions";
import type { LeadDTO } from "@/lib/leads/types";
import { listPendingApprovals, approveJob, rejectJob } from "@/lib/pod/actions";
import type { ApprovalDTO } from "@/lib/pod/types";
import { useLiveWork } from "@/lib/useLiveWork";
import { WorkedBy, LivePulse } from "@/components/LeadBits";

const days = ["M", "T", "W", "T", "F", "S", "S"];

// Deterministic weekly performance series for a team: seeded by team id and
// scaled by the members' average score (weekends run lighter). Same team →
// same bars across reloads; recomputes when membership changes.
function weekSeries(teamId: string, activity: number): number[] {
  let a = 2166136261;
  for (let i = 0; i < teamId.length; i++) { a ^= teamId.charCodeAt(i); a = Math.imul(a, 16777619); }
  const out: number[] = [];
  for (let i = 0; i < 7; i++) {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    const base = 32 + (a % 58);
    out.push(Math.max(6, Math.round(base * (i >= 5 ? 0.4 : 1) * activity)));
  }
  return out;
}

export default function TeamDetail() {
  const { agents, teams, byId, addTeamMembers, deleteTeam, showToast } = useApp();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [showAdd, setShowAdd] = useState(false);
  const [pick, setPick] = useState<Record<string, boolean>>({});
  const [teamLeads, setTeamLeads] = useState<LeadDTO[]>([]);
  const [approvals, setApprovals] = useState<ApprovalDTO[]>([]);
  const [confirmDel, setConfirmDel] = useState(false);
  const { live, byLead } = useLiveWork();

  const team = teams.find((t) => t.id === params.id) || teams[0];
  // Only user-created teams can be deleted; the 4 seed teams are fixtures.
  const isSeedTeam = TEAMS_BASE.some((t) => t.id === team?.id);

  const memberIds = team ? team.members : [];
  useEffect(() => {
    if (memberIds.length) listLeadsForAgents(memberIds).then(setTeamLeads);
    else setTeamLeads([]);
    if (team) listPendingApprovals(team.id).then(setApprovals);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberIds.join(","), team?.id]);

  if (!team) return null;

  const members = team.members.map((id) => byId(id)).filter(Boolean);
  const avgScore = members.length ? Math.round(members.reduce((n, a) => n + a!.score, 0) / members.length) : 0;
  const activity = Math.max(0.55, Math.min(avgScore / 85, 1.15));
  const teamWeek = weekSeries(team.id, activity);
  const workingCount = members.filter((a) => a!.status === "working").length;

  // Agents not already on this team, for the add picker.
  const candidates = agents.filter((a) => !team.members.includes(a.id));
  const chosen = Object.keys(pick).filter((id) => pick[id]);

  const openAdd = () => { setPick({}); setShowAdd(true); };
  const confirmAdd = () => {
    if (chosen.length) addTeamMembers(team.id, chosen);
    setShowAdd(false);
  };
  const refetchPod = () => {
    if (!team) return;
    listPendingApprovals(team.id).then(setApprovals);
    if (memberIds.length) listLeadsForAgents(memberIds).then(setTeamLeads);
  };
  const approve = async (id: string) => { await approveJob(id); try { await fetch("/api/jobs/run", { method: "POST" }); } catch {} refetchPod(); };
  const reject = async (id: string) => { await rejectJob(id); refetchPod(); };

  const kpis: [string, string][] = [
    ["Meetings", String(team.meetings)], ["Pipeline", team.pipeline], ["Leads", String(teamLeads.length)], ["Avg score", avgScore ? String(avgScore) : "—"],
  ];

  return (
    <div style={css("padding:24px 26px;display:flex;flex-direction:column;gap:18px;animation:fadeUp .3s ease")}>
      <Box onClick={() => router.push("/")} style="font-size:12px;color:#71717A;cursor:pointer" styleHover="color:#5122C1">← All teams</Box>

      <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:20px;padding:22px 24px;display:flex;align-items:center;gap:16px")}>
        <div style={css("width:52px;height:52px;border-radius:14px;background:" + team.iconBg + ";display:flex;align-items:center;justify-content:center;font-size:24px;flex:none")}>{team.icon}</div>
        <div style={css("min-width:0")}>
          <div style={css("font-size:19px;font-weight:700")}>{team.name}</div>
          <div style={css("font-size:13px;color:#71717A;margin-top:2px")}>{team.desc}</div>
          <div style={css("font-size:12px;color:#5122C1;background:#F1EDFD;border-radius:99px;padding:3px 12px;display:inline-block;margin-top:8px;font-weight:600")}>{members.length} member{members.length === 1 ? "" : "s"} · {workingCount} working now</div>
        </div>
        <div style={css("margin-left:auto;display:flex;gap:8px;flex:none")}>
          <Btn onClick={openAdd} style="background:#F4F4F5;color:#3F3F46;border:none;border-radius:99px;padding:8px 18px;font-size:12.5px;font-weight:600;cursor:pointer" styleHover="background:#E4E4E7">+ Add agents</Btn>
          {!isSeedTeam && (confirmDel ? (<>
            <Btn onClick={() => { deleteTeam(team.id); router.push("/"); }} style="background:#FEECEC;color:#B91C1C;border:none;border-radius:99px;padding:8px 16px;font-size:12.5px;font-weight:600;cursor:pointer" styleHover="background:#FBD9D9">Confirm delete</Btn>
            <Btn onClick={() => setConfirmDel(false)} style="background:#F4F4F5;color:#3F3F46;border:none;border-radius:99px;padding:8px 16px;font-size:12.5px;font-weight:600;cursor:pointer" styleHover="background:#E4E4E7">Cancel</Btn>
          </>) : (
            <Btn onClick={() => setConfirmDel(true)} style="background:#fff;color:#B91C1C;border:1px solid #F3C7C7;border-radius:99px;padding:8px 16px;font-size:12.5px;font-weight:600;cursor:pointer" styleHover="background:#FEECEC">Delete team</Btn>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div style={css("display:grid;grid-template-columns:repeat(4,1fr);gap:14px")}>
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
              return <span key={w.agentId + w.capability} style={css("display:inline-flex;align-items:center;gap:5px;font-size:12px;color:#3F3F46")}><span style={css("width:6px;height:6px;border-radius:50%;background:#2FA45C;animation:pulse 1.4s ease-in-out infinite")} />{w.agentName.split(" ")[0]} — {verb} {w.leadIds.length}</span>;
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

      <div style={css("display:grid;grid-template-columns:1fr 300px;gap:14px;align-items:start")}>
        <div style={css("display:flex;flex-direction:column;gap:14px")}>
          <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:16px 18px")}>
            <div style={css("font-size:13.5px;font-weight:700;margin-bottom:12px")}>Members</div>
            <div style={css("display:flex;flex-direction:column;gap:6px")}>
              {members.length === 0 ? (
                <div style={css("font-size:12.5px;color:#A1A1AA;padding:8px 10px")}>No agents on this team yet. Use “Add agents” to build it out.</div>
              ) : members.map((a) => {
                const m = statusMeta(a!.status);
                return (
                  <Box key={a!.id} onClick={() => router.push("/agents/" + a!.id)} style="display:flex;align-items:center;gap:12px;padding:9px 10px;border-radius:12px;cursor:pointer" styleHover="background:#FAFAFB">
                    <div style={css(av(a!, 34))}>{a!.initials}</div>
                    <div><div style={css("font-size:13px;font-weight:600")}>{a!.name}</div><div style={css("font-size:11.5px;color:#71717A")}>{a!.role}</div></div>
                    <span style={css("display:inline-flex;align-items:center;gap:5px;margin-left:10px;" + chip(m.bg, m.color))}><span style={css("width:6px;height:6px;border-radius:50%;background:" + m.dot)} />{m.label}</span>
                    <div style={css("margin-left:auto;font-size:12px;font-weight:700;color:#5122C1")}>{a!.score}</div>
                  </Box>
                );
              })}
            </div>
          </div>
          <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:16px 18px")}>
            <div style={css("font-size:13.5px;font-weight:700;margin-bottom:12px")}>Team leads <span style={css("font-size:12px;font-weight:400;color:#A1A1AA")}>· {teamLeads.length}</span></div>
            {teamLeads.length === 0 ? (
              <div style={css("font-size:12.5px;color:#A1A1AA;padding:6px 2px")}>No leads in this team’s book yet.</div>
            ) : (
              <div style={css("display:flex;flex-direction:column")}>
                {teamLeads.slice(0, 12).map((l) => {
                  const a = byId(l.agentId);
                  return (
                    <div key={l.id} style={css("display:flex;align-items:center;gap:10px;padding:8px 2px;border-bottom:1px solid #F4F4F6")}>
                      <div style={css("font-size:12.5px;font-weight:600;min-width:0;flex:1")}>{l.name}<span style={css("font-size:11px;color:#A1A1AA;font-weight:400")}>{l.company ? " · " + l.company : ""}</span>
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
          <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:16px 18px")}>
            <div style={css("font-size:13.5px;font-weight:700;margin-bottom:12px")}>Team performance</div>
            <div style={css("display:flex;align-items:flex-end;gap:8px;height:100px")}>
              {teamWeek.map((v, i) => (
                <div key={i} style={css("flex:1;display:flex;flex-direction:column;align-items:center;gap:5px;height:100%;justify-content:flex-end")}>
                  <div style={css("width:100%;max-width:30px;background:linear-gradient(180deg,#F9A8D4,#F43F7E);border-radius:6px 6px 3px 3px;height:" + v + "%")} />
                  <div style={css("font-size:10px;color:#A1A1AA")}>{days[i]}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div style={css("display:flex;flex-direction:column;gap:14px")}>
          <div style={css("background:linear-gradient(135deg,#F3EFFE,#FDEEF6);border-radius:16px;padding:16px 18px")}>
            <div style={css("font-size:12.5px;font-weight:700;color:#3B0FA8")}>Shared goal</div>
            <div style={css("font-size:12.5px;color:#6D28D9;margin-top:5px;line-height:1.55")}>{team.goal}</div>
          </div>
          {approvals.length > 0 && (
            <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:16px 18px")}>
              <div style={css("font-size:13.5px;font-weight:700;margin-bottom:10px")}>Pending approvals <span style={css("font-size:11px;font-weight:700;color:#fff;background:#5122C1;border-radius:99px;padding:1px 7px")}>{approvals.length}</span></div>
              <div style={css("display:flex;flex-direction:column;gap:10px")}>
                {approvals.map((ap) => (
                  <div key={ap.id} style={css("border:1px solid #F0F0F3;border-radius:12px;padding:10px 12px")}>
                    <div style={css("font-size:12px;color:#3F3F46")}><span style={css("font-weight:600")}>{ap.agentName}</span> wants to {ap.capability} for {ap.leadCount} lead{ap.leadCount === 1 ? "" : "s"}.</div>
                    <div style={css("display:flex;gap:8px;margin-top:9px")}>
                      <Btn onClick={() => approve(ap.id)} style="border:none;border-radius:8px;padding:5px 12px;font-size:11.5px;font-weight:600;cursor:pointer;background:#E7F7EC;color:#1B7A3D" styleHover="background:#D6EFDD">Approve</Btn>
                      <Btn onClick={() => reject(ap.id)} style="border:none;border-radius:8px;padding:5px 12px;font-size:11.5px;font-weight:600;cursor:pointer;background:#F4F4F5;color:#71717A" styleHover="background:#E4E4E7">Reject</Btn>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:16px 18px")}>
            <div style={css("font-size:13.5px;font-weight:700;margin-bottom:10px")}>Recent activity</div>
            <div style={css("display:flex;flex-direction:column;gap:9px")}>
              {team.activity.map((tac) => <div key={tac} style={css("font-size:12px;color:#3F3F46;display:flex;gap:8px")}><span style={css("color:#5122C1")}>•</span>{tac}</div>)}
            </div>
          </div>
        </div>
      </div>

      {/* Add-agents picker */}
      {showAdd && (
        <div onClick={() => setShowAdd(false)} style={css("position:fixed;inset:0;background:rgba(24,24,27,.45);z-index:60;display:flex;align-items:center;justify-content:center;padding:24px;animation:fadeUp .2s ease")}>
          <div onClick={(e) => e.stopPropagation()} style={css("background:#fff;border-radius:18px;width:100%;max-width:440px;max-height:80vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 60px rgba(24,24,27,.28)")}>
            <div style={css("padding:18px 20px;border-bottom:1px solid #F0F0F3")}>
              <div style={css("font-size:15px;font-weight:700")}>Add agents to {team.name}</div>
              <div style={css("font-size:12px;color:#71717A;margin-top:3px")}>Pick from agents not already on this team.</div>
            </div>
            <div style={css("flex:1;overflow-y:auto;padding:8px")}>
              {candidates.length === 0 ? (
                <div style={css("padding:20px;font-size:12.5px;color:#A1A1AA;text-align:center")}>Every agent is already on this team.</div>
              ) : candidates.map((a) => {
                const on = !!pick[a.id];
                return (
                  <Box key={a.id} onClick={() => setPick((p) => ({ ...p, [a.id]: !p[a.id] }))} style={"display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:12px;cursor:pointer;" + (on ? "background:#F1EDFD" : "")} styleHover="background:#FAFAFB">
                    <div style={css(av(a, 32))}>{a.initials}</div>
                    <div style={css("min-width:0")}><div style={css("font-size:13px;font-weight:600")}>{a.name}</div><div style={css("font-size:11.5px;color:#71717A")}>{a.role}</div></div>
                    <span style={css("margin-left:auto;width:20px;height:20px;border-radius:6px;flex:none;display:flex;align-items:center;justify-content:center;border:1px solid " + (on ? "#5122C1" : "#D4D4D8") + ";background:" + (on ? "#5122C1" : "#fff"))}>
                      {on && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}
                    </span>
                  </Box>
                );
              })}
            </div>
            <div style={css("padding:14px 20px;border-top:1px solid #F0F0F3;display:flex;gap:10px;justify-content:flex-end")}>
              <Btn onClick={() => setShowAdd(false)} style="background:#F4F4F5;color:#3F3F46;border:none;border-radius:99px;padding:9px 18px;font-size:12.5px;font-weight:600;cursor:pointer" styleHover="background:#E4E4E7">Cancel</Btn>
              <Btn onClick={confirmAdd} disabled={chosen.length === 0} style={"color:#fff;border:none;border-radius:99px;padding:9px 20px;font-size:12.5px;font-weight:600;background:#5122C1;" + (chosen.length === 0 ? "opacity:.5;cursor:default" : "cursor:pointer")} styleHover={chosen.length === 0 ? "" : "background:#42199E"}>
                Add{chosen.length ? " " + chosen.length : ""}
              </Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
