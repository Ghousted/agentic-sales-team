"use client";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/store";
import { av } from "@/lib/visuals";
import { css, Box, Btn } from "@/components/primitives";
import { listTeamMessages } from "@/lib/chat/actions";
import { mergeThread, stripMarkers, threadCursor, type StoredMsg, type ThreadMsg } from "@/lib/chat/thread";
import { isNearBottom, shouldStick } from "@/lib/chat/scroll";
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
      out.push(<span key={k++} style={css(mine ? "font-weight:700;text-decoration:underline" : "background:#E6F0FF;color:#006AFF;border-radius:4px;padding:0 3px;font-weight:600")}>{tok}</span>);
    } else if (tok.startsWith("«")) {
      // Inline lead reference. Show the name as a pill (remove the « » delimiters).
      out.push(<span key={k++} style={css((mine ? "background:rgba(255,255,255,.22);color:#fff" : "background:#E6F0FF;color:#006AFF") + ";border-radius:4px;padding:0 4px;font-weight:600")}>{tok.slice(1, -1)}</span>);
    } else {
      const route = NAV_ROUTES[tok.toLowerCase()];
      out.push(<Box key={k++} as="span" onClick={() => router.push(route)} style="color:#006AFF;text-decoration:underline;cursor:pointer;font-weight:500;display:inline" styleHover="opacity:.7">{tok}</Box>);
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
    out.push(<span key={k++} style={css("background:#E6F0FF;color:#006AFF;border-radius:4px;box-shadow:0 0 0 2px #E6F0FF")}>{m[0]}</span>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function ChatsInner() {
  const { s, set, teams, byId, sendTeamChat, clearChat, registerThreadPoll } = useApp();
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
  // The poll cursor (highest stored id fetched for the open thread), the stored
  // rows fetched but not yet revealed, and whether a clear is in flight. Refs, so
  // Clear chat can reach into the running poll.
  const chatsRef = useRef(s.chats);
  chatsRef.current = s.chats;
  const cursorRef = useRef(0);
  const queueRef = useRef<StoredMsg[]>([]);
  const clearingRef = useRef(false);
  // The agent whose next line is being revealed. Only the reveal below writes it;
  // the store's chatAwaiting (a send still waiting on the server) is separate.
  const [typer, setTyper] = useState<string | null>(null);
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
  // Each fetch asks only for rows after the cursor and the thread is merged by
  // id, so rows are never dropped, doubled or reordered whoever wrote them (the
  // reply, the pod chain, a job outcome). New rows (e.g. the pod chain narrating
  // stage → stage) are revealed one at a time behind a per-agent typing
  // indicator, so they read like a live conversation instead of all popping in
  // at once. Thread history is shown instantly on the first fetch.
  useEffect(() => {
    if (!activeTeam) return;
    const teamId = activeTeam.id;
    let alive = true;
    let first = true;
    let revealing = false;
    let busy = false;
    let chain: Promise<void> = Promise.resolve();
    cursorRef.current = threadCursor(chatsRef.current[teamId]);
    queueRef.current = [];
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const replyDelay = (t: string) => Math.min(2000, Math.max(650, Math.round((t || "").length * 18)));
    const show = (rows: StoredMsg[]) => set((prev) => ({ chats: { ...prev.chats, [teamId]: mergeThread(prev.chats[teamId], rows) } }));
    const reveal = async () => {
      if (revealing) return;
      revealing = true;
      try {
        while (alive && queueRef.current.length) {
          const m = queueRef.current[0];
          if (m.who !== "me" && m.who !== "system") {
            setTyper(m.who);
            await sleep(replyDelay(m.text));
            if (!alive) return;
            if (queueRef.current[0] !== m) continue; // a clear emptied the queue meanwhile
          }
          queueRef.current.shift();
          setTyper(null);
          show([m]);
        }
      } finally {
        revealing = false;
        if (alive) setTyper(null);
      }
    };
    const fetchNew = async () => {
      busy = true;
      try {
        const [rows, pend] = await Promise.all([listTeamMessages(teamId, cursorRef.current), listPendingApprovals(teamId)]);
        if (!alive) return;
        setPendingIds(new Set(pend.map((p) => p.id)));
        // Read the cursor now, not at request time: a clear may have moved it past
        // rows this request still returned.
        const fresh = clearingRef.current ? [] : rows.filter((r) => r.id > cursorRef.current);
        if (fresh.length) cursorRef.current = fresh[fresh.length - 1].id;
        if (first) { first = false; show(fresh); return; } // history: no typing
        queueRef.current.push(...fresh);
        reveal();
      } catch { /* temporary error. Try again on the next tick. */ }
      finally { busy = false; }
    };
    // Fetches run one at a time, so a send's fetch always starts after the one
    // in flight and sees the replies the server just stored.
    const pull = () => (chain = chain.then(fetchNew));
    registerThreadPoll(teamId, pull);
    pull();
    const iv = setInterval(() => { if (!busy) pull(); }, 4000);
    return () => {
      alive = false;
      clearInterval(iv);
      registerThreadPoll(teamId, null);
      show(queueRef.current.splice(0)); // leave nothing fetched-but-hidden behind
      setTyper(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTeam?.id, set, registerThreadPoll]);

  const onClear = async () => {
    setConfirmClear(false);
    clearingRef.current = true;
    queueRef.current = [];
    try {
      const lastDeleted = await clearChat(activeId);
      cursorRef.current = Math.max(cursorRef.current, lastDeleted);
    } finally { clearingRef.current = false; }
  };
  const typing: string | true | null = typer ?? ((s.chatAwaiting[activeId] ?? 0) > 0 ? true : null);

  // Keep the newest message, typing dots and Approve buttons in view. Only
  // follows when the user was already at the bottom (tracked on scroll, before
  // the new content lands), except on a fresh thread or their own send.
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const shownRef = useRef<{ id: string; len: number } | null>(null);
  const last = messages[messages.length - 1];
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const prev = shownRef.current;
    const fresh = !prev || prev.id !== activeId || prev.len === 0;
    const sentByMe = !!prev && messages.length > prev.len && last?.who === "me";
    shownRef.current = { id: activeId, len: messages.length };
    if (shouldStick({ fresh, sentByMe, wasNearBottom: nearBottomRef.current })) {
      el.scrollTop = el.scrollHeight;
      nearBottomRef.current = true;
    }
  }, [activeId, messages.length, last, typing, pendingIds]);

  // No teams yet. A chat needs a team, so tell the user to make one.
  if (!activeTeam) {
    return (
      <div style={css("display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:10px;text-align:center;animation:cFade .2s backwards")}>
        <i className="icon-messages-square" style={{ fontSize: 26, color: "#8a94a3" }} />
        <div style={css("font-size:16px;font-weight:500")}>No conversations yet</div>
        <div style={css("font-size:14px;color:#6b7686")}>Chats happen with a team. Create one to get started.</div>
        <Btn onClick={() => set({ showTeamModal: true })} style="margin-top:6px;height:36px;padding:0 16px;border:0;border-radius:999px;background:#101418;color:#ffffff;font-size:14px;font-weight:500;cursor:pointer" styleHover="background:#2a313b">Create a team</Btn>
      </div>
    );
  }

  return (
    <div style={css("display:flex;height:100%")}>
      {/* chat area */}
      <div style={css("flex:1;min-width:0;display:flex;flex-direction:column;background:#ffffff")}>
        <div key={activeId} style={css("display:flex;align-items:center;gap:10px;padding:0 20px 10px;background:#fff;flex:none;animation:cSwapA .2s ease-out backwards")}>
          <div style={css("width:28px;height:28px;border-radius:50%;background:" + activeTeam.iconBg + ";display:flex;align-items:center;justify-content:center;font-size:14px;flex:none")}>{activeTeam.icon}</div>
          <div style={css("min-width:0")}><div style={css("font-size:15px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{activeTeam.name}</div><div style={css("font-size:12px;color:#6b7686;white-space:nowrap")}>{teamMembers.map((a) => a.name.split(" ")[0]).join(", ")}</div></div>
          <div style={css("margin-left:auto;display:flex")}>{teamMembers.slice(0, 5).map((a, i) => <div key={a.id} style={css(av(a, 26) + ";border:2px solid #fff;margin-left:" + (i ? "-8" : "0") + "px")}>{a.initials}</div>)}</div>
          {!confirmClear ? (
            <Btn onClick={() => setConfirmClear(true)} style="flex:none;height:32px;background:transparent;color:#6b7686;border:0;border-radius:999px;padding:0 12px;font-size:13px;cursor:pointer" styleHover="background:#f1f3f6;color:#101418">Clear chat</Btn>
          ) : (
            <div style={css("flex:none;display:flex;align-items:center;gap:6px")}>
              <Btn onClick={onClear} style="background:#C0392B;color:#fff;border:none;border-radius:99px;padding:6px 12px;font-size:11.5px;font-weight:600;cursor:pointer" styleHover="background:#A93226">Clear</Btn>
              <Btn onClick={() => setConfirmClear(false)} style="background:#F4F4F5;color:#71717A;border:none;border-radius:99px;padding:6px 12px;font-size:11.5px;font-weight:600;cursor:pointer" styleHover="background:#E4E4E7">Cancel</Btn>
            </div>
          )}
        </div>

        <div ref={scrollRef} onScroll={(e) => { nearBottomRef.current = isNearBottom(e.currentTarget); }} style={css("flex:1;overflow-y:auto;padding:12px 20px 24px")}>
        <div style={css("max-width:740px;margin:0 auto;display:flex;flex-direction:column;gap:22px;padding-top:12px")}>
          {messages.map((m, i) => {
            const mine = m.who === "me";
            const speaker = !mine ? byId(m.who) : null;
            const am = m.text.match(APPROVE_RE);
            const clean = stripMarkers(m.text);
            const showApprove = !!am && pendingIds.has(am[1]) && !handled.has(am[1]);
            return (
              <div key={(m as ThreadMsg).id ?? "local-" + i} style={css("display:flex;gap:12px;animation:cUp .25s ease-out backwards;justify-content:" + (mine ? "flex-end" : "flex-start"))}>
                {!mine && <span style={css("width:30px;flex:none")}>{speaker && (i === 0 || messages[i - 1].who !== m.who) && <span style={css(av(speaker, 30))}>{speaker.initials}</span>}</span>}
                <div style={css("display:flex;flex-direction:column;gap:6px;min-width:0;" + (mine ? "max-width:78%;align-items:flex-end" : "flex:1"))}>
                  {speaker && (i === 0 || messages[i - 1].who !== m.who) && <div style={css("font-size:13px;font-weight:500;padding-top:5px")}>{speaker.name.split(" ")[0]}</div>}
                  {!mine && !speaker && m.who === "system" ? (
                    <div style={css("align-self:center;font-size:13px;color:#6b7686;display:flex;align-items:center;gap:6px")}><i className="icon-info" style={{ fontSize: 14 }} />{renderRich(clean, mine, router)}</div>
                  ) : (
                    <div style={css((mine ? "background:#006aff;color:#fff;border-radius:20px 20px 6px 20px;" : "align-self:flex-start;max-width:92%;background:#f1f3f6;color:#101418;border-radius:6px 20px 20px 20px;") + "padding:11px 16px;font-size:15px;line-height:1.6;white-space:pre-wrap")}>{renderRich(clean, mine, router)}</div>
                  )}
                  {showApprove && (
                    <div style={css("display:flex;gap:6px;flex-wrap:wrap;animation:cUp .25s ease-out backwards")}>
                      <Btn onClick={() => onApprove(am![1])} style="height:34px;padding:0 16px;border:0;border-radius:999px;background:#101418;color:#ffffff;font-size:14px;font-weight:500;cursor:pointer;display:flex;align-items:center;gap:6px" styleHover="background:#2a313b"><i className="icon-check" style={{ fontSize: 15 }} />Approve</Btn>
                      <Btn onClick={() => onReject(am![1])} style="height:34px;padding:0 12px;border:0;border-radius:999px;background:transparent;color:#6b7686;font-size:14px;cursor:pointer" styleHover="background:#f1f3f6;color:#101418">Skip</Btn>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {typing && (() => {
            const typer = typeof typing === "string" ? byId(typing) : null;
            return (
              <div style={css("display:flex;gap:12px;animation:cFade .2s backwards")}>
                <span style={css("width:30px;flex:none")}>{typer && <span style={css(av(typer, 30))}>{typer.initials}</span>}</span>
                <div style={css("display:flex;flex-direction:column;gap:6px")}>
                  {typer && <div style={css("font-size:13px;font-weight:500;padding-top:5px")}>{typer.name.split(" ")[0]}</div>}
                  <div style={css("display:flex;align-items:center;gap:4px;height:40px;padding:0 16px;border-radius:6px 20px 20px 20px;background:#f1f3f6")}>
                    <span style={css("width:6px;height:6px;border-radius:50%;background:#6b7686;animation:cDot 1s ease-in-out infinite")} />
                    <span style={css("width:6px;height:6px;border-radius:50%;background:#6b7686;animation:cDot 1s .15s ease-in-out infinite")} />
                    <span style={css("width:6px;height:6px;border-radius:50%;background:#6b7686;animation:cDot 1s .3s ease-in-out infinite")} />
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
        </div>

        <div style={css("padding:0 20px 20px;background:#ffffff;flex:none;position:relative;max-width:780px;width:100%;margin:0 auto")}>
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
                {leadsLoaded ? "No leads yet. Scrape some leads first." : "Loading leads…"}
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
          <div className="as-composer" style={css("display:flex;align-items:center;gap:10px;background:#fff;border:1px solid #e3e7ed;border-radius:24px;padding:10px 10px 10px 18px;box-shadow:0 6px 24px -12px rgba(16,20,24,.14);transition:border-color .15s,box-shadow .15s")}>
            <div style={css("flex:1;min-width:0;position:relative;display:flex;align-items:center")}>
              <div ref={backdropRef} aria-hidden style={css("position:absolute;inset:0;display:flex;align-items:center;overflow:hidden;pointer-events:none;font-size:15px;color:#101418")}>
                <span style={css("white-space:pre;line-height:22px")}>{renderComposer(s.chatInput)}</span>
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
                    if (e.key === "Tab") return; // nothing to complete. Let Tab move the focus.
                  }
                  if (e.key !== "Enter") return;
                  sendTeamChat(activeTeam.id, s.chatInput, activeLeadIds());
                }}
                placeholder="Message the team. Use @mention for an agent and /lead to pick leads…"
                style={css("flex:1;min-width:0;border:none;outline:none;font-size:15px;line-height:22px;background:transparent;position:relative;z-index:1;caret-color:#18181B;color:" + (s.chatInput ? "transparent" : "#18181B"))}
              />
            </div>
            <Btn onClick={() => sendTeamChat(activeTeam.id, s.chatInput, activeLeadIds())} aria-label="Send" style={"width:36px;height:36px;flex:none;border:0;border-radius:50%;color:#ffffff;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:background .15s;background:" + (s.chatInput.trim() ? "#006aff" : "#c7ced8")}><i className="icon-arrow-up" style={{ fontSize: 18 }} /></Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ChatsPage() {
  return <ChatsInner />;
}
