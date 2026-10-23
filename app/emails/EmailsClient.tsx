"use client";
// Emails page: every outreach draft across all agents. A list on
// the left (status tabs, agent picker, search) and the full selected draft on the
// right, with the send actions.
import { useMemo, useState } from "react";
import { useApp } from "@/lib/store";
import { css, Box, Btn } from "@/components/primitives";
import { av, chip } from "@/lib/visuals";
import { markDraftSent, discardDraft, clearSentDrafts } from "@/lib/leads/actions";
import { draftCounts, filterDrafts, isSent, mailtoUrl, relTime, type DraftFilter } from "@/lib/leads/drafts";
import type { DraftDTO } from "@/lib/leads/types";
import { openExternal, openMailto } from "@/lib/url/safeUrl";

const INPUT = "border:1px solid #E4E4E7;background:#fff;border-radius:10px;padding:9px 12px;font-size:13px;color:#18181B;outline:none";
const PRIMARY = "background:#E6F0FF;color:#006AFF;border:none;border-radius:99px;padding:7px 15px;font-size:12.5px;font-weight:600;cursor:pointer";
const SECONDARY = "background:#F4F4F5;color:#3F3F46;border:none;border-radius:99px;padding:7px 15px;font-size:12.5px;font-weight:600;cursor:pointer";

const TABS: { id: DraftFilter; label: string }[] = [
  { id: "unsent", label: "To send" },
  { id: "sent", label: "Sent" },
  { id: "all", label: "All" },
];

export default function EmailsClient({ initialDrafts }: { initialDrafts: DraftDTO[] }) {
  const { agents, byId, showToast, showError } = useApp();
  const [drafts, setDrafts] = useState<DraftDTO[]>(initialDrafts);
  const [tab, setTab] = useState<DraftFilter>("unsent");
  const [fAgent, setFAgent] = useState("");
  const [q, setQ] = useState("");
  const [selId, setSelId] = useState<string | null>(null);

  const counts = draftCounts(drafts);
  const shown = useMemo(() => filterDrafts(drafts, { status: tab, agentId: fAgent, q }), [drafts, tab, fAgent, q]);
  // Keep the picked draft while it is in the list, otherwise show the first one.
  const sel = shown.find((d) => d.id === selId) ?? shown[0] ?? null;
  const agentsWithDrafts = agents.filter((a) => drafts.some((d) => d.agentId === a.id));

  const copyMessage = (d: DraftDTO) => {
    navigator.clipboard?.writeText(d.body).then(() => showToast("Message copied"), () => showError("Copy failed"));
  };
  const markSent = async (d: DraftDTO) => {
    setDrafts((prev) => prev.map((x) => (x.id === d.id ? { ...x, status: "sent", sentAt: new Date().toISOString() } : x)));
    await markDraftSent(d.id);
    showToast("Marked as sent");
  };
  // Discard / Clear sent soft-hide the draft. Analytics counts still read the row.
  const discard = async (d: DraftDTO) => {
    setDrafts((prev) => prev.filter((x) => x.id !== d.id));
    await discardDraft(d.id);
    showToast("Draft discarded");
  };
  const clearSent = async () => {
    setDrafts((prev) => prev.filter((x) => !isSent(x)));
    const n = await clearSentDrafts();
    if (n > 0) showToast(`Cleared ${n} sent draft${n === 1 ? "" : "s"}`);
  };

  return (
    <div className="m-page" style={css("padding:24px 26px;display:flex;flex-direction:column;gap:18px;animation:fadeUp .3s ease")}>
      <div style={css("display:flex;align-items:center;gap:12px;flex-wrap:wrap")}>
        <div style={css("display:flex;background:#F4F4F5;border-radius:99px;padding:3px")}>
          {TABS.map((t) => {
            const n = t.id === "unsent" ? counts.unsent : t.id === "sent" ? counts.sent : counts.total;
            return (
              <Box key={t.id} onClick={() => setTab(t.id)} style={"padding:6px 14px;font-size:12.5px;font-weight:600;border-radius:99px;cursor:pointer;display:flex;align-items:center;gap:6px;" + (tab === t.id ? "background:#fff;color:#18181B;box-shadow:0 1px 2px rgba(0,0,0,.08)" : "color:#71717A")}>
                {t.label}<span style={css("font-size:10.5px;color:var(--text-muted)")}>{n}</span>
              </Box>
            );
          })}
        </div>
        <div style={css("margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap")}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search lead, company or text" aria-label="Search drafts" style={css(INPUT + ";width:230px")} />
          <select value={fAgent} onChange={(e) => setFAgent(e.target.value)} aria-label="Filter by agent" style={css(INPUT + ";cursor:pointer")}>
            <option value="">All agents</option>
            {agentsWithDrafts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          {counts.sent > 0 && <Btn onClick={clearSent} style={SECONDARY} styleHover="background:#FEECF2;color:#F43F7E">Clear sent</Btn>}
        </div>
      </div>

      {drafts.length === 0 ? (
        <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:40px;text-align:center;font-size:13px;color:var(--text-muted)")}>
          No drafts yet. Ask an agent to draft outreach and the emails show here.
        </div>
      ) : (
        <div style={css("display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap")}>
          {/* list */}
          <div style={css("flex:1 1 320px;max-width:420px;min-width:0;background:#fff;border:1px solid #ECECF1;border-radius:16px;overflow:hidden")}>
            <div style={css("max-height:calc(100vh - 300px);overflow-y:auto")}>
              {shown.length === 0 ? (
                <div style={css("padding:20px;font-size:12.5px;color:var(--text-muted)")}>No drafts match.</div>
              ) : shown.map((d) => {
                const a = byId(d.agentId);
                const active = sel?.id === d.id;
                return (
                  <Box key={d.id} onClick={() => setSelId(d.id)} style={"padding:12px 16px;border-bottom:1px solid #F4F4F6;cursor:pointer;border-left:3px solid " + (active ? "#006AFF" : "transparent") + ";background:" + (active ? "#F7FAFF" : "#fff")} styleHover={active ? undefined : "background:#FAFAFB"}>
                    <div style={css("display:flex;align-items:center;gap:8px;min-width:0")}>
                      <span style={css("font-size:13px;font-weight:600;color:#18181B;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>{d.leadName}</span>
                      {d.leadCompany && <span style={css("font-size:11.5px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>{d.leadCompany}</span>}
                      <span style={css("margin-left:auto;flex:none;font-size:10.5px;color:var(--text-muted)")}>{relTime(d.createdAt)}</span>
                    </div>
                    <div style={css("font-size:12.5px;color:#3F3F46;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>{d.subject}</div>
                    <div style={css("display:flex;align-items:center;gap:6px;margin-top:6px")}>
                      {a && <div style={css(av(a, 18))}>{a.initials}</div>}
                      <span style={css("font-size:11px;color:#71717A")}>{a ? a.name.split(" ")[0] : "Agent"}</span>
                      <span style={css("margin-left:auto;" + chip(isSent(d) ? "#E7F7EC" : "#EAF2FF", isSent(d) ? "#1B7A3D" : "#006AFF"))}>{isSent(d) ? "Sent" : "Draft"}</span>
                    </div>
                  </Box>
                );
              })}
            </div>
          </div>

          {/* selected draft */}
          {sel && <DraftView d={sel} agentName={byId(sel.agentId)?.name ?? "Agent"} onCopy={copyMessage} onMarkSent={markSent} onDiscard={discard} />}
        </div>
      )}
    </div>
  );
}

function DraftView({ d, agentName, onCopy, onMarkSent, onDiscard }: {
  d: DraftDTO; agentName: string;
  onCopy: (d: DraftDTO) => void; onMarkSent: (d: DraftDTO) => void; onDiscard: (d: DraftDTO) => void;
}) {
  const sent = isSent(d);
  const to = d.leadEmail || (d.leadPlatform ? d.leadPlatform + " DM" : "no email");
  return (
    <div style={css("flex:2 1 420px;min-width:0;background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:22px 24px")}>
      <div style={css("display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap")}>
        <div style={css("min-width:0;flex:1")}>
          <div style={css("font-family:'General Sans',Inter,sans-serif;font-size:18px;color:#18181B;overflow-wrap:anywhere")}>{d.subject}</div>
          <div style={css("font-size:12px;color:#71717A;margin-top:6px;overflow-wrap:anywhere")}>
            To <b style={css("color:#18181B;font-weight:600")}>{d.leadName}</b>{d.leadCompany ? " · " + d.leadCompany : ""} · {to}
          </div>
          <div style={css("font-size:11.5px;color:var(--text-muted);margin-top:3px")}>
            Drafted by {agentName} · {new Date(d.createdAt).toLocaleString()}{sent && d.sentAt ? " · sent " + new Date(d.sentAt).toLocaleString() : ""}
          </div>
        </div>
        <span style={css(chip(sent ? "#E7F7EC" : "#EAF2FF", sent ? "#1B7A3D" : "#006AFF"))}>{sent ? "Sent" : "Draft"}</span>
      </div>

      <div style={css("margin-top:18px;padding:16px 18px;background:#FAFAFB;border:1px solid #F0F0F3;border-radius:12px;font-size:13px;color:#27272A;line-height:1.65;white-space:pre-wrap;overflow-wrap:anywhere")}>{d.body}</div>

      {d.rationale && (
        <div style={css("margin-top:14px")}>
          <div style={css("font-size:11px;font-weight:700;color:#71717A;text-transform:uppercase;letter-spacing:.04em")}>Why this angle</div>
          <div style={css("font-size:12.5px;color:#52525B;line-height:1.6;margin-top:5px;white-space:pre-wrap")}>{d.rationale}</div>
        </div>
      )}

      <div style={css("display:flex;gap:8px;margin-top:18px;flex-wrap:wrap")}>
        {d.leadEmail
          ? <Btn onClick={() => openMailto(mailtoUrl(d))} style={PRIMARY} styleHover="background:#D6E6FF">Open in mail</Btn>
          : <Btn onClick={() => onCopy(d)} style={PRIMARY} styleHover="background:#D6E6FF">Copy message</Btn>}
        {d.leadEmail && <Btn onClick={() => onCopy(d)} style={SECONDARY} styleHover="background:#E4E4E7">Copy message</Btn>}
        {d.leadProfileUrl && <Btn onClick={() => openExternal(d.leadProfileUrl)} style={SECONDARY} styleHover="background:#E4E4E7">Open profile</Btn>}
        {!sent && <Btn onClick={() => onMarkSent(d)} style={SECONDARY} styleHover="background:#E4E4E7">Mark sent</Btn>}
        {!sent && <Btn onClick={() => onDiscard(d)} style="background:transparent;color:var(--text-muted);border:none;border-radius:99px;padding:7px 13px;font-size:12.5px;font-weight:600;cursor:pointer" styleHover="background:#FEECF2;color:#F43F7E">Discard</Btn>}
      </div>
    </div>
  );
}
