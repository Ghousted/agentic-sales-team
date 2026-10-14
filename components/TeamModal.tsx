"use client";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/store";
import { av } from "@/lib/visuals";
import { css, Box, Btn } from "./primitives";
import { TEAM_TEMPLATES, templateById, AGENT_TYPES, type Capability } from "@/lib/agentTypes";

const ICONS = ["🚀", "🌎", "🏛", "📣", "🎯", "💎"];

export default function TeamModal() {
  const { s, set, agents, createTeam, quickCreateAgent } = useApp();
  const router = useRouter();
  const selCount = Object.keys(s.tSel).filter((k) => s.tSel[k]).length;
  const close = () => set({ showTeamModal: false });

  return (
    <div
      onClick={close}
      style={css("position:fixed;left:0;top:0;right:0;bottom:0;background:rgba(24,24,27,.4);z-index:50;display:flex;align-items:center;justify-content:center;animation:fadeUp .2s ease")}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Create a team"
        onClick={(e) => e.stopPropagation()}
        style={css("background:#fff;border-radius:20px;width:540px;max-height:84vh;overflow-y:auto;padding:24px 26px;box-shadow:0 24px 60px rgba(24,24,27,.25);animation:fadeUp .25s ease")}
      >
        <div style={css("display:flex;align-items:center")}>
          <div>
            <div style={css("font-family:'General Sans',Inter,sans-serif;font-size:18px;font-weight:700")}>Create a team</div>
            <div style={css("font-size:12.5px;color:#71717A;margin-top:2px")}>Group agents around a shared goal.</div>
          </div>
          <Box onClick={close} aria-label="Close" style="margin-left:auto;width:30px;height:30px;border-radius:50%;background:#F4F4F5;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:13px;color:#71717A" styleHover="background:#E4E4E7">✕</Box>
        </div>

        <div style={css("margin-top:18px;display:flex;flex-direction:column;gap:16px")}>
          <div>
            <div style={css("font-size:12px;font-weight:600;color:#3F3F46;margin-bottom:6px")}>Team name</div>
            <input aria-label="Team name" value={s.tName} onChange={(e) => set({ tName: e.target.value })} placeholder="e.g. EMEA Enterprise" style={css("width:100%;border:none;background:#F2F2F2;border-radius:12px;padding:16px 15px;font-size:14px")} />
          </div>

          <div>
            <div style={css("font-size:12px;font-weight:600;color:#3F3F46;margin-bottom:8px")}>Icon</div>
            <div style={css("display:flex;gap:8px")}>
              {ICONS.map((ic) => (
                <Box key={ic} onClick={() => set({ tIcon: ic })} aria-label={"Icon " + ic} style={"width:40px;height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:18px;cursor:pointer;transition:all .12s;border:2px solid " + (s.tIcon === ic ? "#2563EB;background:#F5F8FF" : "#ECECF1;background:#fff")} styleHover="border-color:#BCD3FB">
                  {ic}
                </Box>
              ))}
            </div>
          </div>

          <div>
            <div style={css("font-size:12px;font-weight:600;color:#3F3F46;margin-bottom:8px")}>Template</div>
            <div style={css("display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px")}>
              {TEAM_TEMPLATES.map((t) => {
                const on = s.tTemplate === t.id;
                return (
                  <Box key={t.id} onClick={() => set({ tTemplate: t.id })} style={"border-radius:12px;padding:10px 12px;cursor:pointer;border:2px solid " + (on ? "#2563EB;background:#F5F8FF" : "#ECECF1;background:#fff")} styleHover="border-color:#BCD3FB">
                    <div style={css("font-size:12.5px;font-weight:700")}>{t.label}</div>
                    <div style={css("font-size:10.5px;color:#71717A;margin-top:3px")}>{t.requiredCapabilities.length ? t.requiredCapabilities.join(" · ") : "freeform"}</div>
                  </Box>
                );
              })}
            </div>
          </div>

          <div>
            <div style={css("display:flex;align-items:baseline;margin-bottom:8px")}>
              <div style={css("font-size:12px;font-weight:600;color:#3F3F46")}>Members</div>
              <div style={css("margin-left:auto;font-size:11px;color:#2563EB;font-weight:600")}>{selCount} selected</div>
            </div>
            <div style={css("display:grid;grid-template-columns:1fr 1fr;gap:8px")}>
              {agents.map((a) => {
                const on = !!s.tSel[a.id];
                return (
                  <Box key={a.id} onClick={() => set((p) => ({ tSel: { ...p.tSel, [a.id]: !on } }))} style={"display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:12px;cursor:pointer;transition:all .12s;border:2px solid " + (on ? "#2563EB;background:#F5F8FF" : "#ECECF1;background:#fff")} styleHover="border-color:#BCD3FB">
                    <div style={css(av(a, 30))}>{a.initials}</div>
                    <div style={css("min-width:0")}>
                      <div style={css("font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{a.name}</div>
                      <div style={css("font-size:10.5px;color:#71717A")}>{a.role}</div>
                    </div>
                    <span style={css("margin-left:auto;width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex:none;transition:all .12s;" + (on ? "background:#2563EB;color:#fff" : "background:#F4F4F5;color:transparent"))}>✓</span>
                  </Box>
                );
              })}
            </div>
          </div>

          {(() => {
            const req = (templateById(s.tTemplate)?.requiredCapabilities ?? []) as Capability[];
            if (!req.length) return null;
            const selectedIds = Object.keys(s.tSel).filter((k) => s.tSel[k]);
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
            const selectedIds = Object.keys(s.tSel).filter((k) => s.tSel[k]);
            const covered = new Set<string>();
            for (const a of agents) if (selectedIds.includes(a.id)) for (const c of a.capabilities) covered.add(c);
            const gaps = req.filter((c) => !covered.has(c));
            if (!gaps.length) return null;
            // Prefer a single-capability type for each gap (scout/writer/followup), else first type that has it.
            const typeForCap = (c: string) => (AGENT_TYPES.find((t) => !t.custom && t.capabilities.length === 1 && t.capabilities[0] === c) || AGENT_TYPES.find((t) => t.capabilities.includes(c as Capability)));
            return (
              <div style={css("display:flex;flex-direction:column;gap:8px")}>
                <div style={css("font-size:11.5px;color:#71717A")}>Missing capabilities — create a fitting agent:</div>
                {gaps.map((c) => {
                  const t = typeForCap(c);
                  if (!t) return null;
                  return (
                    <div key={c} style={css("display:flex;gap:8px;align-items:center;background:#FAFAFB;border:1px solid #ECECF1;border-radius:12px;padding:8px 10px")}>
                      <div style={css("font-size:12px;font-weight:600;color:#3F3F46;flex:1")}>{t.label} <span style={css("color:#A1A1AA;font-weight:400")}>· {c}</span></div>
                      <input value={s.tGapName[c] || ""} onChange={(e) => set((p) => ({ tGapName: { ...p.tGapName, [c]: e.target.value } }))} placeholder="Name" style={css("border:1px solid #E4E4E7;border-radius:8px;padding:6px 10px;font-size:12px;width:120px;outline:none")} />
                      <Btn onClick={() => { const id = quickCreateAgent(t.id, s.tGapName[c] || t.label); set((p) => ({ tSel: { ...p.tSel, [id]: true } })); }} style="background:#2563EB;color:#fff;border:none;border-radius:8px;padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer" styleHover="background:#1D4ED8">Create</Btn>
                    </div>
                  );
                })}
              </div>
            );
          })()}

          <div>
            <div style={css("font-size:12px;font-weight:600;color:#3F3F46;margin-bottom:6px")}>Shared goal</div>
            <textarea aria-label="Shared goal" value={s.tGoal} onChange={(e) => set({ tGoal: e.target.value })} placeholder="e.g. Book 40 meetings this quarter in EMEA, prioritizing fintech accounts." style={css("width:100%;min-height:70px;border:1px solid #E4E4E7;border-radius:12px;padding:11px 13px;font-size:13px;line-height:1.55;resize:vertical;color:#18181B")} />
          </div>
        </div>

        <div style={css("display:flex;gap:10px;margin-top:20px")}>
          <Btn onClick={close} style="background:#F4F4F5;color:#3F3F46;border:none;border-radius:99px;padding:9px 20px;font-size:12.5px;font-weight:600;cursor:pointer" styleHover="background:#E4E4E7">Cancel</Btn>
          <Btn onClick={() => { const id = createTeam(); router.push("/teams/" + id); }} style="margin-left:auto;background:#2563EB;color:#fff;border:none;border-radius:99px;padding:9px 24px;font-size:12.5px;font-weight:700;cursor:pointer;box-shadow:0 2px 8px rgba(37,99,235,.3)" styleHover="background:#1D4ED8">Create team</Btn>
        </div>
      </div>
    </div>
  );
}
