"use client";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/store";
import { statusMeta } from "@/lib/data";
import { av, statusPill } from "@/lib/visuals";
import { css, Box, Btn } from "@/components/primitives";

export default function AgentsPage() {
  const { s, agents } = useApp();
  const router = useRouter();
  const activeCount = agents.filter((a) => a.status === "working").length;

  return (
    <div style={css("padding:24px 26px;display:flex;flex-direction:column;gap:18px;animation:fadeUp .3s ease")}>
      <div style={css("display:flex;align-items:baseline;gap:12px")}>
        <div style={css("font-size:13px;color:#71717A")}>
          {agents.length} AI employees · {activeCount} working now
        </div>
      </div>
      <div style={css("display:grid;grid-template-columns:repeat(3,1fr);gap:14px")}>
        {agents.map((a) => {
          const m = statusMeta(s.paused[a.id] ? "waiting" : a.status);
          const pct = a.score;
          return (
            <Box
              key={a.id}
              noButton
              onClick={() => router.push("/agents/" + a.id)}
              style="background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:18px;box-shadow:0 1px 3px rgba(24,24,27,.04);transition:transform .15s,box-shadow .15s;cursor:pointer"
              styleHover="transform:translateY(-3px);box-shadow:0 10px 24px rgba(24,24,27,.08)"
            >
              <div style={css("display:flex;align-items:center;gap:12px")}>
                <div style={css(av(a, 42))}>{a.initials}</div>
                <div style={css("min-width:0")}>
                  <div style={css("font-size:14px;font-weight:700")}>{a.name}</div>
                  <div style={css("font-size:12px;color:#71717A")}>{a.role}</div>
                </div>
                <span style={css(statusPill(statusMeta(a.status)))}>
                  <span style={css("width:6px;height:6px;border-radius:50%;background:" + m.dot)} />
                  {m.label}
                </span>
              </div>
              <div style={css("margin-top:14px;background:#FAFAFB;border:1px solid #F0F0F3;border-radius:10px;padding:9px 12px;font-size:12px;color:#52525B;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>
                {a.task}
              </div>
              <div style={css("display:flex;align-items:center;gap:12px;margin-top:14px")}>
                <div style={css("width:40px;height:40px;border-radius:50%;background:conic-gradient(" + a.color + " 0 " + pct + "%,#F0F0F3 " + pct + "% 100%);display:flex;align-items:center;justify-content:center;flex:none")}>
                  <div style={css("width:32px;height:32px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#18181B")}>{a.score}</div>
                </div>
                <div style={css("font-size:11px;color:#A1A1AA")}>Performance<br />score</div>
                <div style={css("margin-left:auto;display:flex;gap:6px")}>
                  <Btn
                    onClick={(e) => { e.stopPropagation(); router.push("/chats?agent=" + a.id); }}
                    style="background:#F1EDFD;color:#5122C1;border:none;border-radius:99px;padding:6px 13px;font-size:11.5px;font-weight:600;cursor:pointer"
                    styleHover="background:#E3DBF9"
                  >
                    Chat
                  </Btn>
                  <Btn
                    onClick={(e) => { e.stopPropagation(); router.push("/agents/" + a.id); }}
                    style="background:#18181B;color:#fff;border:none;border-radius:99px;padding:6px 13px;font-size:11.5px;font-weight:600;cursor:pointer"
                    styleHover="background:#3F3F46"
                  >
                    Open
                  </Btn>
                </div>
              </div>
            </Box>
          );
        })}
      </div>
    </div>
  );
}
