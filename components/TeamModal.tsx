"use client";
import { useRouter } from "next/navigation";
import { useApp, selectedMembers } from "@/lib/store";
import { av } from "@/lib/visuals";
import { css, Box, Btn } from "./primitives";
import Modal from "./Modal";
import { TEAM_TEMPLATES, templateById, AGENT_TYPES, type Capability } from "@/lib/agentTypes";

const ICONS = ["🚀", "🌎", "🏛", "📣", "🎯", "💎"];

export default function TeamModal() {
  const { s, set, agents, createTeam, quickCreateAgent } = useApp();
  const router = useRouter();
  const selectedIds = selectedMembers(s.tSel, agents);
  const selCount = selectedIds.length;
  const close = () => set({ showTeamModal: false });

  return (
    <Modal
      onClose={close}
      labelledBy="team-modal-title"
      overlayStyle="position:fixed;left:0;top:0;right:0;bottom:0;background:rgba(24,24,27,.4);z-index:50;display:flex;align-items:center;justify-content:center;animation:fadeUp .2s ease"
      className="m-modal"
      style="background:#fff;border-radius:20px;width:540px;max-height:84vh;overflow-y:auto;padding:24px 26px;box-shadow:0 24px 60px rgba(24,24,27,.25);animation:fadeUp .25s ease"
    >
        <div style={css("display:flex;align-items:center")}>
          <div>
            <h2 id="team-modal-title" style={css("margin:0;font-family:'General Sans',Inter,sans-serif;font-size:18px;font-weight:700")}>Create a team</h2>
            <div style={css("font-size:12.5px;color:#71717A;margin-top:2px")}>Group agents around a shared goal.</div>
          </div>
          <Btn onClick={close} aria-label="Close" style="margin-left:auto;width:30px;height:30px;border-radius:50%;background:#F4F4F5;border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:13px;color:#71717A" styleHover="background:#E4E4E7">✕</Btn>
        </div>

        <div style={css("margin-top:18px;display:flex;flex-direction:column;gap:16px")}>
          <div>
            <label htmlFor="team-modal-name" style={css("display:block;font-size:12px;font-weight:600;color:#3F3F46;margin-bottom:6px")}>Team name</label>
            <input id="team-modal-name" value={s.tName} onChange={(e) => set({ tName: e.target.value })} placeholder="e.g. EMEA Enterprise" style={css("width:100%;border:none;background:#F2F2F2;border-radius:12px;padding:16px 15px;font-size:14px")} />
          </div>

          <div>
            <div id="team-modal-icon" style={css("font-size:12px;font-weight:600;color:#3F3F46;margin-bottom:8px")}>Icon</div>
            <div role="group" aria-labelledby="team-modal-icon" style={css("display:flex;gap:8px")}>
              {ICONS.map((ic) => (
                <Box key={ic} onClick={() => set({ tIcon: ic })} aria-label={"Icon " + ic} aria-pressed={s.tIcon === ic} style={"width:40px;height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:18px;cursor:pointer;transition:all .12s;border:2px solid " + (s.tIcon === ic ? "#006AFF;background:#F2F7FF" : "#ECECF1;background:#fff")} styleHover="border-color:#CFE0FF">
                  {ic}
                </Box>
              ))}
            </div>
          </div>

          <div>
            <div id="team-modal-template" style={css("font-size:12px;font-weight:600;color:#3F3F46;margin-bottom:8px")}>Template</div>
            <div role="group" aria-labelledby="team-modal-template" className="m-stack" style={css("display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px")}>
              {TEAM_TEMPLATES.map((t) => {
                const on = s.tTemplate === t.id;
                return (
                  <Box key={t.id} onClick={() => set({ tTemplate: t.id })} aria-pressed={on} style={"border-radius:12px;padding:10px 12px;cursor:pointer;border:2px solid " + (on ? "#006AFF;background:#F2F7FF" : "#ECECF1;background:#fff")} styleHover="border-color:#CFE0FF">
                    <div style={css("font-size:12.5px;font-weight:700")}>{t.label}</div>
                    <div style={css("font-size:10.5px;color:#71717A;margin-top:3px")}>{t.requiredCapabilities.length ? t.requiredCapabilities.join(" · ") : "freeform"}</div>
                  </Box>
                );
              })}
            </div>
          </div>

          <div>
            <div style={css("display:flex;align-items:baseline;margin-bottom:8px")}>
              <div id="team-modal-members" style={css("font-size:12px;font-weight:600;color:#3F3F46")}>Members</div>
              <div style={css("margin-left:auto;font-size:11px;color:#006AFF;font-weight:600")}>{selCount} selected</div>
            </div>
            <div role="group" aria-labelledby="team-modal-members" className="m-stack" style={css("display:grid;grid-template-columns:1fr 1fr;gap:8px")}>
              {agents.map((a) => {
                const on = !!s.tSel[a.id];
                return (
                  <Box key={a.id} onClick={() => set((p) => ({ tSel: { ...p.tSel, [a.id]: !on } }))} aria-pressed={on} style={"display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:12px;cursor:pointer;transition:all .12s;border:2px solid " + (on ? "#006AFF;background:#F2F7FF" : "#ECECF1;background:#fff")} styleHover="border-color:#CFE0FF">
                    <div style={css(av(a, 30))}>{a.initials}</div>
                    <div style={css("min-width:0")}>
                      <div style={css("font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{a.name}</div>
                      <div style={css("font-size:10.5px;color:#71717A")}>{a.role}</div>
                    </div>
                    <span aria-hidden="true" style={css("margin-left:auto;width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex:none;transition:all .12s;" + (on ? "background:#006AFF;color:#fff" : "background:#F4F4F5;color:transparent"))}>✓</span>
                  </Box>
                );
              })}
            </div>
          </div>

          {(() => {
            const req = (templateById(s.tTemplate)?.requiredCapabilities ?? []) as Capability[];
            if (!req.length) return null;
            const covered = new Set<string>();
            for (const a of agents) if (selectedIds.includes(a.id)) for (const c of a.capabilities) covered.add(c);
            return (
              <div>
                <div style={css("font-size:12px;font-weight:600;color:#3F3F46;margin-bottom:8px")}>Coverage</div>
                <div style={css("display:flex;gap:8px;flex-wrap:wrap")}>
                  {req.map((c) => {
                    const ok = covered.has(c);
                    return <span key={c} style={css("font-size:11px;font-weight:600;border-radius:99px;padding:4px 11px;" + (ok ? "color:#1B7A3D;background:#E7F7EC" : "color:#B45309;background:#FDEBCB"))}>{ok ? "✓ " : "○ "}{c}</span>;
                  })}
                </div>
              </div>
            );
          })()}

          {(() => {
            const req = (templateById(s.tTemplate)?.requiredCapabilities ?? []) as Capability[];
            const covered = new Set<string>();
            for (const a of agents) if (selectedIds.includes(a.id)) for (const c of a.capabilities) covered.add(c);
            const gaps = req.filter((c) => !covered.has(c));
            if (!gaps.length) return null;
            // Prefer a single-capability type for each gap (scout/writer/followup), else first type that has it.
            const typeForCap = (c: string) => (AGENT_TYPES.find((t) => !t.custom && t.capabilities.length === 1 && t.capabilities[0] === c) || AGENT_TYPES.find((t) => t.capabilities.includes(c as Capability)));
            return (
              <div style={css("display:flex;flex-direction:column;gap:8px")}>
                <div style={css("font-size:11.5px;color:#71717A")}>Missing capabilities. Create an agent that has them:</div>
                {gaps.map((c) => {
                  const t = typeForCap(c);
                  if (!t) return null;
                  return (
                    <div key={c} style={css("display:flex;gap:8px;align-items:center;background:#FAFAFB;border:1px solid #ECECF1;border-radius:12px;padding:8px 10px")}>
                      <div style={css("font-size:12px;font-weight:600;color:#3F3F46;flex:1")}>{t.label} <span style={css("color:var(--text-muted);font-weight:400")}>· {c}</span></div>
                      <input aria-label={"Name for the new " + t.label} value={s.tGapName[c] || ""} onChange={(e) => set((p) => ({ tGapName: { ...p.tGapName, [c]: e.target.value } }))} placeholder="Name" style={css("border:1px solid #E4E4E7;border-radius:8px;padding:6px 10px;font-size:12px;width:120px;outline:none")} />
                      <Btn onClick={async () => { const id = await quickCreateAgent(t.id, s.tGapName[c] || t.label); if (id) set((p) => ({ tSel: { ...p.tSel, [id]: true } })); }} style="background:#006AFF;color:#fff;border:none;border-radius:8px;padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer" styleHover="background:#0052CC">Create</Btn>
                    </div>
                  );
                })}
              </div>
            );
          })()}

          <div>
            <label htmlFor="team-modal-goal" style={css("display:block;font-size:12px;font-weight:600;color:#3F3F46;margin-bottom:6px")}>Shared goal</label>
            <textarea id="team-modal-goal" value={s.tGoal} onChange={(e) => set({ tGoal: e.target.value })} placeholder="e.g. Book 40 meetings this quarter in EMEA, prioritizing fintech accounts." style={css("width:100%;min-height:70px;border:1px solid #E4E4E7;border-radius:12px;padding:11px 13px;font-size:13px;line-height:1.55;resize:vertical;color:#18181B")} />
          </div>
        </div>

        <div style={css("display:flex;gap:10px;margin-top:20px")}>
          <Btn onClick={close} style="background:#F4F4F5;color:#3F3F46;border:none;border-radius:99px;padding:9px 20px;font-size:12.5px;font-weight:600;cursor:pointer" styleHover="background:#E4E4E7">Cancel</Btn>
          <Btn onClick={async () => { const id = await createTeam(); if (id) router.push("/teams/" + id); }} style="margin-left:auto;background:#006AFF;color:#fff;border:none;border-radius:99px;padding:9px 24px;font-size:12.5px;font-weight:700;cursor:pointer;box-shadow:0 2px 8px rgba(0,106,255,.3)" styleHover="background:#0052CC">Create team</Btn>
        </div>
    </Modal>
  );
}
