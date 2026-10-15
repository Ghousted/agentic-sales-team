"use client";
// App chrome, styled after the redesign: a 272px light sidebar (collapses to a
// 64px icon rail) with Search, New chat, the main pages, recent team chats and
// workspace/account rows; a slim header with the inbox + notification bells.
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useApp } from "@/lib/store";
import { css, Box, Btn } from "./primitives";
import GlobalSearch from "./GlobalSearch";
import NotificationsBell from "./NotificationsBell";
import InboxBell from "./InboxBell";

// Lucide "calendar" (not in the design's icon-font subset).
const CalendarIcon = ({ size = 17 }: { size?: number }) => (
  <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
);
const Ico = ({ name, size = 17 }: { name: string; size?: number }) => name === "calendar" ? <CalendarIcon size={size} /> : <i className={"icon-" + name} style={{ fontSize: size }} />;

// Pages listed under "New chat". Agents and team pages are reached from the
// dashboard and the chat agent picker.
const NAV: { href: string; icon: string; label: string }[] = [
  { href: "/dashboard", icon: "chart-column", label: "Dashboard" },
  { href: "/leads", icon: "users-round", label: "Leads" },
  { href: "/products", icon: "blocks", label: "Products" },
  { href: "/calendar", icon: "calendar", label: "Calendar" },
];

function isActive(href: string, path: string): boolean {
  if (href === "/dashboard") return path === "/dashboard" || path.startsWith("/teams") || path.startsWith("/agents");
  return path.startsWith(href);
}

function headerTitle(path: string): string {
  if (path === "/" || path.startsWith("/chats")) return "";
  if (path === "/dashboard") return "Dashboard";
  if (path.startsWith("/teams")) return "Team details";
  if (path.startsWith("/agents/")) return "Agent details";
  if (path === "/agents") return "Agents";
  if (path.startsWith("/calendar")) return "Calendar";
  if (path.startsWith("/settings")) return "Settings";
  if (path.startsWith("/leads")) return "Leads";
  if (path.startsWith("/products")) return "Products";
  return "";
}

const ROW = "height:40px;display:flex;align-items:center;gap:12px;padding:0 12px;border:0;border-radius:10px;font-size:14px;text-align:left;cursor:pointer;transition:background .12s;color:#101418;width:100%";
const RAIL_BTN = "position:relative;width:40px;height:40px;border:0;border-radius:12px;color:#4a5565;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:background .12s";

export default function Shell({ children }: { children: React.ReactNode }) {
  const { s, set, teams, logout } = useApp();
  const router = useRouter();
  const path = usePathname();
  const open = s.sidebarOpen;
  const [pm, setPm] = useState(false);
  const pmRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pm) return;
    const away = (e: MouseEvent) => { if (pmRef.current && !pmRef.current.contains(e.target as Node)) setPm(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setPm(false); };
    document.addEventListener("click", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("click", away); document.removeEventListener("keydown", esc); };
  }, [pm]);

  const userName = s.userName;
  const userInitials = userName.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const userEmail = s.userEmail || userName.toLowerCase().split(" ").join(".") + "@spark.so";
  const wsInitial = (s.workspaceName.trim()[0] || "W").toUpperCase();
  const title = headerTitle(path);
  const doLogout = async () => { await logout(); router.replace("/"); router.refresh(); };
  const openChat = (id: string) => { set({ convId: id }); router.push("/chats"); };
  const bg = (on: boolean) => (on ? "background:#eceef1;font-weight:500" : "background:transparent");

  return (
    <div style={css("display:flex;height:100vh;overflow:hidden;background:#ffffff;color:#101418;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',system-ui,sans-serif;-webkit-font-smoothing:antialiased")}>
      {open ? (
        <aside aria-label="Sidebar" style={css("width:272px;flex:none;height:100vh;background:#f6f7f9;border-right:1px solid #eceef1;display:flex;flex-direction:column;animation:cSide .22s ease-out backwards;position:relative;z-index:5")}>
          <div style={css("height:62px;flex:none;display:flex;align-items:center;gap:10px;padding:14px 12px 0 15px")}>
            <Box onClick={() => router.push("/")} aria-label="New chat" style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;cursor:pointer">
              <span style={css("width:34px;height:34px;flex:none;border-radius:10px;background:url('/logo-mark.png') center/cover no-repeat")} />
              <span style={css("flex:1;font-size:15px;font-weight:500;letter-spacing:-.01em;white-space:nowrap")}>Agentic Sales Team</span>
            </Box>
            <Btn onClick={() => set({ sidebarOpen: false })} aria-label="Collapse sidebar" title="Collapse sidebar" style="width:34px;height:34px;border:0;border-radius:8px;background:transparent;color:#6b7686;display:flex;align-items:center;justify-content:center;cursor:pointer" styleHover="background:#eef0f3;color:#101418"><i className="icon-chevrons-left" style={{ fontSize: 18 }} /></Btn>
          </div>
          <div style={css("padding:4px 10px 0;display:flex;flex-direction:column;gap:2px")}>
            <GlobalSearch compact />
            <Btn onClick={() => router.push("/")} style={ROW + ";" + bg(path === "/")} styleHover="background:#eceef1"><span style={css("color:#4a5565;display:flex")}><Ico name="square-pen" /></span>New chat</Btn>
            {NAV.map((nv) => (
              <Btn key={nv.href} onClick={() => router.push(nv.href)} style={ROW + ";" + bg(isActive(nv.href, path))} styleHover="background:#eceef1"><span style={css("color:#4a5565;display:flex")}><Ico name={nv.icon} /></span>{nv.label}</Btn>
            ))}
          </div>

          <nav style={css("flex:1;overflow-y:auto;padding:18px 10px 12px")}>
            <div style={css("padding:0 12px 6px;font-size:13px;font-weight:500;color:#6b7686")}>Recent chats</div>
            {teams.length === 0 && <div style={css("padding:6px 12px;font-size:14px;color:#6b7686")}>No chats yet</div>}
            {teams.map((t, i) => {
              const cur = path.startsWith("/chats") && s.convId === t.id;
              const msgs = s.chats[t.id], last = msgs && msgs[msgs.length - 1], dot = !!last && last.who !== "me" && !cur;
              return (
                <Btn key={t.id} onClick={() => openChat(t.id)} aria-current={cur ? "page" : undefined} style={{ ...css("position:relative;width:100%;display:flex;align-items:center;gap:10px;height:36px;padding:0 10px 0 12px;border:0;border-radius:10px;text-align:left;cursor:pointer;transition:background .12s,transform .1s;animation:cUp .25s ease-out backwards"), background: cur ? "#eceef1" : "transparent", animationDelay: i * 0.03 + "s" }} styleHover="background:#eceef1">
                  <span style={css("width:18px;height:18px;flex:none;border-radius:50%;background:" + t.iconBg + ";font-size:10px;display:flex;align-items:center;justify-content:center")}>{t.icon}</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: dot || cur ? 500 : 400, color: dot || cur ? "#101418" : "#6b7686", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", transition: "color .2s" }}>{t.name}</span>
                  {dot && <span aria-hidden="true" style={css("width:7px;height:7px;flex:none;border-radius:50%;background:#006aff")} />}
                </Btn>
              );
            })}
          </nav>

          <div style={css("flex:none;padding:8px 10px 12px;border-top:1px solid #eceef1;display:flex;flex-direction:column;gap:2px")}>
            <Btn onClick={() => router.push("/settings")} style={"width:100%;height:44px;display:flex;align-items:center;gap:10px;padding:0 10px;border:0;border-radius:10px;background:" + (path.startsWith("/settings") ? "#eceef1" : "transparent") + ";text-align:left;cursor:pointer"} styleHover="background:#eceef1">
              <span style={css("width:28px;height:28px;flex:none;border-radius:8px;background:#101418;color:#ffffff;font-size:12px;font-weight:600;display:flex;align-items:center;justify-content:center")}>{wsInitial}</span>
              <span style={css("flex:1;min-width:0")}><span style={css("display:block;font-size:11.5px;color:#6b7686")}>Workspace</span><span style={css("display:block;font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{s.workspaceName}</span></span>
              <i className="icon-chevrons-up-down" style={{ fontSize: 15, color: "#8a94a3" }} />
            </Btn>
            <div ref={pmRef} style={css("position:relative")}>
              <Btn onClick={() => setPm((v) => !v)} aria-haspopup="menu" aria-expanded={pm} aria-label="Account" style={"width:100%;height:48px;display:flex;align-items:center;gap:10px;padding:0 10px;border:0;border-radius:10px;background:" + (pm ? "#eceef1" : "transparent") + ";text-align:left;cursor:pointer"} styleHover="background:#eceef1">
                <span style={css("width:32px;height:32px;flex:none;border-radius:50%;background:#eceef1;color:#4a5565;font-size:12px;font-weight:500;display:flex;align-items:center;justify-content:center;box-shadow:inset 0 0 0 1px #e3e7ed")}>{userInitials}</span>
                <span style={css("flex:1;min-width:0")}><span style={css("display:block;font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{userName}</span><span style={css("display:block;font-size:12.5px;color:#6b7686;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{userEmail}</span></span>
                <i className="icon-ellipsis" style={{ fontSize: 16, color: "#8a94a3" }} />
              </Btn>
              {pm && (
                <div role="menu" aria-label="Account" style={css("position:absolute;left:0;right:0;bottom:calc(100% + 6px);z-index:61;padding:6px;background:#ffffff;border:1px solid rgba(16,20,24,.08);border-radius:14px;box-shadow:0 16px 40px rgba(16,20,24,.16);animation:cMenu .14s ease-out backwards;transform-origin:50% 100%")}>
                  <div style={css("display:flex;align-items:center;gap:10px;padding:8px 10px 10px")}>
                    <span style={css("width:36px;height:36px;flex:none;border-radius:50%;background:#eceef1;color:#4a5565;font-size:13px;font-weight:500;display:flex;align-items:center;justify-content:center")}>{userInitials}</span>
                    <span style={css("min-width:0")}><span style={css("display:block;font-size:14px;font-weight:500")}>{userName}</span><span style={css("display:block;font-size:12.5px;color:#6b7686;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{userEmail}</span></span>
                  </div>
                  <div style={css("height:1px;background:#eef1f5;margin:2px 4px 6px")} />
                  {[
                    { icon: "user-cog", label: "Settings", run: () => { setPm(false); router.push("/settings"); } },
                    { icon: "users-round", label: "Agents", run: () => { setPm(false); router.push("/agents"); } },
                    { icon: "log-out", label: "Log out", run: () => { setPm(false); doLogout(); } },
                  ].map((it) => (
                    <Btn key={it.label} role="menuitem" onClick={it.run} style="width:100%;display:flex;align-items:center;gap:10px;height:38px;padding:0 10px;border:0;border-radius:9px;background:transparent;font-size:14px;text-align:left;cursor:pointer" styleHover="background:#f3f4f6"><i className={"icon-" + it.icon} style={{ fontSize: 16, color: "#4a5565" }} />{it.label}</Btn>
                  ))}
                </div>
              )}
            </div>
          </div>
        </aside>
      ) : (
        <nav aria-label="Main" style={css("width:64px;flex:none;height:100vh;background:#f6f7f9;border-right:1px solid #eceef1;display:flex;flex-direction:column;align-items:center;gap:6px;padding:14px 0")}>
          <Btn onClick={() => set({ sidebarOpen: true })} aria-label="Expand sidebar" title="Expand sidebar" style="width:34px;height:34px;margin-bottom:14px;padding:0;border:0;border-radius:10px;background:url('/logo-mark.png') center/cover no-repeat;cursor:pointer;transition:transform .12s" styleHover="transform:scale(1.06)" />
          <Btn onClick={() => router.push("/")} aria-label="New chat" title="New chat" style={RAIL_BTN + ";background:" + (path === "/" ? "#eceef1" : "transparent")} styleHover="background:#eceef1"><Ico name="square-pen" size={18} /></Btn>
          <Btn onClick={() => set({ sidebarOpen: true })} aria-label="Search" title="Search" style={RAIL_BTN + ";background:transparent"} styleHover="background:#eceef1"><Ico name="search" size={18} /></Btn>
          {NAV.map((nv) => (
            <Btn key={nv.href} onClick={() => router.push(nv.href)} aria-label={nv.label} title={nv.label} style={RAIL_BTN + ";background:" + (isActive(nv.href, path) ? "#eceef1" : "transparent")} styleHover="background:#eceef1"><Ico name={nv.icon} size={18} /></Btn>
          ))}
          <Btn onClick={() => set({ sidebarOpen: true })} aria-label="Chats" title="Chats" style={RAIL_BTN + ";background:" + (path.startsWith("/chats") ? "#eceef1" : "transparent")} styleHover="background:#eceef1"><Ico name="messages-square" size={18} /></Btn>
          <div style={{ flex: 1 }} />
          <Btn onClick={() => router.push("/settings")} aria-label="Workspace" title="Workspace" style={RAIL_BTN + ";background:transparent"} styleHover="background:#eceef1"><span style={css("width:26px;height:26px;border-radius:7px;background:#101418;color:#ffffff;font-size:11px;font-weight:600;display:flex;align-items:center;justify-content:center")}>{wsInitial}</span></Btn>
          <Btn onClick={doLogout} aria-label="Log out" title="Log out" style={RAIL_BTN + ";background:transparent"} styleHover="background:#eceef1"><Ico name="log-out" size={18} /></Btn>
        </nav>
      )}

      <div style={css("flex:1;min-width:0;display:flex;flex-direction:column")}>
        <header style={css("height:60px;flex:none;display:flex;align-items:center;gap:10px;padding:0 16px 0 24px;" + (title ? "border-bottom:1px solid #eceef1" : ""))}>
          {title && <h1 key={title} style={css("margin:0;font-family:'General Sans',system-ui,sans-serif;font-size:20px;font-weight:500;letter-spacing:-.02em;white-space:nowrap;animation:cSwapA .2s ease-out backwards")}>{title}</h1>}
          <div style={css("margin-left:auto;display:flex;align-items:center;gap:8px;flex:none")}>
            <InboxBell />
            <NotificationsBell />
            <Btn onClick={() => router.push("/create")} style="height:36px;background:#101418;color:#fff;border:none;border-radius:999px;padding:0 16px 0 12px;font-size:14px;font-weight:500;cursor:pointer;display:flex;align-items:center;gap:6px;transition:background .12s,transform .1s" styleHover="background:#2a313b">
              <i className="icon-plus" style={{ fontSize: 16 }} />Add agent
            </Btn>
          </div>
        </header>
        <div id="mainScroll" key={path} style={css("flex:1;overflow-y:auto;background:" + (path === "/" || path.startsWith("/chats") ? "#ffffff" : "#f9fafb") + ";animation:cFade .25s ease-out backwards")}>
          {children}
        </div>
      </div>
    </div>
  );
}
