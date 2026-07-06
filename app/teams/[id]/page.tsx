"use client";
import { useParams, useRouter } from "next/navigation";
import { useApp } from "@/lib/store";
import { statusMeta } from "@/lib/data";
import { av, chip } from "@/lib/visuals";
import { css, Box, Btn } from "@/components/primitives";

const days = ["M", "T", "W", "T", "F", "S", "S"];
const teamWeek = [55, 70, 62, 85, 74, 30, 12];

export default function TeamDetail() {
  const { teams, byId, showToast } = useApp();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const team = teams.find((t) => t.id === params.id) || teams[0];
  if (!team) return null;

  const members = team.members.map((id) => byId(id)).filter(Boolean);

  return (
    <div style={css("padding:24px 26px;display:flex;flex-direction:column;gap:18px;animation:fadeUp .3s ease")}>
      <Box onClick={() => router.push("/")} style="font-size:12px;color:#71717A;cursor:pointer" styleHover="color:#5122C1">← All teams</Box>

      <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:20px;padding:22px 24px;display:flex;align-items:center;gap:16px")}>
        <div style={css("width:52px;height:52px;border-radius:14px;background:" + team.iconBg + ";display:flex;align-items:center;justify-content:center;font-size:24px;flex:none")}>{team.icon}</div>
        <div><div style={css("font-size:19px;font-weight:700")}>{team.name}</div><div style={css("font-size:13px;color:#71717A;margin-top:2px")}>{team.desc}</div></div>
        <Btn onClick={() => showToast("Select agents to add to " + team.name)} style="margin-left:auto;background:#5122C1;color:#fff;border:none;border-radius:99px;padding:8px 18px;font-size:12.5px;font-weight:600;cursor:pointer" styleHover="background:#42199E">+ Add agents</Btn>
      </div>

      <div style={css("display:grid;grid-template-columns:1fr 300px;gap:14px;align-items:start")}>
        <div style={css("display:flex;flex-direction:column;gap:14px")}>
          <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:16px 18px")}>
            <div style={css("font-size:13.5px;font-weight:700;margin-bottom:12px")}>Members</div>
            <div style={css("display:flex;flex-direction:column;gap:6px")}>
              {members.map((a) => {
                const m = statusMeta(a!.status);
                return (
                  <Box key={a!.id} onClick={() => router.push("/agents/" + a!.id)} style="display:flex;align-items:center;gap:12px;padding:9px 10px;border-radius:12px;cursor:pointer" styleHover="background:#FAFAFB">
                    <div style={css(av(a!, 34))}>{a!.initials}</div>
                    <div><div style={css("font-size:13px;font-weight:600")}>{a!.name}</div><div style={css("font-size:11.5px;color:#71717A")}>{a!.role}</div></div>
                    <span style={css("display:inline-flex;align-items:center;gap:5px;margin-left:10px;" + chip(m.bg, m.color))}><span style={css("width:6px;height:6px;border-radius:50%;background:" + m.dot)} />{m.label}</span>
                    <div style={css("margin-left:auto;font-size:12px;font-weight:700;color:#5122C1")}>{a!.score}</div>
                  </Box>
                );
              })}
            </div>
          </div>
          <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:16px 18px")}>
            <div style={css("font-size:13.5px;font-weight:700;margin-bottom:12px")}>Team performance</div>
            <div style={css("display:flex;align-items:flex-end;gap:8px;height:100px")}>
              {teamWeek.map((v, i) => (
                <div key={i} style={css("flex:1;display:flex;flex-direction:column;align-items:center;gap:5px;height:100%;justify-content:flex-end")}>
                  <div style={css("width:100%;max-width:30px;background:linear-gradient(180deg,#F9A8D4,#F43F7E);border-radius:6px 6px 3px 3px;height:" + v + "%")} />
                  <div style={css("font-size:10px;color:#A1A1AA")}>{days[i]}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div style={css("display:flex;flex-direction:column;gap:14px")}>
          <div style={css("background:linear-gradient(135deg,#F3EFFE,#FDEEF6);border-radius:16px;padding:16px 18px")}>
            <div style={css("font-size:12.5px;font-weight:700;color:#3B0FA8")}>Shared goal</div>
            <div style={css("font-size:12.5px;color:#6D28D9;margin-top:5px;line-height:1.55")}>{team.goal}</div>
          </div>
          <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:16px 18px")}>
            <div style={css("font-size:13.5px;font-weight:700;margin-bottom:10px")}>Recent activity</div>
            <div style={css("display:flex;flex-direction:column;gap:9px")}>
              {team.activity.map((tac) => <div key={tac} style={css("font-size:12px;color:#3F3F46;display:flex;gap:8px")}><span style={css("color:#5122C1")}>•</span>{tac}</div>)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
