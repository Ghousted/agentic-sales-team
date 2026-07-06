"use client";
import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useApp } from "@/lib/store";
import { av } from "@/lib/visuals";
import { css, Box, Btn } from "@/components/primitives";

const SUGGESTIONS = ["What are you working on?", "Summarize today", "Who should we contact next?", "Show hottest prospects"];

function ChatsInner() {
  const { s, set, agents, byId, sendChat } = useApp();
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

  const conv = byId(s.convId) || agents[0];
  const convIds = Object.keys(s.chats).filter((id) => byId(id));
  const messages = s.chats[s.convId] || [];

  return (
    <div style={css("display:flex;height:100%;animation:fadeUp .3s ease")}>
      {/* conversation list */}
      <div style={css("width:260px;flex:none;border-right:1px solid #ECECF1;background:#fff;display:flex;flex-direction:column")}>
        <div style={css("padding:16px 16px 10px;font-size:14px;font-weight:700")}>Conversations</div>
        <div style={css("display:flex;flex-direction:column;padding:0 8px;gap:2px")}>
          {convIds.map((id) => {
            const a = byId(id)!;
            const msgs = s.chats[id];
            const last = msgs[msgs.length - 1];
            return (
              <Box key={id} onClick={() => set({ convId: id })} style={"display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:12px;cursor:pointer;transition:background .12s;" + (id === s.convId ? "background:#F1EDFD" : "")} styleHover="background:#F4F4F5">
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
          <div style={css(av(conv, 34))}>{conv.initials}</div>
          <div>
            <div style={css("font-size:13.5px;font-weight:700")}>{conv.name}</div>
            <div style={css("font-size:11px;color:#2FA45C;display:flex;align-items:center;gap:5px")}><span style={css("width:6px;height:6px;border-radius:50%;background:#2FA45C")} />{conv.role} · online</div>
          </div>
          <Btn onClick={() => router.push("/agents/" + conv.id)} style="margin-left:auto;background:#F1EDFD;color:#5122C1;border:none;border-radius:99px;padding:6px 14px;font-size:11.5px;font-weight:600;cursor:pointer" styleHover="background:#E3DBF9">View profile</Btn>
        </div>

        <div style={css("flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:12px")}>
          {messages.map((m, i) => (
            <div key={i} style={css("display:flex;justify-content:" + (m.who === "me" ? "flex-end" : "flex-start"))}>
              <div style={css((m.who === "me" ? "background:#5122C1;color:#fff;border-radius:16px 16px 4px 16px;" : "background:#fff;color:#3F3F46;border:1px solid #ECECF1;border-radius:16px 16px 16px 4px;") + "padding:11px 15px;font-size:13px;line-height:1.55;max-width:62%;animation:fadeUp .25s ease")}>{m.text}</div>
            </div>
          ))}
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

        <div style={css("padding:14px 20px;background:#FAFAFB;flex:none")}>
          <div style={css("display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap")}>
            {SUGGESTIONS.map((q) => (
              <Box key={q} onClick={() => sendChat(q)} style="font-size:11.5px;color:#5122C1;background:#F1EDFD;border-radius:99px;padding:5px 13px;cursor:pointer;font-weight:600" styleHover="background:#E3DBF9">{q}</Box>
            ))}
          </div>
          <div style={css("display:flex;gap:10px;background:#fff;border:1px solid #ECECF1;border-radius:99px;padding:6px 6px 6px 18px;box-shadow:0 1px 3px rgba(24,24,27,.05)")}>
            <input
              aria-label={"Message " + conv.name.split(" ")[0]}
              value={s.chatInput}
              onChange={(e) => set({ chatInput: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") sendChat(s.chatInput); }}
              placeholder={"Message " + conv.name.split(" ")[0] + "…"}
              style={css("flex:1;border:none;outline:none;font-size:13px;background:transparent;color:#18181B")}
            />
            <Btn onClick={() => sendChat(s.chatInput)} style="background:#5122C1;color:#fff;border:none;border-radius:99px;padding:8px 18px;font-size:12.5px;font-weight:600;cursor:pointer" styleHover="background:#42199E">Send ↑</Btn>
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
