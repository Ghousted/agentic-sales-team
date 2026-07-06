"use client";
import { usePathname, useRouter } from "next/navigation";
import { useApp } from "@/lib/store";
import { navIcon } from "@/lib/visuals";
import { css, Box, Btn } from "./primitives";

const NAV: { href: string; icon: string; label: string }[] = [
  { href: "/", icon: "home", label: "Dashboard" },
  { href: "/agents", icon: "robot", label: "Agents" },
  { href: "/chats", icon: "chat", label: "Chats" },
  { href: "/analytics", icon: "bars", label: "Analytics" },
];

function isActive(href: string, path: string): boolean {
  if (href === "/") return path === "/" || path.startsWith("/teams");
  if (href === "/agents") return path.startsWith("/agents") || path === "/create";
  return path.startsWith(href);
}

function headerTitle(path: string): string {
  if (path === "/") return "Dashboard";
  if (path.startsWith("/teams")) return "Team details";
  if (path.startsWith("/agents/")) return "Agent details";
  if (path === "/agents") return "Agents";
  if (path === "/create") return "Add new agent";
  if (path.startsWith("/chats")) return "Chats";
  if (path.startsWith("/analytics")) return "Analytics";
  if (path.startsWith("/settings")) return "Settings";
  return "Dashboard";
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const { s, set, logout, showToast } = useApp();
  const router = useRouter();
  const path = usePathname();
  const sbOpen = s.sidebarOpen;

  const userName = s.userName;
  const userInitials = userName.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const userEmail = s.userEmail || userName.toLowerCase().split(" ").join(".") + "@spark.so";

  return (
    <div style={css("display:flex;height:100vh;overflow:hidden")}>
      {/* ================= SIDEBAR ================= */}
      <div style={css("width:" + (sbOpen ? 240 : 70) + "px;flex:none;border-right:1px solid #ECECF1;display:flex;flex-direction:column;padding:16px " + (sbOpen ? 12 : 10) + "px;gap:3px;background:#FFFFFF;transition:width .25s ease;overflow:hidden")}>
        <div style={css("display:flex;align-items:flex-start;padding:8px 4px 2px 8px;margin-bottom:16px")}>
          <div style={css("font-family:'JetBrains Mono',ui-monospace,monospace;font-size:24px;font-weight:700;letter-spacing:-.02em;line-height:1.15;color:#18181B;" + (sbOpen ? "" : "display:none"))}>
            <span style={{ color: "#5122C1" }}>agent</span>ic<br />salesforce
          </div>
          <Box
            onClick={() => set((p) => ({ sidebarOpen: !p.sidebarOpen }))}
            aria-label={sbOpen ? "Collapse sidebar" : "Expand sidebar"}
            style={(sbOpen ? "margin-left:auto;" : "margin:0 auto;") + "width:30px;height:30px;border-radius:8px;cursor:pointer;flex:none;margin-top:2px;" + navIcon("panel", "#667085")}
            styleHover="background:#F4F4F5"
          />
        </div>

        {NAV.map((nv) => {
          const active = isActive(nv.href, path);
          return (
            <Box
              key={nv.href}
              onClick={() => router.push(nv.href)}
              aria-label={nv.label}
              style={"display:flex;align-items:center;gap:14px;height:46px;padding:0 " + (sbOpen ? "14px" : "0") + ";border-radius:12px;font-size:16px;cursor:pointer;transition:background .12s;" + (sbOpen ? "" : "justify-content:center;") + (active ? "background:#EEE9F8;color:#5122C1;font-weight:700" : "color:#475467;font-weight:600")}
              styleHover="background:#F4F4F5"
            >
              <span style={css(navIcon(nv.icon, active ? "#5122C1" : "#475467"))} />
              <span style={css(sbOpen ? "white-space:nowrap" : "display:none")}>{nv.label}</span>
            </Box>
          );
        })}

        <Box
          onClick={async () => { await logout(); router.replace("/"); router.refresh(); }}
          aria-label="Log out"
          style={"margin-top:auto;display:flex;align-items:center;gap:14px;height:46px;padding:0 " + (sbOpen ? "14px" : "0") + ";border-radius:12px;font-size:16px;color:#475467;font-weight:600;cursor:pointer;" + (sbOpen ? "" : "justify-content:center")}
          styleHover="background:#F4F4F5"
        >
          <span style={css(navIcon("logout", "#475467"))} />
          <span style={css(sbOpen ? "min-width:0" : "display:none")}>Log Out</span>
        </Box>

        <Box onClick={() => router.push("/settings")} aria-label="Open settings" style="display:flex;align-items:center;gap:10px;padding:10px 6px;border-top:1px solid #ECECF1;margin-top:10px;border-radius:10px;cursor:pointer" styleHover="background:#F4F4F5">
          <div style={css("width:28px;height:28px;border-radius:50%;background:#FDE68A;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#92400E;flex:none")}>{userInitials}</div>
          <div style={css(sbOpen ? "min-width:0" : "display:none")}>
            <div style={css("font-size:15px;font-weight:700;color:#18181B;white-space:nowrap")}>{userName}</div>
            <div style={css("font-size:12.5px;color:rgba(0,0,0,.45);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px")}>{userEmail}</div>
          </div>
        </Box>
      </div>

      {/* ================= MAIN ================= */}
      <div style={css("flex:1;min-width:0;display:flex;flex-direction:column;background:#FAFAFB")}>
        <div style={css("display:flex;align-items:center;gap:16px;padding:0 26px;height:80px;background:#fff;border-bottom:1px solid #E9EAEB;flex:none")}>
          <div style={css("font-size:24px;font-weight:600;letter-spacing:-.01em;white-space:nowrap")}>{headerTitle(path)}</div>
          <div style={css("margin-left:auto;width:380px;height:45px;display:flex;align-items:center;gap:8px;background:#F4F4F5;border-radius:99px;padding:0 18px;min-width:0")}>
            <span aria-hidden="true" style={{ fontSize: "16px", color: "#A1A1AA" }}>⌕</span>
            <input
              aria-label="Search agents, leads, and conversations"
              value={s.search}
              onChange={(e) => set({ search: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const q = s.search.trim();
                  if (q) showToast("Searching “" + q + "”");
                }
              }}
              placeholder="Search agents, leads, conversations…"
              style={css("flex:1;border:none;outline:none;background:transparent;font-size:13px;color:#18181B;min-width:0")}
            />
          </div>
          <div style={css("display:flex;align-items:center;gap:14px;flex:none")}>
            <Box
              onClick={() => showToast("You have 3 new notifications")}
              aria-label="Notifications"
              style="position:relative;width:48px;height:48px;border-radius:50%;background:#EEE9F8;display:flex;align-items:center;justify-content:center;font-size:18px;color:#5122C1;cursor:pointer;flex:none"
            >
              ◔
              <span style={css("position:absolute;top:7px;right:9px;width:9px;height:9px;border-radius:50%;background:#F43F7E;border:2px solid #EEE9F8")} />
            </Box>
            <Btn
              onClick={() => router.push("/create")}
              style="height:48px;background:#5122C1;color:#fff;border:none;border-radius:100px;padding:0 24px;font-size:14px;font-weight:600;box-shadow:0 2px 8px rgba(81,34,193,.3);cursor:pointer;display:flex;align-items:center;gap:8px"
              styleHover="background:#42199E"
            >
              <span style={{ fontSize: "18px", lineHeight: 1, fontWeight: 400 }}>+</span>Add new agent
            </Btn>
          </div>
        </div>

        <div id="mainScroll" style={css("flex:1;overflow-y:auto")}>
          {children}
        </div>
      </div>
    </div>
  );
}
