"use client";
// Shared client store: ports the v5 component's state, derived data, actions,
// and lifecycle timers (count-up, hub tick, live activity feed) into a Context.
import React, { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Agent, Team, Chats } from "./types";
import { AGENTS_BASE, TEAMS_BASE, chatsInit } from "./data";
import { typeById } from "./agentTypes";
import { signOut as signOutAction } from "./auth/actions";
import { chatReply } from "./ai/actions";
import { saveAgent, saveTeam, setAgentRemoved, setAgentPaused, appendMessages, saveAgentConfig as saveAgentConfigAction, saveTeamMembers as saveTeamMembersAction, type WorkspaceData, type AgentConfig } from "./workspace/actions";

export interface FeedItem {
  id: string;
  text: string;
  chip: string;
  chipBg: string;
  chipColor: string;
  time?: string;
}

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
  authMode: "login" | "signup";
  sidebarOpen: boolean;
  chats: Chats;
  convId: string;
  chatInput: string;
  chatTyping: boolean;
  feedExtra: FeedItem[];
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
  wStep: 0, wName: "", wNick: "", wAvatar: "Professional", wColor: "#5122C1",
  wPosition: "SDR", wIndustry: "SaaS", wSize: "51-200", wTitles: "", wGeo: "", wGoals: "",
  wChannels: { Email: true, LinkedIn: true }, wPosInput: "", wCharacter: 2, wCreatedId: null,
  wType: "sdr", wCapabilities: [],
  wSettings: {},
};

const initialState: State = {
  ...initialWizard,
  authed: false, authMode: "login", sidebarOpen: true,
  chats: chatsInit(), convId: "sk", chatInput: "", chatTyping: false,
  feedExtra: [], hubTick: 0, countT: 1, hubTeam: "all",
  toast: "", paused: {}, removed: {}, agentConfig: {}, teamMembers: {}, extraAgents: [], extraTeams: [],
  search: "",
  showTeamModal: false, tName: "", tIcon: "🚀", tGoal: "", tSel: { sk: true, mt: true }, tTemplate: "custom", tGapName: {},
  toggles: { t0: true, t1: true, t2: false },
  workspaceName: "Acme Sales", userName: "Jordan Diaz", userEmail: "",
};

const ACTIVITY_POOL: FeedItem[] = [
  { id: "ew", text: "qualified 6 more Healthcare leads", chip: "Leads", chipBg: "#E7F7EC", chipColor: "#1B7A3D" },
  { id: "mt", text: "got an open from Ramp — 2nd in 24h", chip: "Signal", chipBg: "#E9F5FE", chipColor: "#0369A1" },
  { id: "sk", text: "sent a follow-up to Plaid’s CTO", chip: "Outreach", chipBg: "#FEF6E8", chipColor: "#B45309" },
  { id: "al", text: "scheduled a call with Brex for Friday", chip: "Meeting", chipBg: "#FDF0F5", chipColor: "#DB2777" },
  { id: "nc", text: "rebalanced lead assignments across the SDR team", chip: "Ops", chipBg: "#F1EDFD", chipColor: "#5122C1" },
];

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
  togglePause: (id: string) => void;
  saveConfig: (id: string, cfg: AgentConfig) => void;
  addTeamMembers: (teamId: string, ids: string[]) => void;
  sendChat: (text: string) => void;
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
      AGENTS_BASE.filter((a) => !s.removed[a.id])
        .concat(s.extraAgents)
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
      authed: false, authMode: "login",
      extraAgents: [], extraTeams: [], removed: {}, paused: {}, agentConfig: {}, teamMembers: {},
      feedExtra: [], chats: chatsInit(),
    });
  }, [set]);

  const deleteAgent = useCallback((id: string) => {
    const a = agents.find((x) => x.id === id);
    set((prev) => ({ removed: { ...prev.removed, [id]: true } }));
    if (a) showToast(a.name + " deleted");
    setAgentRemoved(id, true).catch((e) => console.error("[deleteAgent] persist failed:", e));
  }, [agents, set, showToast]);

  const togglePause = useCallback((id: string) => {
    const a = agents.find((x) => x.id === id);
    const next = !sRef.current.paused[id];
    set((prev) => ({ paused: { ...prev.paused, [id]: next } }));
    if (a) showToast(a.name + (next ? " paused" : " resumed"));
    setAgentPaused(id, next).catch((e) => console.error("[togglePause] persist failed:", e));
  }, [agents, set, showToast]);

  const saveConfig = useCallback((id: string, cfg: AgentConfig) => {
    set((prev) => ({ agentConfig: { ...prev.agentConfig, [id]: cfg } }));
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
    showToast(added === 1 ? "1 agent added" : added + " agents added");
    saveTeamMembersAction(teamId, merged).catch((e) => console.error("[addTeamMembers] persist failed:", e));
  }, [set, showToast]);

  const sendChat = useCallback((text: string) => {
    const t = (text || "").trim();
    if (!t) return;
    const convId = sRef.current.convId;
    const agent = agents.find((a) => a.id === convId) || agents[0];
    const history = (sRef.current.chats[convId] || []).map((m) => ({ who: m.who, text: m.text }));
    set((prev) => ({
      chats: { ...prev.chats, [convId]: (prev.chats[convId] || []).concat([{ who: "me", text: t }]) },
      chatInput: "",
      chatTyping: true,
    }));
    // Persist the user's message immediately (fire-and-forget).
    appendMessages(convId, [{ who: "me", text: t }]).catch((e) => console.error("[sendChat] persist user msg failed:", e));
    const appendAi = (reply: string, persist: boolean) => {
      set((prev) => ({
        chats: { ...prev.chats, [convId]: (prev.chats[convId] || []).concat([{ who: "ai", text: reply }]) },
        chatTyping: false,
      }));
      if (persist) appendMessages(convId, [{ who: "ai", text: reply }]).catch((e) => console.error("[sendChat] persist ai msg failed:", e));
    };
    chatReply({ agent: { name: agent.name, role: agent.role, goal: agent.goal, task: agent.task }, history, message: t })
      .then((reply) => appendAi(reply, true))
      .catch(() => appendAi("Sorry, I couldn’t respond just now. Please try again.", false));
  }, [agents, set]);

  const createTeam = useCallback((): string => {
    const cur = sRef.current;
    const name = cur.tName.trim() || "New Team";
    const members = Object.keys(cur.tSel).filter((k) => cur.tSel[k]);
    const bgs: Record<string, string> = { "🚀": "#F1EDFD", "🌎": "#E9F5FE", "🏛": "#FDF0F5", "📣": "#FEF6E8", "🎯": "#E7F7EC", "💎": "#F1EDFD" };
    const id = "tx" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const team: Team = {
      id, name, icon: cur.tIcon, iconBg: bgs[cur.tIcon] || "#F1EDFD",
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
      id, name: nm, initials, role: at?.label ?? "Custom", color: "#5122C1", status: "working",
      task: "Onboarding", score: 75, goal: "Ramp up in week 1",
      type: typeId, capabilities: at?.capabilities ?? [],
    };
    set((prev) => ({ extraAgents: prev.extraAgents.concat([agent]) }));
    saveAgent(agent).catch((e) => console.error("[quickCreateAgent] persist failed:", e));
    return id;
  }, [set]);

  // Lifecycle: count-up + hub tick + live activity, running once authenticated.
  useEffect(() => {
    if (!s.authed) return;
    const hub = setInterval(() => set((prev) => ({ hubTick: prev.hubTick + 1 })), 3200);
    let i = 0;
    const feed = setInterval(() => {
      const p = ACTIVITY_POOL[i % ACTIVITY_POOL.length];
      i++;
      set((prev) => ({ feedExtra: ([{ ...p, time: "now" }] as FeedItem[]).concat(prev.feedExtra).slice(0, 3) }));
    }, 9000);
    return () => { clearInterval(hub); clearInterval(feed); };
  }, [s.authed, set]);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  const value: Ctx = {
    s, set, agents, teams, byId,
    showToast, signedIn, logout, deleteAgent, togglePause, saveConfig, addTeamMembers, sendChat, createTeam, createAgent, quickCreateAgent, animateCount,
  };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
