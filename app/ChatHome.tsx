"use client";
// Chat-first home: "What should your team work on?". Pick an agent, type a
// request, and it's posted to that agent's team chat as an @mention, the same
// way the /chats composer does it, so the existing orchestration handles it.
// Layout and motion follow the redesign's home screen.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/store";
import { av } from "@/lib/visuals";
import { css, Btn } from "@/components/primitives";
import { listPendingApprovals } from "@/lib/pod/actions";
import type { Agent } from "@/lib/types";

// Starter requests. Each one goes to the first agent that has the capability.
const STARTERS: { icon: string; text: string; cap: string }[] = [
  { icon: "icon-search", text: "Find 25 finance leads in Texas", cap: "scrape" },
  { icon: "icon-pen-line", text: "Draft emails for my ready leads", cap: "outreach" },
  { icon: "icon-list-checks", text: "Score my newest leads", cap: "qualify" },
  { icon: "icon-clock", text: "Book meetings with my hot leads", cap: "book-meeting" },
];

interface Slide { title: string; sub: string; alert?: boolean; teamId?: string; agents: Agent[] }

export default function ChatHome() {
  const { set, agents, teams, sendTeamChat, showError } = useApp();
  const router = useRouter();
  const [text, setText] = useState("");
  const [agentId, setAgentId] = useState<string>("");
  const [menu, setMenu] = useState(false);
  const [needs, setNeeds] = useState<Slide[]>([]);
  const [slide, setSlide] = useState(0);
  const [paused, setPaused] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const agent: Agent | undefined = agents.find((a) => a.id === agentId) ?? agents[0];
  const first = (a: Agent) => a.name.split(" ")[0];

  // Pending approvals across every team become "needs you" slides.
  useEffect(() => {
    let live = true;
    Promise.all(teams.map((t) => listPendingApprovals(t.id).then((rows) => ({ t, rows })).catch(() => ({ t, rows: [] }))))
      .then((res) => {
        if (!live) return;
        setNeeds(res.filter(({ rows }) => rows.length).map(({ t, rows }) => ({
          title: rows.length + (rows.length === 1 ? " approval" : " approvals") + " waiting in " + t.name,
          sub: rows[0].agentName + " is waiting for your yes" + (rows[0].leadCount ? " on " + rows[0].leadCount + " lead" + (rows[0].leadCount === 1 ? "" : "s") : "") + ". Nothing goes out until you approve it.",
          alert: true, teamId: t.id,
          agents: t.members.map((id) => agents.find((a) => a.id === id)).filter(Boolean).slice(0, 3) as Agent[],
        })));
      });
    return () => { live = false; };
  }, [teams, agents]);

  const slides: Slide[] = needs.length ? needs : [
    { title: "Every action shows up as a chat", sub: "Your agents message you here when they need an approval, get a reply, or hit a problem.", agents: agents.slice(0, 3) },
    { title: "Put your team to work", sub: "Pick an agent below, describe what you want in plain English, and press send.", agents: agents.slice(1, 4) },
    { title: "Nothing sends without your yes", sub: "First emails and replies wait for your approval until you decide otherwise.", agents: agents.slice(0, 3).reverse() },
  ];
  useEffect(() => {
    if (paused || slides.length < 2) return;
    const t = window.setInterval(() => setSlide((s) => s + 1), 6000);
    return () => window.clearInterval(t);
  }, [paused, slides.length]);

  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(false); };
    document.addEventListener("click", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("click", away); document.removeEventListener("keydown", esc); };
  }, [menu]);

  const teamFor = (a: Agent) => teams.find((t) => t.members.includes(a.id));
  const send = (body = text) => {
    const msg = body.trim();
    if (!msg || !agent) return;
    // Agents answer in their team's chat, so the agent has to be on a team.
    const team = teamFor(agent);
    if (!team) { showError(first(agent) + " isn’t on a team yet. Add them to one to chat."); set({ showTeamModal: true }); return; }
    set({ convId: team.id });
    sendTeamChat(team.id, "@" + first(agent) + " " + msg);
    setText("");
    router.push("/chats");
  };
  const applyStarter = (st: (typeof STARTERS)[number]) => {
    const a = agents.find((x) => x.capabilities.includes(st.cap));
    if (a) setAgentId(a.id);
    setText(st.text);
    inputRef.current?.focus();
  };

  if (agents.length === 0) {
    return (
      <div style={css("min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:40px 24px;text-align:center;animation:cSwapA .28s ease-out backwards")}>
        <h1 style={css("margin:0;font-family:'General Sans',system-ui,sans-serif;font-size:40px;font-weight:500;letter-spacing:-.035em")}>Hire your first agent</h1>
        <p style={css("margin:0;font-size:16px;color:#4a5565;max-width:440px;line-height:1.55")}>Agents research leads, write first emails and follow up. Nothing goes out until you approve it.</p>
        <Btn onClick={() => router.push("/create")} style="margin-top:8px;height:40px;background:#101418;color:#fff;border:none;border-radius:999px;padding:0 18px;font-size:14px;font-weight:500;cursor:pointer;display:flex;align-items:center;gap:6px" styleHover="background:#2a313b"><i className="icon-plus" style={{ fontSize: 16 }} />Add an agent</Btn>
      </div>
    );
  }

  const sl = slides[slide % slides.length];
  return (
    <main style={css("min-height:100%;display:flex;flex-direction:column;align-items:center;padding:0 20px 28px")}>
      <div style={css("flex:1;min-height:24px;max-height:22vh")} />
      <div style={css("width:100%;max-width:760px;display:flex;flex-direction:column;align-items:center;animation:cSwapA .28s ease-out backwards")}>
        <h1 style={css("margin:0;text-align:center;font-family:'General Sans',system-ui,sans-serif;font-size:clamp(30px,4vw,40px);line-height:1.15;font-weight:500;letter-spacing:-.035em;text-wrap:balance")}>What should your team work on?</h1>

        <div style={css("position:relative;width:100%;margin-top:36px")}>
          <div className="as-composer" style={css("position:relative;z-index:2;display:flex;flex-direction:column;gap:10px;padding:16px 14px 12px 18px;border:1px solid #e3e7ed;border-radius:24px;background:#ffffff;box-shadow:0 6px 24px -12px rgba(16,20,24,.14);transition:border-color .15s,box-shadow .15s")}>
            <textarea
              ref={inputRef}
              aria-label="Message"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={agent ? "What should " + first(agent) + " do?" : "What should your team do?"}
              rows={2}
              style={css("width:100%;min-height:52px;max-height:200px;border:0;outline:none;background:transparent;font-size:16px;line-height:1.55;resize:none;padding:0;color:#101418;font-family:inherit")}
            />
            <div style={css("display:flex;align-items:center;gap:8px")}>
              <div ref={menuRef} style={css("position:relative;flex:none")}>
                <Btn onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu} style="height:36px;padding:0 10px 0 5px;border:1px solid #e3e7ed;border-radius:999px;background:#ffffff;font-size:14px;font-weight:500;display:flex;align-items:center;gap:7px;cursor:pointer;transition:background .12s" styleHover="background:#f6f7f9">
                  {agent && <span style={css(av(agent, 24))}>{agent.initials}</span>}
                  {agent ? first(agent) : "Agent"}
                  <i className="icon-chevron-down" style={{ fontSize: 14, color: "#6b7686" }} />
                </Btn>
                {menu && (
                  <div role="menu" style={css("position:absolute;left:0;top:calc(100% + 8px);z-index:20;width:280px;max-height:340px;overflow-y:auto;padding:6px;background:#ffffff;border:1px solid rgba(16,20,24,.08);border-radius:14px;box-shadow:0 14px 40px rgba(16,20,24,.14);animation:cPop .14s ease-out backwards;transform-origin:0 0")}>
                    <div style={css("padding:6px 10px 8px;font-size:12px;color:#6b7686")}>Ask an agent</div>
                    {agents.map((a) => (
                      <Btn key={a.id} role="menuitemradio" aria-checked={a.id === agent?.id} onClick={() => { setAgentId(a.id); setMenu(false); inputRef.current?.focus(); }} style="width:100%;display:flex;align-items:center;gap:10px;padding:8px 10px;border:0;border-radius:10px;background:transparent;text-align:left;cursor:pointer" styleHover="background:#f3f4f6">
                        <span style={css(av(a, 30))}>{a.initials}</span>
                        <span style={css("flex:1;min-width:0")}><span style={css("display:block;font-size:14px;font-weight:500")}>{a.name}</span><span style={css("display:block;font-size:12px;color:#6b7686;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{a.role}</span></span>
                        {a.id === agent?.id && <i className="icon-check" style={{ fontSize: 16 }} />}
                      </Btn>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ flex: 1 }} />
              <Btn onClick={() => send()} aria-label="Send" disabled={!text.trim()} style={"width:36px;height:36px;flex:none;border:0;border-radius:50%;color:#ffffff;display:flex;align-items:center;justify-content:center;cursor:" + (text.trim() ? "pointer" : "default") + ";transition:background .15s,transform .1s;background:" + (text.trim() ? "#006aff" : "#c7ced8")} styleHover={text.trim() ? "background:#0058d6" : ""}>
                <i className="icon-arrow-up" style={{ fontSize: 18 }} />
              </Btn>
            </div>
          </div>
        </div>

        <div style={css("width:100%;margin-top:18px;display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px")}>
          {STARTERS.map((st, i) => {
            const a = agents.find((x) => x.capabilities.includes(st.cap));
            return (
              <Btn key={st.text} onClick={() => applyStarter(st)} style={{ ...css("min-width:0;min-height:112px;padding:14px 14px 12px;border:1px solid #e3e7ed;border-radius:18px;background:#ffffff;text-align:left;display:flex;flex-direction:column;align-items:flex-start;gap:10px;cursor:pointer;transition:background .15s,border-color .15s,box-shadow .15s,transform .15s;animation:cUp .3s ease-out backwards"), animationDelay: 0.05 + i * 0.04 + "s" }} styleHover="background:#fafbfc;border-color:#d0d6de;box-shadow:0 8px 20px -14px rgba(16,20,24,.25);transform:translateY(-1px)">
                <span style={css("width:30px;height:30px;flex:none;border-radius:9px;background:#f3f4f6;color:#4a5565;display:flex;align-items:center;justify-content:center")}><i className={st.icon} style={{ fontSize: 16 }} /></span>
                <span style={css("flex:1;font-size:14px;font-weight:500;line-height:1.35;color:#1f252d")}>{st.text}</span>
                {a && <span style={css("display:flex;align-items:center;gap:6px;font-size:12px;color:#6b7686")}><span style={css(av(a, 16))}>{a.initials}</span>{first(a)}</span>}
              </Btn>
            );
          })}
        </div>
      </div>

      <div style={css("flex:1;min-height:40px")} />
      <div onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} style={css("width:100%;max-width:760px;display:flex;flex-direction:column;align-items:center;gap:12px")}>
        <div style={css("position:relative;width:100%;height:116px;border-radius:20px;background:#f3f4f6;overflow:hidden")}>
          <button key={slide} type="button" onClick={() => { if (sl.teamId) { set({ convId: sl.teamId }); router.push("/chats"); } else inputRef.current?.focus(); }} style={css("position:absolute;inset:0;width:100%;display:flex;align-items:center;gap:16px;padding:0 0 0 22px;border:0;background:transparent;text-align:left;cursor:pointer;animation:cSwapA .3s ease-out backwards;font-family:inherit;color:#101418")}>
            <span style={css("flex:1;min-width:0")}>
              <span style={css("display:flex;align-items:center;gap:8px;font-size:15px;font-weight:500")}>{sl.alert && <span style={css("width:7px;height:7px;border-radius:50%;background:#b42318")} />}{sl.title}</span>
              <span style={css("display:block;margin-top:3px;font-size:14px;line-height:1.45;color:#4a5565")}>{sl.sub}</span>
            </span>
            <span style={css("width:170px;height:100%;flex:none;position:relative;padding:14px 18px 0 0;display:flex;flex-direction:column;gap:7px")}>
              {sl.agents.map((a, i) => (
                <span key={a.id + i} style={css("display:flex;align-items:center;gap:8px;height:30px;padding:0 9px;border-radius:9px;background:#ffffff;box-shadow:0 2px 8px -4px rgba(16,20,24,.18)")}>
                  <span style={css(av(a, 20))}>{a.initials}</span><span style={css("flex:1;height:5px;border-radius:3px;background:#eceef1")} />
                </span>
              ))}
            </span>
          </button>
        </div>
        {slides.length > 1 && (
          <div role="tablist" aria-label="Tips" style={css("display:flex;gap:6px")}>
            {slides.map((s, i) => {
              const sel = i === slide % slides.length;
              return <button key={i} type="button" role="tab" aria-selected={sel} aria-label={s.title} onClick={() => setSlide(i)} style={{ width: sel ? 18 : 6, height: 6, padding: 0, border: 0, borderRadius: 3, background: sel ? "#101418" : "#d0d6de", cursor: "pointer", transition: "width .2s,background .2s" }} />;
            })}
          </div>
        )}
      </div>
    </main>
  );
}
