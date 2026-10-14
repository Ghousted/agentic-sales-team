"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/store";
import { av } from "@/lib/visuals";
import { css, Box, Btn } from "@/components/primitives";
import { listTeamMessages } from "@/lib/chat/actions";
import { listPendingApprovals, approveJob, rejectJob } from "@/lib/pod/actions";
import { listTeamLeads } from "@/lib/leads/actions";
import type { TeamLeadPick } from "@/lib/leads/types";

// Navigational phrases an agent might use → the page they open. Longest first so
// "Leads → Pending" wins over "leads". Keys are lowercased.
const NAV_ROUTES: Record<string, string> = {
  "leads → pending": "/leads", "the leads": "/leads", "the lead": "/leads", "a lead": "/leads", "leads": "/leads", "lead": "/leads",
  "the catalog": "/products", "catalog": "/products", "listings": "/products", "products": "/products",
};
const NAV_ALT = Object.keys(NAV_ROUTES).sort((a, b) => b.length - a.length).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");

/** Render a chat message with @mentions highlighted (Messenger-style) and, for
 *  agent messages, navigational phrases turned into clickable links. */
function renderRich(text: string, mine: boolean, router: { push: (href: string) => void }): ReactNode[] {
  const re = new RegExp("(@[\\w'-]+)|(«[^»]+»)" + (mine ? "" : `|\\b(?:${NAV_ALT})\\b`), "gi");
  const out: ReactNode[] = [];
  let last = 0, k = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("@")) {
      out.push(<span key={k++} style={css(mine ? "font-weight:700;text-decoration:underline" : "background:#E8F0FE;color:#2563EB;border-radius:4px;padding:0 3px;font-weight:600")}>{tok}</span>);
    } else if (tok.startsWith("«")) {
      // Inline lead reference — show the name (drop the « » delimiters) as a pill.
      out.push(<span key={k++} style={css((mine ? "background:rgba(255,255,255,.22);color:#fff" : "background:#E8F0FE;color:#2563EB") + ";border-radius:4px;padding:0 4px;font-weight:600")}>{tok.slice(1, -1)}</span>);
    } else {
      const route = NAV_ROUTES[tok.toLowerCase()];
      out.push(<Box key={k++} as="span" onClick={() => router.push(route)} style="color:#2563EB;text-decoration:underline;cursor:pointer;font-weight:500;display:inline" styleHover="opacity:.7">{tok}</Box>);
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Render composer text with @mentions highlighted (same purple as sent
 *  messages) for the input backdrop. Uses box-shadow (not padding) so the
 *  highlight stays perfectly aligned with the transparent input's caret. */
function renderComposer(text: string): ReactNode[] {
  // Highlight @mentions and inline «lead» tokens. The « » delimiters stay in the
  // rendered text so its width matches the transparent input (caret alignment).
  const re = /@[\w'-]+|«[^»]+»/g;
  const out: ReactNode[] = [];
  let last = 0, k = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<span key={k++} style={css("background:#E8F0FE;color:#2563EB;border-radius:4px;box-shadow:0 0 0 2px #E8F0FE")}>{m[0]}</span>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function ChatsInner() {
  const { s, set, teams, byId, sendTeamChat, clearChat } = useApp();
  const router = useRouter();

  const teamById = (id: string) => teams.find((t) => t.id === id);
  // The stored convId can point at a deleted team; fall back to the first team so
  // the header and messages stay in sync.
  const activeId = teamById(s.convId) ? s.convId : (teams[0]?.id ?? s.convId);
  useEffect(() => {
    if (!teamById(s.convId)) { const next = teams[0]?.id; if (next) set({ convId: next }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.convId, teams, set]);
  const activeTeam = teamById(activeId);
  const teamMembers = (activeTeam?.members.map((id) => byId(id)).filter(Boolean) ?? []) as NonNullable<ReturnType<typeof byId>>[];
  const messages = s.chats[activeId] || [];
  // Track how many messages are shown + whether a staggered reveal is running, so
  // the live poll can reveal newly-arrived hand-off lines one at a time.
  const revealingRef = useRef(false);
  const shownRef = useRef(0);
  shownRef.current = messages.length;
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [handled, setHandled] = useState<Set<string>>(new Set());
  const [teamLeads, setTeamLeads] = useState<TeamLeadPick[]>([]);
  const [leadsLoaded, setLeadsLoaded] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  // Keep the highlight backdrop scrolled in lockstep with the input so long
  // messages line up as the caret runs past the right edge.
  useEffect(() => {
    if (inputRef.current && backdropRef.current) backdropRef.current.scrollLeft = inputRef.current.scrollLeft;
  }, [s.chatInput]);
  // Drop the clear-confirm when switching conversations.
  useEffect(() => { setConfirmClear(false); }, [activeId]);
  useEffect(() => {
    if (!activeTeam) { setTeamLeads([]); setLeadsLoaded(false); return; }
    let alive = true;
    setLeadsLoaded(false);
    listTeamLeads(activeTeam.id).then((ls) => { if (alive) { setTeamLeads(ls); setLeadsLoaded(true); } }).catch(() => { if (alive) setLeadsLoaded(true); });
    return () => { alive = false; };
  }, [activeTeam]);
  const addPick = (l: TeamLeadPick) => set((prev) => ({
    // Insert the lead inline in the message (like an @mention) so the AI reads the
    // reference in context; ids are kept in chatLeadPicks for the backend to resolve.
    chatInput: prev.chatInput.replace(/\/lead[^\s]*$/i, "«" + l.name + "» "),
    chatLeadPicks: prev.chatLeadPicks.some((p) => p.id === l.id) ? prev.chatLeadPicks : prev.chatLeadPicks.concat([{ id: l.id, name: l.name }]),
  }));
  // The leads actually sent = picks whose inline «name» token is still in the text,
  // so deleting the token drops the lead and the message stays the source of truth.
  const activeLeadIds = () => s.chatLeadPicks.filter((p) => s.chatInput.includes("«" + p.name + "»")).map((p) => p.id);

  const APPROVE_RE = /⟦approve:([0-9a-f-]{36})⟧/;
  const onApprove = async (jobId: string) => {
    setHandled((h) => new Set(h).add(jobId));
    await approveJob(jobId);
    try { await fetch("/api/jobs/run", { method: "POST" }); } catch { /* best-effort */ }
  };
  const onReject = async (jobId: string) => {
    setHandled((h) => new Set(h).add(jobId));
    await rejectJob(jobId);
  };

  // Live-poll the open team thread so agent-written hand-offs / approvals appear.
  // New messages (e.g. the pod chain narrating stage → stage) are revealed one at
  // a time behind a per-agent typing indicator, so they read like a live
  // conversation instead of all popping in at once. Thread history is hydrated
  // instantly on the first tick.
  useEffect(() => {
    if (!activeTeam) return;
    const teamId = activeTeam.id;
    let alive = true;
    let firstTick = true;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const replyDelay = (t: string) => Math.min(2000, Math.max(650, Math.round((t || "").length * 18)));
    const tick = async () => {
      if (revealingRef.current) return; // a reveal is running — let it finish
      let msgs: { who: string; text: string }[];
      let pend: { id: string }[];
      try { [msgs, pend] = await Promise.all([listTeamMessages(teamId), listPendingApprovals(teamId)]); }
      catch { return; } // transient — try again next tick
      if (!alive) return;
      setPendingIds(new Set(pend.map((p) => p.id)));
      const shown = shownRef.current;
      const wasFirst = firstTick;
      firstTick = false;
      if (msgs.length <= shown) return;
      if (wasFirst) {
        // Initial hydration for this thread — show history instantly, no typing.
        set((prev) => ({ chats: { ...prev.chats, [teamId]: msgs } }));
        return;
      }
      // Reveal the new tail sequentially, with a typing indicator per agent.
      revealingRef.current = true;
      try {
        for (const m of msgs.slice(shown)) {
          if (!alive) return;
          if (m.who !== "me" && m.who !== "system") {
            set({ chatTyping: m.who });
            await sleep(replyDelay(m.text));
            if (!alive) return;
          }
          set((prev) => ({ chatTyping: false, chats: { ...prev.chats, [teamId]: (prev.chats[teamId] || []).concat([m]) } }));
        }
      } finally {
        revealingRef.current = false;
        set({ chatTyping: false });
      }
    };
    tick();
    const iv = setInterval(tick, 4000);
    return () => { alive = false; revealingRef.current = false; clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTeam?.id, set]);

  // No teams yet — chatting happens with a team, so prompt the user to make one.
  if (!activeTeam) {
    return (
      <div style={css("display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:12px;text-align:center;animation:fadeUp .3s ease")}>
        <div style={css("width:52px;height:52px;border-radius:14px;background:#EEF4FF;display:flex;align-items:center;justify-content:center;font-size:24px")}>💬</div>
        <div style={css("font-size:15px;font-weight:700")}>No conversations yet</div>
        <Btn onClick={() => set({ showTeamModal: true })} style="background:#2563EB;color:#fff;border:none;border-radius:99px;padding:9px 18px;font-size:12.5px;font-weight:600;cursor:pointer" styleHover="background:#1D4ED8">+ Create a team</Btn>
      </div>
    );
  }

  return (
    <div style={css("display:flex;height:100%;animation:fadeUp .3s ease")}>
      {/* chat area */}
      <div style={css("flex:1;min-width:0;display:flex;flex-direction:column;background:#FAFAFB")}>
        <div style={css("display:flex;align-items:center;gap:11px;padding:13px 20px;background:#fff;border-bottom:1px solid #ECECF1;flex:none")}>
          <div style={css("width:34px;height:34px;border-radius:11px;background:" + activeTeam.iconBg + ";display:flex;align-items:center;justify-content:center;font-size:17px;flex:none")}>{activeTeam.icon}</div>
          <div><div style={css("font-size:13.5px;font-weight:700")}>{activeTeam.name}</div><div style={css("font-size:11px;color:#71717A")}>{teamMembers.map((a) => a.name.split(" ")[0]).join(", ")}</div></div>
          <div style={css("margin-left:auto;display:flex")}>{teamMembers.slice(0, 5).map((a, i) => <div key={a.id} style={css(av(a, 26) + ";border:2px solid #fff;margin-left:" + (i ? "-8" : "0") + "px")}>{a.initials}</div>)}</div>
          {!confirmClear ? (
            <Btn onClick={() => setConfirmClear(true)} style="flex:none;background:#F4F4F5;color:#71717A;border:none;border-radius:99px;padding:6px 12px;font-size:11.5px;font-weight:600;cursor:pointer" styleHover="background:#FBE9E9;color:#C0392B">Clear chat</Btn>
          ) : (
            <div style={css("flex:none;display:flex;align-items:center;gap:6px")}>
              <Btn onClick={() => { clearChat(activeId); setConfirmClear(false); }} style="background:#C0392B;color:#fff;border:none;border-radius:99px;padding:6px 12px;font-size:11.5px;font-weight:600;cursor:pointer" styleHover="background:#A93226">Clear</Btn>
              <Btn onClick={() => setConfirmClear(false)} style="background:#F4F4F5;color:#71717A;border:none;border-radius:99px;padding:6px 12px;font-size:11.5px;font-weight:600;cursor:pointer" styleHover="background:#E4E4E7">Cancel</Btn>
            </div>
          )}
        </div>

        <div style={css("flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:12px")}>
          {messages.map((m, i) => {
            const mine = m.who === "me";
            const speaker = !mine ? byId(m.who) : null;
            const am = m.text.match(APPROVE_RE);
            const clean = m.text.replace(APPROVE_RE, "").replace(/⟦meet:[^⟧]*⟧/, "").trim();
            const showApprove = !!am && pendingIds.has(am[1]) && !handled.has(am[1]);
            return (
              <div key={i} style={css("display:flex;gap:8px;justify-content:" + (mine ? "flex-end" : "flex-start"))}>
                {speaker && <div style={css(av(speaker, 26) + ";flex:none;margin-top:2px")}>{speaker.initials}</div>}
                <div style={css("display:flex;flex-direction:column;max-width:62%;gap:2px")}>
                  {speaker && <div style={css("font-size:10.5px;font-weight:600;color:#71717A;padding-left:4px")}>{speaker.name.split(" ")[0]}</div>}
                  <div style={css((mine ? "background:#2563EB;color:#fff;border-radius:16px 16px 4px 16px;" : "background:#fff;color:#3F3F46;border:1px solid #ECECF1;border-radius:16px 16px 16px 4px;") + "padding:11px 15px;font-size:13px;line-height:1.55;animation:fadeUp .25s ease")}>{renderRich(clean, mine, router)}</div>
                  {showApprove && (
                    <div style={css("display:flex;gap:8px;margin-top:6px;padding-left:2px")}>
                      <Btn onClick={() => onApprove(am![1])} style="background:#E7F7EC;color:#1B7A3D;border:none;border-radius:99px;padding:6px 16px;font-size:12px;font-weight:600;cursor:pointer" styleHover="background:#D6EFDD">Approve</Btn>
                      <Btn onClick={() => onReject(am![1])} style="background:#F4F4F5;color:#71717A;border:none;border-radius:99px;padding:6px 16px;font-size:12px;font-weight:600;cursor:pointer" styleHover="background:#E4E4E7">Reject</Btn>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {s.chatTyping && (() => {
            const typer = typeof s.chatTyping === "string" ? byId(s.chatTyping) : null;
            return (
              <div style={css("display:flex;gap:8px;justify-content:flex-start;animation:fadeUp .2s ease")}>
                {typer && <div style={css(av(typer, 26) + ";flex:none;margin-top:2px")}>{typer.initials}</div>}
                <div style={css("display:flex;flex-direction:column;gap:2px")}>
                  {typer && <div style={css("font-size:10.5px;font-weight:600;color:#71717A;padding-left:4px")}>{typer.name.split(" ")[0]}</div>}
                  <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px 16px 16px 4px;padding:12px 16px;display:flex;gap:4px")}>
                    <span style={css("width:6px;height:6px;border-radius:50%;background:#A1A1AA;animation:typing 1.2s infinite")} />
                    <span style={css("width:6px;height:6px;border-radius:50%;background:#A1A1AA;animation:typing 1.2s infinite .15s")} />
                    <span style={css("width:6px;height:6px;border-radius:50%;background:#A1A1AA;animation:typing 1.2s infinite .3s")} />
                  </div>
                </div>
              </div>
            );
          })()}
        </div>

        <div style={css("padding:14px 20px;background:#FAFAFB;flex:none;position:relative")}>
          {activeTeam && (() => {
            const m = s.chatInput.match(/@([\w'-]*)$/);
            if (!m) return null;
            const q = m[1].toLowerCase();
            const hits = teamMembers.filter((a) => a!.name.toLowerCase().includes(q)).slice(0, 5);
            if (hits.length === 0) return null;
            return (
              <div style={css("position:absolute;bottom:64px;left:20px;background:#fff;border:1px solid #ECECF1;border-radius:12px;box-shadow:0 12px 32px rgba(24,24,27,.14);overflow:hidden;z-index:20;min-width:220px")}>
                {hits.map((a) => (
                  <Box key={a!.id} onClick={() => set({ chatInput: s.chatInput.replace(/@([\w'-]*)$/, "@" + a!.name.split(" ")[0] + " ") })} style="display:flex;align-items:center;gap:9px;padding:9px 12px;cursor:pointer" styleHover="background:#F4F4F5">
                    <div style={css(av(a!, 24))}>{a!.initials}</div>
                    <div style={css("font-size:12.5px;font-weight:600")}>{a!.name}<span style={css("font-size:10.5px;color:#A1A1AA;font-weight:400")}> · {a!.capabilities.join(", ") || "no capabilities"}</span></div>
                  </Box>
                ))}
              </div>
            );
          })()}
          {activeTeam && (() => {
            const m = s.chatInput.match(/\/lead([^\s]*)$/i);
            if (!m) return null;
            const q = m[1].toLowerCase();
            const hits = teamLeads.filter((l) => (l.name + " " + l.title + " " + l.company).toLowerCase().includes(q)).slice(0, 6);
            if (hits.length === 0) return (
              <div style={css("position:absolute;bottom:64px;left:20px;background:#fff;border:1px solid #ECECF1;border-radius:12px;box-shadow:0 12px 32px rgba(24,24,27,.14);padding:11px 14px;z-index:20;font-size:12px;color:#A1A1AA")}>
                {leadsLoaded ? "No leads yet — scrape some first." : "Loading leads…"}
              </div>
            );
            return (
              <div style={css("position:absolute;bottom:64px;left:20px;background:#fff;border:1px solid #ECECF1;border-radius:12px;box-shadow:0 12px 32px rgba(24,24,27,.14);overflow:hidden;z-index:20;min-width:280px;max-height:280px;overflow-y:auto")}>
                {hits.map((l) => (
                  <Box key={l.id} onClick={() => addPick(l)} style="display:flex;align-items:center;gap:9px;padding:9px 12px;cursor:pointer" styleHover="background:#F4F4F5">
                    <div style={css("flex:1;font-size:12.5px;font-weight:600;color:#18181B")}>{l.name}<span style={css("font-size:10.5px;color:#A1A1AA;font-weight:400")}> · {l.title || l.company || l.platform || "lead"}</span></div>
                    <div style={css("font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;border-radius:99px;padding:2px 7px;" + (l.review === "accepted" ? "background:#E7F7EC;color:#1B7A3D" : "background:#FEF3E7;color:#B7791F"))}>{l.review}</div>
                  </Box>
                ))}
              </div>
            );
          })()}
          <div style={css("display:flex;gap:10px;background:#fff;border:1px solid #ECECF1;border-radius:99px;padding:6px 6px 6px 18px;box-shadow:0 1px 3px rgba(24,24,27,.05)")}>
            <div style={css("flex:1;min-width:0;position:relative;display:flex;align-items:center")}>
              <div ref={backdropRef} aria-hidden style={css("position:absolute;inset:0;display:flex;align-items:center;overflow:hidden;pointer-events:none;font-size:13px;color:#18181B")}>
                <span style={css("white-space:pre;line-height:20px")}>{renderComposer(s.chatInput)}</span>
              </div>
              <input
                ref={inputRef}
                aria-label="Message"
                value={s.chatInput}
                onChange={(e) => set({ chatInput: e.target.value })}
                onScroll={(e) => { if (backdropRef.current) backdropRef.current.scrollLeft = e.currentTarget.scrollLeft; }}
                onKeyDown={(e) => {
                  // Backspace over a whole «lead» token removes it in one press
                  // (a plain input would otherwise chip away at it char-by-char).
                  if (e.key === "Backspace" && inputRef.current && inputRef.current.selectionStart === inputRef.current.selectionEnd) {
                    const caret = inputRef.current.selectionStart ?? 0;
                    const tok = s.chatInput.slice(0, caret).match(/«[^«»]*»$/);
                    if (tok) { e.preventDefault(); set({ chatInput: s.chatInput.slice(0, caret - tok[0].length) + s.chatInput.slice(caret) }); return; }
                  }
                  // Tab / Enter accept the top @mention suggestion in team chats.
                  // Tab always accepts; Enter accepts only when a query follows
                  // the "@", otherwise it sends.
                  if (activeTeam && (e.key === "Tab" || e.key === "Enter")) {
                    const mm = s.chatInput.match(/@([\w'-]*)$/);
                    const hit = mm ? teamMembers.find((a) => a!.name.toLowerCase().includes(mm[1].toLowerCase())) : undefined;
                    if (hit && (e.key === "Tab" || mm![1])) { e.preventDefault(); set({ chatInput: s.chatInput.replace(/@([\w'-]*)$/, "@" + hit!.name.split(" ")[0] + " ") }); return; }
                    if (e.key === "Tab") return; // nothing to complete — let Tab move focus
                  }
                  if (e.key !== "Enter") return;
                  sendTeamChat(activeTeam.id, s.chatInput, activeLeadIds());
                }}
                placeholder="Message the team — @mention an agent, /lead to pick leads…"
                style={css("flex:1;min-width:0;border:none;outline:none;font-size:13px;line-height:20px;background:transparent;position:relative;z-index:1;caret-color:#18181B;color:" + (s.chatInput ? "transparent" : "#18181B"))}
              />
            </div>
            <Btn onClick={() => sendTeamChat(activeTeam.id, s.chatInput, activeLeadIds())} style="background:#2563EB;color:#fff;border:none;border-radius:99px;padding:8px 18px;font-size:12.5px;font-weight:600;cursor:pointer" styleHover="background:#1D4ED8">Send ↑</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ChatsPage() {
  return <ChatsInner />;
}
