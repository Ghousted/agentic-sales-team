"use client";
// Shared client store: ports the v5 component's state, derived data, actions,
// and lifecycle timers (count-up, hub tick, live activity feed) into a Context.
import React, { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Agent, Team, Chats } from "./types";
import { AGENTS_BASE, TEAMS_BASE, chatsInit } from "./data";
import { typeById } from "./agentTypes";
import { signOut as signOutAction } from "./auth/actions";
import { teamChat } from "./chat/actions";
import { getJob } from "./jobs/actions";
import { saveAgent, saveTeam, saveTeamMeta as saveTeamMetaAction, deleteTeam as deleteTeamAction, setAgentRemoved, setAgentPaused, appendMessages, clearMessages, saveAgentConfig as saveAgentConfigAction, saveTeamMembers as saveTeamMembersAction, type WorkspaceData, type AgentConfig } from "./workspace/actions";

interface WizardState {
  wStep: number;
  wName: string;
  wNick: string;
  wAvatar: string;
  wColor: string;
  wPosition: string;
  wIndustry: string;
  wSize: string;
  wTitles: string;
  wGeo: string;
  wGoals: string;
  wChannels: Record<string, boolean>;
  wPosInput: string;
  wCharacter: number;
  wCreatedId: string | null;
  wType: string;
  wCapabilities: string[];
  wSettings: Record<string, Record<string, unknown>>;
}

interface State extends WizardState {
  authed: boolean;
  // Logged-out visitors see the marketing Landing first; the auth screen only
  // takes over once they choose Get started / Sign in (showAuth flips true).
  showAuth: boolean;
  authMode: "login" | "signup";
  sidebarOpen: boolean;
  chats: Chats;
  convId: string;
  chatInput: string;
  chatTyping: string | boolean; // false = hidden · true = generic · agentId = that agent is typing
  chatLeadPicks: { id: string; name: string }[];
  hubTick: number;
  countT: number;
  hubTeam: string;
  toast: string;
  paused: Record<string, boolean>;
  removed: Record<string, boolean>;
  agentConfig: Record<string, AgentConfig>;
  teamMembers: Record<string, string[]>;
  extraAgents: Agent[];
  extraTeams: Team[];
  search: string;
  // team modal
  showTeamModal: boolean;
  tName: string;
  tIcon: string;
  tGoal: string;
  tSel: Record<string, boolean>;
  tTemplate: string;
  tGapName: Record<string, string>;
  // settings
  toggles: Record<string, boolean>;
  workspaceName: string;
  userName: string;
  userEmail: string;
}

const initialWizard: WizardState = {
  wStep: 0, wName: "", wNick: "", wAvatar: "Professional", wColor: "#006AFF",
  wPosition: "SDR", wIndustry: "SaaS", wSize: "51-200", wTitles: "", wGeo: "", wGoals: "",
  wChannels: { Email: true, LinkedIn: true }, wPosInput: "", wCharacter: 2, wCreatedId: null,
  wType: "sdr", wCapabilities: [],
  wSettings: {},
};

const initialState: State = {
  ...initialWizard,
  authed: false, showAuth: false, authMode: "login", sidebarOpen: true,
  chats: chatsInit(), convId: "sk", chatInput: "", chatTyping: false, chatLeadPicks: [],
  hubTick: 0, countT: 1, hubTeam: "all",
  toast: "", paused: {}, removed: {}, agentConfig: {}, teamMembers: {}, extraAgents: [], extraTeams: [],
  search: "",
  showTeamModal: false, tName: "", tIcon: "🚀", tGoal: "", tSel: { sk: true, mt: true }, tTemplate: "custom", tGapName: {},
  toggles: { t0: true, t1: true, t2: false },
  workspaceName: "Acme Sales", userName: "Jordan Diaz", userEmail: "",
};

// Background tint paired with each team icon (used by create + edit).
const TEAM_ICON_BG: Record<string, string> = { "🚀": "#EAF2FF", "🌎": "#E9F5FE", "🏛": "#FDF0F5", "📣": "#FEF6E8", "🎯": "#E7F7EC", "💎": "#EAF2FF" };

interface Ctx {
  s: State;
  set: (patch: Partial<State> | ((s: State) => Partial<State>)) => void;
  agents: Agent[];
  teams: Team[];
  byId: (id: string) => Agent | undefined;
  showToast: (msg: string) => void;
  signedIn: (user: AuthedUser) => void;
  logout: () => Promise<void>;
  deleteAgent: (id: string) => void;
  deleteTeam: (teamId: string) => void;
  togglePause: (id: string) => void;
  saveConfig: (id: string, cfg: AgentConfig) => void;
  addTeamMembers: (teamId: string, ids: string[]) => void;
  updateTeam: (teamId: string, patch: { name?: string; icon?: string; goal?: string }) => void;
  removeTeamMember: (teamId: string, agentId: string) => void;
  sendTeamChat: (teamId: string, text: string, leadIds?: string[]) => void;
  clearChat: (convId: string) => void;
  createTeam: () => string;
  createAgent: () => void;
  quickCreateAgent: (typeId: string, name: string) => string;
  animateCount: () => void;
}

const AppCtx = createContext<Ctx | null>(null);

export function useApp(): Ctx {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error("useApp must be used within <AppProvider>");
  return ctx;
}

export interface AuthedUser {
  name: string;
  email: string;
  workspaceName: string;
  notifications: Record<string, boolean>;
}

// Combine the static seed openers with the user's persisted messages: for each
// agent, the seed opener(s) come first, then the stored conversation.
function mergeChats(seed: Chats, loaded?: Chats): Chats {
  const out: Chats = { ...seed };
  for (const [agentId, msgs] of Object.entries(loaded ?? {})) {
    out[agentId] = (seed[agentId] ?? []).concat(msgs);
  }
  return out;
}

export function AppProvider({ children, initialUser, initialWorkspace }: { children: React.ReactNode; initialUser?: AuthedUser | null; initialWorkspace?: WorkspaceData | null }) {
  // Initialize from the server-verified session + persisted workspace so a
  // refresh stays logged in and keeps the user's created/deleted/paused agents.
  const [s, setS] = useState<State>(() => ({
    ...initialState,
    authed: !!initialUser,
    userName: initialUser?.name ?? initialState.userName,
    userEmail: initialUser?.email ?? initialState.userEmail,
    workspaceName: initialUser?.workspaceName ?? initialState.workspaceName,
    extraAgents: initialWorkspace?.extraAgents ?? initialState.extraAgents,
    extraTeams: initialWorkspace?.extraTeams ?? initialState.extraTeams,
    removed: Object.fromEntries((initialWorkspace?.removed ?? []).map((id) => [id, true])),
    paused: Object.fromEntries((initialWorkspace?.paused ?? []).map((id) => [id, true])),
    agentConfig: initialWorkspace?.config ?? {},
    teamMembers: initialWorkspace?.teamMembers ?? {},
    // Chats = static seed openers + the user's persisted messages appended in order.
    chats: mergeChats(chatsInit(), initialWorkspace?.chats),
    // Notification toggles: account-saved values over the defaults.
    toggles: { ...initialState.toggles, ...(initialUser?.notifications ?? {}) },
  }));
  const sRef = useRef(s);
  sRef.current = s;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);

  const set = useCallback((patch: Partial<State> | ((prev: State) => Partial<State>)) => {
    setS((prev) => ({ ...prev, ...(typeof patch === "function" ? patch(prev) : patch) }));
  }, []);

  const agents = useMemo(
    () =>
      AGENTS_BASE.concat(s.extraAgents)
        .filter((a) => !s.removed[a.id]) // hide soft-deleted seed AND created agents
        .map((a) => {
          const c = s.agentConfig[a.id];
          return c ? { ...a, role: c.role ?? a.role, goal: c.goal ?? a.goal } : a;
        }),
    [s.removed, s.extraAgents, s.agentConfig]
  );
  const teams = useMemo(
    () =>
      TEAMS_BASE.concat(s.extraTeams).map((t) =>
        s.teamMembers[t.id] ? { ...t, members: s.teamMembers[t.id] } : t
      ),
    [s.extraTeams, s.teamMembers]
  );
  const byId = useCallback((id: string) => agents.find((a) => a.id === id), [agents]);

  const showToast = useCallback((msg: string) => {
    set({ toast: msg });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => set({ toast: "" }), 2600);
  }, [set]);

  const animateCount = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / 900);
      const e = 1 - Math.pow(1 - p, 3);
      set({ countT: e });
      if (p < 1) rafRef.current = requestAnimationFrame(step);
    };
    set({ countT: 0 });
    rafRef.current = requestAnimationFrame(step);
  }, [set]);

  // Apply a successful sign-in/sign-up (the session cookie is set server-side).
  const signedIn = useCallback((user: AuthedUser) => {
    set((prev) => ({
      authed: true, userName: user.name, userEmail: user.email, workspaceName: user.workspaceName,
      toggles: { ...prev.toggles, ...(user.notifications ?? {}) },
    }));
    animateCount();
    showToast("Welcome, " + user.name.split(" ")[0] + "!");
  }, [set, animateCount, showToast]);

  const logout = useCallback(async () => {
    await signOutAction();
    // Clear this user's workspace from the store so nothing leaks into the next
    // session before the post-login full reload re-hydrates the right data.
    set({
      authed: false, showAuth: false, authMode: "login",
      extraAgents: [], extraTeams: [], removed: {}, paused: {}, agentConfig: {}, teamMembers: {},
      chats: chatsInit(),
    });
  }, [set]);

  const deleteAgent = useCallback((id: string) => {
    const a = agents.find((x) => x.id === id);
    set((prev) => ({ removed: { ...prev.removed, [id]: true } }));
    if (a) showToast(a.name + " deleted");
    setAgentRemoved(id, true).catch((e) => console.error("[deleteAgent] persist failed:", e));
  }, [agents, set, showToast]);

  // Delete a user-CREATED team (removes it from local state + the DB row). Seed
  // teams (TEAMS_BASE) aren't in extraTeams, so the UI only offers delete on created ones.
  const deleteTeam = useCallback((teamId: string) => {
    const t = sRef.current.extraTeams.find((x) => x.id === teamId);
    set((prev) => {
      const teamMembers = { ...prev.teamMembers };
      delete teamMembers[teamId];
      return {
        extraTeams: prev.extraTeams.filter((x) => x.id !== teamId),
        teamMembers,
        hubTeam: prev.hubTeam === teamId ? "all" : prev.hubTeam,
      };
    });
    if (t) showToast(t.name + " deleted");
    deleteTeamAction(teamId).catch((e) => console.error("[deleteTeam] persist failed:", e));
  }, [set, showToast]);

  const togglePause = useCallback((id: string) => {
    const a = agents.find((x) => x.id === id);
    const next = !sRef.current.paused[id];
    set((prev) => ({ paused: { ...prev.paused, [id]: next } }));
    if (a) showToast(a.name + (next ? " paused" : " resumed"));
    setAgentPaused(id, next).catch((e) => console.error("[togglePause] persist failed:", e));
  }, [agents, set, showToast]);

  const saveConfig = useCallback((id: string, cfg: AgentConfig) => {
    // Merge (don't overwrite) so saving one facet — role/goal/permissions from the
    // Config tab, or settings — never drops the others from the in-memory store,
    // mirroring saveAgentConfig's partial upsert on the DB side.
    set((prev) => ({ agentConfig: { ...prev.agentConfig, [id]: { ...prev.agentConfig[id], ...cfg } } }));
    showToast("Configuration saved");
    saveAgentConfigAction(id, cfg).catch((e) => console.error("[saveConfig] persist failed:", e));
  }, [set, showToast]);

  const addTeamMembers = useCallback((teamId: string, ids: string[]) => {
    const st = sRef.current;
    // Effective current members: override if set, else the team's base list.
    const base = TEAMS_BASE.concat(st.extraTeams).find((t) => t.id === teamId);
    if (!base) return;
    const current = st.teamMembers[teamId] ?? base.members;
    const merged = Array.from(new Set(current.concat(ids)));
    const added = merged.length - current.length;
    if (added <= 0) return;
    set((prev) => ({ teamMembers: { ...prev.teamMembers, [teamId]: merged } }));
    showToast((added === 1 ? "1 agent added to " : added + " agents added to ") + base.name);
    saveTeamMembersAction(teamId, merged).catch((e) => console.error("[addTeamMembers] persist failed:", e));
  }, [set, showToast]);

  // Edit a team's meta (name, icon, goal). Only user-created teams live in
  // extraTeams, so this maps over that list and persists just the changed fields.
  const updateTeam = useCallback((teamId: string, patch: { name?: string; icon?: string; goal?: string }) => {
    const meta: Partial<Team> = {};
    if (patch.name !== undefined) meta.name = patch.name.trim() || "New Team";
    if (patch.goal !== undefined) meta.goal = patch.goal.trim() || "Define a shared goal for this team.";
    if (patch.icon !== undefined) { meta.icon = patch.icon; meta.iconBg = TEAM_ICON_BG[patch.icon] || "#EAF2FF"; }
    if (Object.keys(meta).length === 0) return;
    set((prev) => ({ extraTeams: prev.extraTeams.map((t) => (t.id === teamId ? { ...t, ...meta } : t)) }));
    const display = meta.name ?? TEAMS_BASE.concat(sRef.current.extraTeams).find((t) => t.id === teamId)?.name ?? "Team";
    showToast("“" + display + "” updated");
    saveTeamMetaAction(teamId, meta).catch((e) => console.error("[updateTeam] persist failed:", e));
  }, [set, showToast]);

  const removeTeamMember = useCallback((teamId: string, agentId: string) => {
    const st = sRef.current;
    const base = TEAMS_BASE.concat(st.extraTeams).find((t) => t.id === teamId);
    if (!base) return;
    const current = st.teamMembers[teamId] ?? base.members;
    const next = current.filter((id) => id !== agentId);
    if (next.length === current.length) return;
    set((prev) => ({ teamMembers: { ...prev.teamMembers, [teamId]: next } }));
    const agentName = agents.find((a) => a.id === agentId)?.name ?? "Agent";
    showToast(agentName + " removed from " + base.name);
    saveTeamMembersAction(teamId, next).catch((e) => console.error("[removeTeamMember] persist failed:", e));
  }, [agents, set, showToast]);

  // Clear one conversation: empty it locally and delete its persisted messages.
  const clearChat = useCallback((convId: string) => {
    set((prev) => ({ chats: { ...prev.chats, [convId]: [] } }));
    clearMessages(convId).catch((e) => console.error("[clearChat] delete failed:", e));
  }, [set]);

  const sendTeamChat = useCallback((teamId: string, text: string, leadIds?: string[]) => {
    const t = (text || "").trim();
    if (!t) return;
    set((prev) => ({
      chats: { ...prev.chats, [teamId]: (prev.chats[teamId] || []).concat([{ who: "me", text: t }]) },
      chatInput: "", chatTyping: true, chatLeadPicks: [],
    }));
    appendMessages(teamId, [{ who: "me", text: t }]).catch((e) => console.error("[sendTeamChat] persist user msg failed:", e));

    const append = (who: string, text: string) => {
      set((prev) => ({ chats: { ...prev.chats, [teamId]: (prev.chats[teamId] || []).concat([{ who, text }]) } }));
      appendMessages(teamId, [{ who, text }]).catch(() => {});
    };
    // Human-feel pacing: show a per-agent typing indicator, pause briefly (longer
    // for longer lines), then reveal — so a hand-off between agents reads like a
    // real back-and-forth instead of a wall of text appearing all at once.
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const replyDelay = (text: string) => Math.min(2000, Math.max(650, Math.round((text || "").length * 18))) + Math.floor(Math.random() * 250);
    const typeThenAppend = async (who: string, text: string) => {
      if (who === "system") { set({ chatTyping: false }); append(who, text); return; }
      set({ chatTyping: who });
      await sleep(replyDelay(text));
      set({ chatTyping: false });
      append(who, text);
    };

    teamChat(teamId, t, leadIds).then(async (res) => {
      for (const m of res.messages) await typeThenAppend(m.who, m.text);
      if (!res.job) return;
      const job = res.job;
      if (job.kind === "scrape") {
        try {
          const r = await fetch("/api/scrape", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: job.id }) });
          const data = (await r.json().catch(() => ({}))) as { leadsFound?: number; error?: string; note?: string };
          if (!r.ok || data.error) append(job.agentId, "I wasn't able to run that search: " + (data.error ?? "unknown error"));
          else if (data.note === "already running") await typeThenAppend(job.agentId, "That search is already in progress. I'll post the results here shortly.");
          else {
            await typeThenAppend(job.agentId, `I found ${data.leadsFound ?? 0} lead${data.leadsFound === 1 ? "" : "s"}.`);
            // The scrape hands off down the chain (assess → match → outreach → you).
            // Kick the runner so the auto stages run; their messages arrive via the thread poll.
            try { await fetch("/api/jobs/run", { method: "POST" }); } catch { /* best-effort */ }
          }
        } catch { append(job.agentId, "That search didn't complete. Please try again."); }
        return;
      }
      // research / outreach: run in the Node runner, then poll getJob (unchanged below)
      try { await fetch("/api/jobs/run", { method: "POST" }); } catch { /* best-effort */ }
      let waited = 0;
      const poll = async (): Promise<void> => {
        let job;
        try { job = await getJob(res.job!.id); }
        catch { if (waited >= 40) { append(res.job!.agentId, "I've lost track of that run. Please check the agent's page."); return; } waited++; setTimeout(poll, 2500); return; }
        if (!job) return;
        const r = (job.result ?? {}) as { leadsFound?: number; briefed?: number; draftsCreated?: number; matched?: number; steps?: number };
        if (job.status === "done") {
          const done = res.job!.kind === "research" ? `I've researched ${r.briefed ?? 0} lead${r.briefed === 1 ? "" : "s"}.`
            : res.job!.kind === "match" ? `I matched ${r.matched ?? 0} lead${r.matched === 1 ? "" : "s"} to your catalog.`
            : `I've drafted ${r.draftsCreated ?? 0} email${r.draftsCreated === 1 ? "" : "s"}, ready for you to review and send.`;
          await typeThenAppend(res.job!.agentId, done);
          return;
        }
        if (job.status === "failed") { append(res.job!.agentId, "That run didn't complete. Please check the agent's page."); return; }
        if (waited >= 40) { append(res.job!.agentId, "I'm still working on it in the background. Please check back shortly."); return; }
        waited++;
        setTimeout(poll, 2500);
      };
      poll();
    }).catch(() => { set({ chatTyping: false }); append("system", "I'm sorry — I wasn't able to process that just now."); });
  }, [set]);

  const createTeam = useCallback((): string => {
    const cur = sRef.current;
    const name = cur.tName.trim() || "New Team";
    const members = Object.keys(cur.tSel).filter((k) => cur.tSel[k]);
    const id = "tx" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const team: Team = {
      id, name, icon: cur.tIcon, iconBg: TEAM_ICON_BG[cur.tIcon] || "#EAF2FF",
      desc: members.length + " agents · just created", members, meetings: 0, pipeline: "—", leads: 0,
      goal: cur.tGoal.trim() || "Define a shared goal for this team.",
      activity: ["Team created — agents onboarding", "Shared goal set"],
      template: cur.tTemplate || "custom",
    };
    set((prev) => ({ extraTeams: prev.extraTeams.concat([team]), showTeamModal: false, tName: "", tGoal: "", tSel: {}, tTemplate: "custom", tGapName: {} }));
    showToast(name + " created");
    saveTeam(team).catch((e) => console.error("[createTeam] persist failed:", e));
    return id;
  }, [set, showToast]);

  const createAgent = useCallback(() => {
    const cur = sRef.current;
    const name = cur.wName.trim() || "New Agent";
    const initials = name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
    const id = "x" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const at = typeById(cur.wType) ;
    const capabilities = at?.custom ? cur.wCapabilities : (at?.capabilities ?? []);
    const agent: Agent = {
      id, name, initials, role: at?.label ?? "Custom", color: cur.wColor, status: "working",
      task: "Onboarding — configuring capabilities", score: 75,
      goal: cur.wGoals.split(".")[0] || "Ramp up in week 1",
      char: cur.wCharacter,
      type: cur.wType, capabilities,
    };
    // 5 input steps (0-4); step 5 is the "agent is live" success screen.
    set((prev) => ({ extraAgents: prev.extraAgents.concat([agent]), wStep: 5, wCreatedId: id }));
    saveAgent(agent).catch((e) => console.error("[createAgent] persist failed:", e));
    if (Object.keys(cur.wSettings).length) {
      saveAgentConfigAction(id, { settings: cur.wSettings }).catch((e) => console.error("[createAgent] settings persist failed:", e));
      set((prev) => ({ agentConfig: { ...prev.agentConfig, [id]: { ...prev.agentConfig[id], settings: cur.wSettings } } }));
    }
  }, [set]);

  const quickCreateAgent = useCallback((typeId: string, name: string): string => {
    const at = typeById(typeId);
    const id = "x" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const nm = name.trim() || (at?.label ?? "Agent");
    const initials = nm.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
    const agent: Agent = {
      id, name: nm, initials, role: at?.label ?? "Custom", color: "#006AFF", status: "working",
      task: "Onboarding", score: 75, goal: "Ramp up in week 1",
      type: typeId, capabilities: at?.capabilities ?? [],
    };
    set((prev) => ({ extraAgents: prev.extraAgents.concat([agent]) }));
    saveAgent(agent).catch((e) => console.error("[quickCreateAgent] persist failed:", e));
    return id;
  }, [set]);

  // Lifecycle: count-up + hub tick, running once authenticated.
  useEffect(() => {
    if (!s.authed) return;
    const hub = setInterval(() => set((prev) => ({ hubTick: prev.hubTick + 1 })), 3200);
    return () => { clearInterval(hub); };
  }, [s.authed, set]);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  const value: Ctx = {
    s, set, agents, teams, byId,
    showToast, signedIn, logout, deleteAgent, deleteTeam, togglePause, saveConfig, addTeamMembers, updateTeam, removeTeamMember, sendTeamChat, clearChat, createTeam, createAgent, quickCreateAgent, animateCount,
  };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
