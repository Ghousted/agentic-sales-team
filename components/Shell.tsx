"use client";
import { usePathname, useRouter } from "next/navigation";
import { useApp } from "@/lib/store";
import { navIcon } from "@/lib/visuals";
import { css, Box, Btn } from "./primitives";
import GlobalSearch from "./GlobalSearch";
import NotificationsBell from "./NotificationsBell";
import InboxBell from "./InboxBell";

// Pages listed under "New chat" in the sidebar. Agents and team pages have no
// entry of their own; they're reached from the dashboard and the chat picker.
const NAV: { href: string; icon: string; label: string }[] = [
  { href: "/dashboard", icon: "grid", label: "Dashboard" },
  { href: "/leads", icon: "leads", label: "Leads" },
  { href: "/products", icon: "box", label: "Products" },
  { href: "/calendar", icon: "calendar", label: "Calendar" },
];

function isActive(href: string, path: string): boolean {
  if (href === "/dashboard") return path === "/dashboard" || path.startsWith("/teams") || path.startsWith("/agents");
  return path.startsWith(href);
}

function headerTitle(path: string): string {
  if (path === "/") return "";
  if (path === "/dashboard") return "Dashboard";
  if (path.startsWith("/teams")) return "Team details";
  if (path.startsWith("/agents/")) return "Agent details";
  if (path === "/agents") return "Agents";
  if (path === "/create") return "Add new agent";
  if (path.startsWith("/chats")) return "Chat";
  if (path.startsWith("/calendar")) return "Calendar";
  if (path.startsWith("/settings")) return "Settings";
  if (path.startsWith("/leads")) return "Leads";
  if (path.startsWith("/products")) return "Products";
  return "";
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const { s, set, teams, logout } = useApp();
  const router = useRouter();
  const path = usePathname();
  const sbOpen = s.sidebarOpen;

  const userName = s.userName;
  const userInitials = userName.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const userEmail = s.userEmail || userName.toLowerCase().split(" ").join(".") + "@spark.so";
  const wsInitial = (s.workspaceName.trim()[0] || "W").toUpperCase();
  const title = headerTitle(path);

  const row = (active: boolean) =>
    "display:flex;align-items:center;gap:12px;height:40px;padding:0 " + (sbOpen ? "10px" : "0") + ";border-radius:10px;font-size:14.5px;cursor:pointer;transition:background .12s;" +
    (sbOpen ? "" : "justify-content:center;") + (active ? "background:#E8F0FE;color:#1D4ED8;font-weight:600" : "color:#344054;font-weight:500");

  return (
    <div style={css("display:flex;height:100vh;overflow:hidden")}>
      {/* ================= SIDEBAR ================= */}
      <div style={css("width:" + (sbOpen ? 260 : 68) + "px;flex:none;border-right:1px solid #ECECF1;display:flex;flex-direction:column;padding:14px " + (sbOpen ? 12 : 10) + "px 12px;gap:2px;background:#F8FAFC;transition:width .25s ease;position:relative;z-index:5")}>
        <div style={css("display:flex;align-items:center;gap:10px;padding:2px 2px 0 4px;margin-bottom:14px;min-height:36px")}>
          <Box
            onClick={() => router.push("/")}
            aria-label="Start a new chat"
            style={"display:flex;align-items:center;gap:10px;cursor:pointer;min-width:0;" + (sbOpen ? "" : "display:none")}
          >
            <span style={css("width:30px;height:30px;border-radius:8px;flex:none;background:#2563EB url('/logo-mark.png') center/cover no-repeat")} />
            <span style={css("font-family:'General Sans',Inter,sans-serif;font-size:16.5px;font-weight:600;letter-spacing:-.01em;color:#101828;white-space:nowrap")}>Agentic Salesforce</span>
          </Box>
          <Box
            onClick={() => set((p) => ({ sidebarOpen: !p.sidebarOpen }))}
            aria-label={sbOpen ? "Collapse sidebar" : "Expand sidebar"}
            style={(sbOpen ? "margin-left:auto;" : "margin:0 auto;") + "width:30px;height:30px;border-radius:8px;cursor:pointer;flex:none;" + navIcon("panel", "#667085")}
            styleHover="background:#EEF2F6"
          />
        </div>

        {sbOpen ? (
          <GlobalSearch compact />
        ) : (
          <Box onClick={() => set({ sidebarOpen: true })} aria-label="Search" style={row(false)} styleHover="background:#EEF2F6">
            <span style={css(navIcon("search", "#475467"))} />
          </Box>
        )}

        <Box onClick={() => router.push("/")} aria-label="New chat" style={row(path === "/")} styleHover="background:#EEF2F6">
          <span style={css(navIcon("compose", path === "/" ? "#1D4ED8" : "#475467"))} />
          <span style={css(sbOpen ? "white-space:nowrap" : "display:none")}>New chat</span>
        </Box>

        {NAV.map((nv) => {
          const active = isActive(nv.href, path);
          return (
            <Box key={nv.href} onClick={() => router.push(nv.href)} aria-label={nv.label} style={row(active)} styleHover="background:#EEF2F6">
              <span style={css(navIcon(nv.icon, active ? "#1D4ED8" : "#475467"))} />
              <span style={css(sbOpen ? "white-space:nowrap" : "display:none")}>{nv.label}</span>
            </Box>
          );
        })}

        {/* recent chats: one thread per team */}
        <div style={css("flex:1;min-height:0;overflow-y:auto;margin-top:16px;" + (sbOpen ? "" : "display:none"))}>
          <div style={css("padding:0 10px 6px;font-size:12.5px;font-weight:500;color:#667085")}>Recent chats</div>
          {teams.length === 0 && <div style={css("padding:4px 10px;font-size:13px;color:#98A2B3")}>No chats yet</div>}
          {teams.map((t) => {
            const active = path.startsWith("/chats") && s.convId === t.id;
            const msgs = s.chats[t.id];
            const last = msgs && msgs[msgs.length - 1];
            return (
              <Box
                key={t.id}
                onClick={() => { set({ convId: t.id }); router.push("/chats"); }}
                aria-label={"Open " + t.name + " chat"}
                style={"display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:10px;cursor:pointer;" + (active ? "background:#E8F0FE" : "")}
                styleHover="background:#EEF2F6"
              >
                <span style={css("width:22px;height:22px;border-radius:7px;background:" + t.iconBg + ";display:flex;align-items:center;justify-content:center;font-size:12px;flex:none")}>{t.icon}</span>
                <span style={css("min-width:0;flex:1;font-size:13.5px;font-weight:" + (active ? "600" : "500") + ";color:#101828;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{t.name}</span>
                {last && last.who !== "me" && <span style={css("width:7px;height:7px;border-radius:50%;background:#2563EB;flex:none")} />}
              </Box>
            );
          })}
        </div>
        {!sbOpen && <div style={css("flex:1")} />}

        {/* workspace + user */}
        <div style={css("border-top:1px solid #EAECF0;padding-top:10px;margin-top:8px;display:flex;flex-direction:column;gap:4px")}>
          <Box onClick={() => router.push("/settings")} aria-label="Workspace settings" style={"display:flex;align-items:center;gap:10px;padding:6px " + (sbOpen ? "8px" : "0") + ";border-radius:10px;cursor:pointer;" + (sbOpen ? "" : "justify-content:center")} styleHover="background:#EEF2F6">
            <span style={css("width:28px;height:28px;border-radius:8px;background:#101828;color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex:none")}>{wsInitial}</span>
            <span style={css(sbOpen ? "min-width:0;display:flex;flex-direction:column" : "display:none")}>
              <span style={css("font-size:11px;color:#667085")}>Workspace</span>
              <span style={css("font-size:13.5px;font-weight:600;color:#101828;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{s.workspaceName}</span>
            </span>
          </Box>
          <div style={css("display:flex;align-items:center;gap:10px;padding:6px " + (sbOpen ? "8px" : "0") + ";" + (sbOpen ? "" : "justify-content:center"))}>
            <Box onClick={() => router.push("/settings")} aria-label="Open settings" style="width:28px;height:28px;border-radius:50%;background:#101828;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;flex:none;cursor:pointer">{userInitials}</Box>
            <div style={css(sbOpen ? "min-width:0;flex:1" : "display:none")}>
              <div style={css("font-size:13.5px;font-weight:600;color:#101828;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{userName}</div>
              <div style={css("font-size:12px;color:#667085;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{userEmail}</div>
            </div>
            <Box
              onClick={async () => { await logout(); router.replace("/"); router.refresh(); }}
              aria-label="Log out"
              title="Log out"
              style={"width:28px;height:28px;border-radius:8px;cursor:pointer;flex:none;" + (sbOpen ? "" : "display:none;") + navIcon("logout", "#98A2B3")}
              styleHover="background:#EEF2F6"
            />
          </div>
        </div>
      </div>

      {/* ================= MAIN ================= */}
      <div style={css("flex:1;min-width:0;display:flex;flex-direction:column;background:#FFFFFF")}>
        <div style={css("display:flex;align-items:center;gap:14px;padding:0 24px;height:64px;background:#fff;flex:none;" + (title ? "border-bottom:1px solid #EAECF0" : ""))}>
          <div style={css("font-family:'General Sans',Inter,sans-serif;font-size:20px;font-weight:600;letter-spacing:-.01em;white-space:nowrap")}>{title}</div>
          <div style={css("margin-left:auto;display:flex;align-items:center;gap:10px;flex:none")}>
            <InboxBell />
            <NotificationsBell />
            <Btn
              onClick={() => router.push("/create")}
              style="height:40px;background:#101828;color:#fff;border:none;border-radius:100px;padding:0 18px;font-size:13.5px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:8px"
              styleHover="background:#344054"
            >
              <span style={{ fontSize: "17px", lineHeight: 1, fontWeight: 400 }}>+</span>Add agent
            </Btn>
          </div>
        </div>

        <div id="mainScroll" style={css("flex:1;overflow-y:auto;background:" + (path === "/" ? "#fff" : "#F9FAFB"))}>
          {children}
        </div>
      </div>
    </div>
  );
}
