"use client";
// Chat-first home: "What should your team work on?". Pick an agent, type a
// request, and it's posted to that agent's team chat as an @mention, the same
// way the /chats composer does it, so the existing orchestration handles it.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/store";
import { av } from "@/lib/visuals";
import { css, Box, Btn } from "@/components/primitives";
import { listPendingApprovals } from "@/lib/pod/actions";
import type { Agent } from "@/lib/types";

// Starter requests. Each one goes to the first agent that has the capability.
const STARTERS: { icon: string; text: string; cap: string }[] = [
  { icon: "⌕", text: "Find 25 finance leads in Texas", cap: "scrape" },
  { icon: "✎", text: "Draft emails for my ready leads", cap: "outreach" },
  { icon: "☷", text: "Score my newest leads", cap: "qualify" },
  { icon: "▦", text: "Book meetings with my hot leads", cap: "book-meeting" },
];

interface NeedsYou { teamId: string; teamName: string; text: string }

export default function ChatHome() {
  const { s, set, agents, teams, sendTeamChat } = useApp();
  const router = useRouter();
  const [text, setText] = useState("");
  const [agentId, setAgentId] = useState<string>("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [needs, setNeeds] = useState<NeedsYou[]>([]);
  const pickerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const agent: Agent | undefined = agents.find((a) => a.id === agentId) ?? agents[0];
  const first = (a: Agent) => a.name.split(" ")[0];

  // Pending approvals across every team, shown as "needs you" cards.
  useEffect(() => {
    let live = true;
    Promise.all(teams.map((t) => listPendingApprovals(t.id).then((rows) => ({ t, rows })).catch(() => ({ t, rows: [] }))))
      .then((res) => {
        if (!live) return;
        setNeeds(res.flatMap(({ t, rows }) => rows.slice(0, 2).map((r) => ({
          teamId: t.id, teamName: t.name,
          text: r.agentName + " is waiting for your approval" + (r.leadCount ? " on " + r.leadCount + " lead" + (r.leadCount === 1 ? "" : "s") : ""),
        }))).slice(0, 3));
      });
    return () => { live = false; };
  }, [teams]);

  useEffect(() => {
    if (!pickerOpen) return;
    const away = (e: MouseEvent) => { if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false); };
    document.addEventListener("click", away);
    return () => document.removeEventListener("click", away);
  }, [pickerOpen]);

  const teamFor = (a: Agent) => teams.find((t) => t.members.includes(a.id)) ?? teams[0];

  const send = () => {
    const body = text.trim();
    if (!body || !agent) return;
    const team = teamFor(agent);
    if (!team) { set({ showTeamModal: true }); return; }
    set({ convId: team.id });
    sendTeamChat(team.id, "@" + first(agent) + " " + body);
    setText("");
    router.push("/chats");
  };

  const pickStarter = (st: (typeof STARTERS)[number]) => {
    const a = agents.find((x) => x.capabilities.includes(st.cap));
    if (a) setAgentId(a.id);
    setText(st.text);
    inputRef.current?.focus();
  };

  if (agents.length === 0) {
    return (
      <div style={css("min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:40px 24px;text-align:center")}>
        <div style={css("font-family:'General Sans',Inter,sans-serif;font-size:40px;font-weight:600;letter-spacing:-.03em;color:#101828")}>Hire your first agent</div>
        <div style={css("font-size:15px;color:#667085;max-width:420px;line-height:1.55")}>Agents research leads, write first emails and follow up. Nothing goes out until you approve it.</div>
        <Btn onClick={() => router.push("/create")} style="margin-top:8px;background:#2563EB;color:#fff;border:none;border-radius:99px;padding:12px 22px;font-size:14px;font-weight:600;cursor:pointer" styleHover="background:#1D4ED8">+ Add an agent</Btn>
      </div>
    );
  }

  return (
    <div style={css("min-height:100%;display:flex;flex-direction:column;align-items:center;padding:9vh 24px 48px;animation:fadeUp .3s ease")}>
      <div style={css("width:100%;max-width:740px;display:flex;flex-direction:column;gap:18px")}>
        <h1 style={css("margin:0 0 10px;text-align:center;font-family:'General Sans',Inter,sans-serif;font-size:clamp(30px,4.4vw,46px);font-weight:600;letter-spacing:-.035em;color:#101828")}>What should your team work on?</h1>

        {/* composer */}
        <div style={css("background:#fff;border:1px solid #E4E7EC;border-radius:22px;box-shadow:0 10px 30px rgba(16,24,40,.07);padding:16px 16px 12px")}>
          <textarea
            ref={inputRef}
            aria-label="Message your team"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={agent ? "What should " + first(agent) + " do?" : "What should your team do?"}
            rows={2}
            style={css("width:100%;border:none;outline:none;resize:none;font-size:16px;line-height:1.5;color:#101828;background:transparent;padding:2px 4px")}
          />
          <div style={css("display:flex;align-items:center;gap:8px;margin-top:6px")}>
            <div ref={pickerRef} style={css("position:relative")}>
              <Box
                onClick={() => setPickerOpen((o) => !o)}
                aria-label="Choose an agent"
                aria-expanded={pickerOpen}
                style="display:flex;align-items:center;gap:8px;height:36px;padding:0 12px 0 5px;border:1px solid #E4E7EC;border-radius:99px;cursor:pointer;font-size:13.5px;font-weight:600;color:#344054"
                styleHover="background:#F9FAFB"
              >
                {agent && <span style={css(av(agent, 26))}>{agent.initials}</span>}
                {agent ? first(agent) : "Agent"}
                <span aria-hidden="true" style={css("font-size:10px;color:#98A2B3")}>▾</span>
              </Box>
              {pickerOpen && (
                <div style={css("position:absolute;top:44px;left:0;width:280px;max-height:320px;overflow-y:auto;background:#fff;border:1px solid #E4E7EC;border-radius:14px;box-shadow:0 14px 34px rgba(16,24,40,.14);padding:6px;z-index:20")}>
                  {agents.map((a) => (
                    <Box key={a.id} onClick={() => { setAgentId(a.id); setPickerOpen(false); inputRef.current?.focus(); }} style={"display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;cursor:pointer;" + (a.id === agent?.id ? "background:#EEF4FF" : "")} styleHover="background:#F5F8FF">
                      <span style={css(av(a, 30))}>{a.initials}</span>
                      <span style={css("min-width:0")}>
                        <span style={css("display:block;font-size:13.5px;font-weight:600;color:#101828")}>{a.name}</span>
                        <span style={css("display:block;font-size:12px;color:#667085;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{a.role}</span>
                      </span>
                    </Box>
                  ))}
                </div>
              )}
            </div>
            <Btn
              onClick={send}
              aria-label="Send"
              disabled={!text.trim()}
              style={"margin-left:auto;width:38px;height:38px;border-radius:50%;border:none;display:flex;align-items:center;justify-content:center;font-size:17px;cursor:pointer;color:#fff;background:" + (text.trim() ? "#2563EB" : "#D0D5DD")}
              styleHover={text.trim() ? "background:#1D4ED8" : ""}
            >↑</Btn>
          </div>
        </div>

        {/* starters */}
        <div style={css("display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px")}>
          {STARTERS.map((st) => {
            const a = agents.find((x) => x.capabilities.includes(st.cap));
            return (
              <Box key={st.text} onClick={() => pickStarter(st)} style="display:flex;flex-direction:column;gap:10px;padding:14px;border:1px solid #E4E7EC;border-radius:16px;background:#fff;cursor:pointer;transition:border-color .12s,box-shadow .12s" styleHover="border-color:#BCD3FB;box-shadow:0 6px 18px rgba(37,99,235,.08)">
                <span aria-hidden="true" style={css("width:30px;height:30px;border-radius:9px;border:1px solid #E4E7EC;display:flex;align-items:center;justify-content:center;font-size:14px;color:#475467")}>{st.icon}</span>
                <span style={css("font-size:14px;font-weight:600;color:#101828;line-height:1.35")}>{st.text}</span>
                {a && <span style={css("display:flex;align-items:center;gap:6px;font-size:12px;color:#667085")}><span style={css(av(a, 18))}>{a.initials}</span>{first(a)}</span>}
              </Box>
            );
          })}
        </div>

        {/* needs you */}
        {needs.length > 0 && (
          <div style={css("margin-top:14px;display:flex;flex-direction:column;gap:8px")}>
            <div style={css("font-size:12.5px;font-weight:600;color:#667085;padding-left:2px")}>Needs you</div>
            {needs.map((n, i) => (
              <Box key={i} onClick={() => { set({ convId: n.teamId }); router.push("/chats"); }} style="display:flex;align-items:center;gap:10px;padding:14px 16px;border-radius:16px;background:#F5F8FF;border:1px solid #DCE7FF;cursor:pointer" styleHover="background:#EEF4FF">
                <span style={css("width:8px;height:8px;border-radius:50%;background:#2563EB;flex:none")} />
                <span style={css("font-size:14px;font-weight:600;color:#101828")}>{n.text}</span>
                <span style={css("margin-left:auto;font-size:12.5px;color:#667085;white-space:nowrap")}>{n.teamName} →</span>
              </Box>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
