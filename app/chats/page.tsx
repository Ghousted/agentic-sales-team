"use client";
import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useApp } from "@/lib/store";
import { av } from "@/lib/visuals";
import { css, Box, Btn } from "@/components/primitives";

const SUGGESTIONS = ["What are you working on?", "Summarize today", "Who should we contact next?", "Show hottest prospects"];

function ChatsInner() {
  const { s, set, agents, teams, byId, sendChat, sendTeamChat } = useApp();
  const router = useRouter();
  const params = useSearchParams();
  const wantAgent = params.get("agent");

  // Open a specific agent's conversation when arriving via ?agent=id.
  useEffect(() => {
    if (!wantAgent || !byId(wantAgent)) return;
    set((prev) => {
      const chats = { ...prev.chats };
      if (!chats[wantAgent]) chats[wantAgent] = [{ who: "ai", text: "Hi! Ask me anything about my work, prospects, or results." }];
      return { chats, convId: wantAgent };
    });
  }, [wantAgent, byId, set]);

  const teamById = (id: string) => teams.find((t) => t.id === id);
  const agentConvIds = Object.keys(s.chats).filter((id) => byId(id));
  const isTeam = (id: string) => !!teamById(id);
  // The stored convId can point at a deleted agent (e.g. the default). Fall back
  // to the first valid conversation so the header and messages stay in sync.
  const activeId = byId(s.convId) || teamById(s.convId) ? s.convId : (teams[0]?.id ?? agentConvIds[0] ?? s.convId);
  useEffect(() => {
    if (!byId(s.convId) && !teamById(s.convId) && agentConvIds[0]) set({ convId: agentConvIds[0] });
  }, [s.convId, agentConvIds, byId, set]);
  const activeTeam = teamById(activeId);
  const activeAgent = byId(activeId) || agents[0];
  const teamMembers = activeTeam ? activeTeam.members.map((id) => byId(id)).filter(Boolean) as typeof agents : [];
  const messages = s.chats[activeId] || [];

  return (
    <div style={css("display:flex;height:100%;animation:fadeUp .3s ease")}>
      {/* conversation list */}
      <div style={css("width:260px;flex:none;border-right:1px solid #ECECF1;background:#fff;display:flex;flex-direction:column")}>
        <div style={css("padding:16px 16px 10px;font-size:14px;font-weight:700")}>Conversations</div>
        <div style={css("display:flex;flex-direction:column;padding:0 8px;gap:2px")}>
          {teams.length > 0 && (<>
            <div style={css("padding:6px 12px;font-size:10.5px;font-weight:700;color:#A1A1AA;text-transform:uppercase;letter-spacing:.05em")}>Teams</div>
            {teams.map((t) => {
              const msgs = s.chats[t.id]; const last = msgs && msgs[msgs.length - 1];
              return (
                <Box key={t.id} onClick={() => set({ convId: t.id })} style={"display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:12px;cursor:pointer;" + (t.id === activeId ? "background:#F1EDFD" : "")} styleHover="background:#F4F4F5">
                  <div style={css("width:32px;height:32px;border-radius:10px;background:" + t.iconBg + ";display:flex;align-items:center;justify-content:center;font-size:16px;flex:none")}>{t.icon}</div>
                  <div style={css("min-width:0")}><div style={css("font-size:12.5px;font-weight:600")}>{t.name}</div><div style={css("font-size:11px;color:#A1A1AA;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{last ? last.text : t.members.length + " agents"}</div></div>
                </Box>
              );
            })}
            <div style={css("padding:6px 12px;font-size:10.5px;font-weight:700;color:#A1A1AA;text-transform:uppercase;letter-spacing:.05em;margin-top:6px")}>Agents</div>
          </>)}
          {agentConvIds.map((id) => {
            const a = byId(id)!;
            const msgs = s.chats[id];
            const last = msgs[msgs.length - 1];
            return (
              <Box key={id} onClick={() => set({ convId: id })} style={"display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:12px;cursor:pointer;transition:background .12s;" + (id === activeId ? "background:#F1EDFD" : "")} styleHover="background:#F4F4F5">
                <div style={css(av(a, 32))}>{a.initials}</div>
                <div style={css("min-width:0")}>
                  <div style={css("font-size:12.5px;font-weight:600")}>{a.name}</div>
                  <div style={css("font-size:11px;color:#A1A1AA;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{last ? last.text : ""}</div>
                </div>
              </Box>
            );
          })}
        </div>
      </div>

      {/* chat area */}
      <div style={css("flex:1;min-width:0;display:flex;flex-direction:column;background:#FAFAFB")}>
        <div style={css("display:flex;align-items:center;gap:11px;padding:13px 20px;background:#fff;border-bottom:1px solid #ECECF1;flex:none")}>
          {activeTeam ? (<>
            <div style={css("width:34px;height:34px;border-radius:11px;background:" + activeTeam.iconBg + ";display:flex;align-items:center;justify-content:center;font-size:17px;flex:none")}>{activeTeam.icon}</div>
            <div><div style={css("font-size:13.5px;font-weight:700")}>{activeTeam.name}</div><div style={css("font-size:11px;color:#71717A")}>{teamMembers.map((a) => a!.name.split(" ")[0]).join(", ")}</div></div>
            <div style={css("margin-left:auto;display:flex")}>{teamMembers.slice(0, 5).map((a, i) => <div key={a!.id} style={css(av(a!, 26) + ";border:2px solid #fff;margin-left:" + (i ? "-8" : "0") + "px")}>{a!.initials}</div>)}</div>
          </>) : (<>
            <div style={css(av(activeAgent, 34))}>{activeAgent.initials}</div>
            <div><div style={css("font-size:13.5px;font-weight:700")}>{activeAgent.name}</div><div style={css("font-size:11px;color:#2FA45C;display:flex;align-items:center;gap:5px")}><span style={css("width:6px;height:6px;border-radius:50%;background:#2FA45C")} />{activeAgent.role} · online</div></div>
            <Btn onClick={() => router.push("/agents/" + activeAgent.id)} style="margin-left:auto;background:#F1EDFD;color:#5122C1;border:none;border-radius:99px;padding:6px 14px;font-size:11.5px;font-weight:600;cursor:pointer" styleHover="background:#E3DBF9">View profile</Btn>
          </>)}
        </div>

        <div style={css("flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:12px")}>
          {messages.map((m, i) => {
            const mine = m.who === "me";
            const speaker = !mine && activeTeam ? byId(m.who) : null;
            return (
              <div key={i} style={css("display:flex;gap:8px;justify-content:" + (mine ? "flex-end" : "flex-start"))}>
                {speaker && <div style={css(av(speaker, 26) + ";flex:none;margin-top:2px")}>{speaker.initials}</div>}
                <div style={css("display:flex;flex-direction:column;max-width:62%;gap:2px")}>
                  {speaker && <div style={css("font-size:10.5px;font-weight:600;color:#71717A;padding-left:4px")}>{speaker.name.split(" ")[0]}</div>}
                  <div style={css((mine ? "background:#5122C1;color:#fff;border-radius:16px 16px 4px 16px;" : "background:#fff;color:#3F3F46;border:1px solid #ECECF1;border-radius:16px 16px 16px 4px;") + "padding:11px 15px;font-size:13px;line-height:1.55;animation:fadeUp .25s ease")}>{m.text}</div>
                </div>
              </div>
            );
          })}
          {s.chatTyping && (
            <div style={css("display:flex;justify-content:flex-start")}>
              <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px 16px 16px 4px;padding:12px 16px;display:flex;gap:4px")}>
                <span style={css("width:6px;height:6px;border-radius:50%;background:#A1A1AA;animation:typing 1.2s infinite")} />
                <span style={css("width:6px;height:6px;border-radius:50%;background:#A1A1AA;animation:typing 1.2s infinite .15s")} />
                <span style={css("width:6px;height:6px;border-radius:50%;background:#A1A1AA;animation:typing 1.2s infinite .3s")} />
              </div>
            </div>
          )}
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
          {!activeTeam && (
            <div style={css("display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap")}>
              {SUGGESTIONS.map((q) => <Box key={q} onClick={() => sendChat(q)} style="font-size:11.5px;color:#5122C1;background:#F1EDFD;border-radius:99px;padding:5px 13px;cursor:pointer;font-weight:600" styleHover="background:#E3DBF9">{q}</Box>)}
            </div>
          )}
          <div style={css("display:flex;gap:10px;background:#fff;border:1px solid #ECECF1;border-radius:99px;padding:6px 6px 6px 18px;box-shadow:0 1px 3px rgba(24,24,27,.05)")}>
            <input
              aria-label="Message"
              value={s.chatInput}
              onChange={(e) => set({ chatInput: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") { activeTeam ? sendTeamChat(activeTeam.id, s.chatInput) : sendChat(s.chatInput); } }}
              placeholder={activeTeam ? "Message the team — @mention an agent…" : "Message " + activeAgent.name.split(" ")[0] + "…"}
              style={css("flex:1;border:none;outline:none;font-size:13px;background:transparent;color:#18181B")}
            />
            <Btn onClick={() => { activeTeam ? sendTeamChat(activeTeam.id, s.chatInput) : sendChat(s.chatInput); }} style="background:#5122C1;color:#fff;border:none;border-radius:99px;padding:8px 18px;font-size:12.5px;font-weight:600;cursor:pointer" styleHover="background:#42199E">Send ↑</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ChatsPage() {
  return (
    <Suspense fallback={null}>
      <ChatsInner />
    </Suspense>
  );
}
