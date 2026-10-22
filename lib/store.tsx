"use client";
// Shared client store: ports the v5 component's state, derived data, actions,
// and lifecycle timers (count-up, hub tick, live activity feed) into a Context.
import React, { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Agent, Team, Chats } from "./types";
import { AGENTS_BASE, TEAMS_BASE, chatsInit } from "./data";
import { typeById } from "./agentTypes";
import { signOut as signOutAction } from "./auth/actions";
import { teamChat, reportTeamJob } from "./chat/actions";
import type { ThreadMsg } from "./chat/thread";
import { saveAgent, saveTeam, saveTeamMeta as saveTeamMetaAction, deleteTeam as deleteTeamAction, setAgentRemoved, setAgentPaused, clearMessages, saveAgentConfig as saveAgentConfigAction, saveTeamMembers as saveTeamMembersAction, type WorkspaceData, type AgentConfig } from "./workspace/actions";

// Ticked ids in the create-team modal that are still real agents. A stale id
// (a deleted agent, or a leftover default) is neither counted nor saved.
export function selectedMembers(tSel: Record<string, boolean>, agents: Pick<Agent, "id">[]): string[] {
  return agents.filter((a) => tSel[a.id]).map((a) => a.id);
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
  // Logged-out visitors see the marketing Landing first; the auth screen only
  // takes over once they choose Get started / Sign in (showAuth flips true).
  showAuth: boolean;
  authMode: "login" | "signup";
  sidebarOpen: boolean;
  chats: Chats;
  convId: string;
  chatInput: string;
  chatAwaiting: Record<string, number>; // teamId → sends still waiting on teamChat (shows typing dots)
  chatLeadPicks: { id: string; name: string }[];
  hubTick: number;
  countT: number;
  hubTeam: string;
  toast: string;
  toastError: boolean; // the toast reports a failure (shown with ✕, not ✓)
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
  chats: chatsInit(), convId: "sk", chatInput: "", chatAwaiting: {}, chatLeadPicks: [],
  hubTick: 0, countT: 1, hubTeam: "all",
  toast: "", toastError: false, paused: {}, removed: {}, agentConfig: {}, teamMembers: {}, extraAgents: [], extraTeams: [],
  search: "",
  showTeamModal: false, tName: "", tIcon: "🚀", tGoal: "", tSel: {}, tTemplate: "custom", tGapName: {},
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
  showError: (msg: string) => void;
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
  clearChat: (convId: string) => Promise<number>;
  // The open chat page registers its thread fetch here so a send can pull the
  // stored replies right away instead of waiting for the next poll tick.
  registerThreadPoll: (teamId: string, poll: (() => Promise<void>) | null) => void;
  // Creation waits for the server save: the id once it's stored, null if it failed
  // (the user has been told) or another create is still in flight.
  createTeam: () => Promise<string | null>;
  createAgent: () => Promise<void>;
  quickCreateAgent: (typeId: string, name: string) => Promise<string | null>;
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

/** Save a change the UI already shows. If the save fails, undo the change and
 *  tell the user, so the screen never shows something the server doesn't have.
 *  Resolves to whether the save stuck. */
export async function persistOrRollback(
  save: () => Promise<unknown>,
  rollback: () => void,
  onError: (e: unknown) => void,
): Promise<boolean> {
  try {
    await save();
    return true;
  } catch (e) {
    rollback();
    onError(e);
    return false;
  }
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

  const toastFor = useCallback((msg: string, error: boolean) => {
    set({ toast: msg, toastError: error });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => set({ toast: "", toastError: false }), error ? 4500 : 2600);
  }, [set]);
  const showToast = useCallback((msg: string) => toastFor(msg, false), [toastFor]);
  const showError = useCallback((msg: string) => toastFor(msg, true), [toastFor]);

  // Persist a change already applied locally; on failure undo it and say so.
  const persist = useCallback(
    (tag: string, failMsg: string, save: () => Promise<unknown>, rollback: () => void) =>
      persistOrRollback(save, rollback, (e) => { console.error("[" + tag + "] persist failed:", e); showError(failMsg); }),
    [showError],
  );

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
    const was = !!sRef.current.removed[id];
    set((prev) => ({ removed: { ...prev.removed, [id]: true } }));
    if (a) showToast(a.name + " deleted");
    persist("deleteAgent", "Couldn't delete " + (a?.name ?? "the agent") + ". Please try again.",
      () => setAgentRemoved(id, true),
      () => set((prev) => ({ removed: { ...prev.removed, [id]: was } })));
  }, [agents, set, showToast, persist]);

  // Delete a user-CREATED team (removes it from local state + the DB row). Seed
  // teams (TEAMS_BASE) aren't in extraTeams, so the UI only offers delete on created ones.
  const deleteTeam = useCallback((teamId: string) => {
    const t = sRef.current.extraTeams.find((x) => x.id === teamId);
    const override = sRef.current.teamMembers[teamId];
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
    persist("deleteTeam", "Couldn't delete " + (t?.name ?? "the team") + ". Please try again.",
      () => deleteTeamAction(teamId),
      () => set((prev) => ({
        extraTeams: t && !prev.extraTeams.some((x) => x.id === teamId) ? prev.extraTeams.concat([t]) : prev.extraTeams,
        teamMembers: override ? { ...prev.teamMembers, [teamId]: override } : prev.teamMembers,
      })));
  }, [set, showToast, persist]);

  const togglePause = useCallback((id: string) => {
    const a = agents.find((x) => x.id === id);
    const next = !sRef.current.paused[id];
    set((prev) => ({ paused: { ...prev.paused, [id]: next } }));
    if (a) showToast(a.name + (next ? " paused" : " resumed"));
    persist("togglePause", "Couldn't " + (next ? "pause " : "resume ") + (a?.name ?? "the agent") + ". Please try again.",
      () => setAgentPaused(id, next),
      () => set((prev) => ({ paused: { ...prev.paused, [id]: !next } })));
  }, [agents, set, showToast, persist]);

  const saveConfig = useCallback((id: string, cfg: AgentConfig) => {
    // Merge (don't overwrite) so saving one facet (role/goal/permissions from the
    // Config tab, or settings) never drops the others from the in-memory store,
    // mirroring saveAgentConfig's partial upsert on the DB side.
    const before = sRef.current.agentConfig[id];
    set((prev) => ({ agentConfig: { ...prev.agentConfig, [id]: { ...prev.agentConfig[id], ...cfg } } }));
    showToast("Configuration saved");
    persist("saveConfig", "Couldn't save the configuration. Please try again.",
      () => saveAgentConfigAction(id, cfg),
      () => set((prev) => {
        const agentConfig = { ...prev.agentConfig };
        if (before) agentConfig[id] = before; else delete agentConfig[id];
        return { agentConfig };
      }));
  }, [set, showToast, persist]);

  // Undo a team member change: put back the override the team had before.
  const restoreMembers = useCallback((teamId: string, override: string[] | undefined) => set((prev) => {
    const teamMembers = { ...prev.teamMembers };
    if (override) teamMembers[teamId] = override; else delete teamMembers[teamId];
    return { teamMembers };
  }), [set]);

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
    persist("addTeamMembers", "Couldn't add agents to " + base.name + ". Please try again.",
      () => saveTeamMembersAction(teamId, merged),
      () => restoreMembers(teamId, st.teamMembers[teamId]));
  }, [set, showToast, persist, restoreMembers]);

  // Edit a team's meta (name, icon, goal). Only user-created teams live in
  // extraTeams, so this maps over that list and persists just the changed fields.
  const updateTeam = useCallback((teamId: string, patch: { name?: string; icon?: string; goal?: string }) => {
    const meta: Partial<Team> = {};
    if (patch.name !== undefined) meta.name = patch.name.trim() || "New Team";
    if (patch.goal !== undefined) meta.goal = patch.goal.trim() || "Define a shared goal for this team.";
    if (patch.icon !== undefined) { meta.icon = patch.icon; meta.iconBg = TEAM_ICON_BG[patch.icon] || "#EAF2FF"; }
    if (Object.keys(meta).length === 0) return;
    const old = sRef.current.extraTeams.find((t) => t.id === teamId);
    const undo: Partial<Team> = {};
    if (old) for (const k of Object.keys(meta) as (keyof Team)[]) (undo as Record<string, unknown>)[k] = old[k];
    set((prev) => ({ extraTeams: prev.extraTeams.map((t) => (t.id === teamId ? { ...t, ...meta } : t)) }));
    const display = meta.name ?? TEAMS_BASE.concat(sRef.current.extraTeams).find((t) => t.id === teamId)?.name ?? "Team";
    showToast("“" + display + "” updated");
    persist("updateTeam", "Couldn't update “" + display + "”. Please try again.",
      () => saveTeamMetaAction(teamId, meta),
      () => set((prev) => ({ extraTeams: prev.extraTeams.map((t) => (t.id === teamId ? { ...t, ...undo } : t)) })));
  }, [set, showToast, persist]);

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
    persist("removeTeamMember", "Couldn't remove " + agentName + " from " + base.name + ". Please try again.",
      () => saveTeamMembersAction(teamId, next),
      () => restoreMembers(teamId, st.teamMembers[teamId]));
  }, [agents, set, showToast, persist, restoreMembers]);

  // Clear one conversation: empty it locally and delete its persisted messages.
  // Resolves to the highest id deleted, so the chat poll never re-shows them.
  const clearChat = useCallback(async (convId: string): Promise<number> => {
    set((prev) => ({ chats: { ...prev.chats, [convId]: [] } }));
    try { return await clearMessages(convId); }
    catch (e) { console.error("[clearChat] delete failed:", e); return 0; }
  }, [set]);

  const threadPolls = useRef(new Map<string, () => Promise<void>>());
  const registerThreadPoll = useCallback((teamId: string, poll: (() => Promise<void>) | null) => {
    if (poll) threadPolls.current.set(teamId, poll); else threadPolls.current.delete(teamId);
  }, []);
  const pullThread = useCallback(async (teamId: string) => {
    try { await threadPolls.current.get(teamId)?.(); } catch { /* the next poll tick retries */ }
  }, []);

  // Team chat. The server stores the user's message and every agent reply
  // (teamChat, the pod chain, reportTeamJob); the chat page renders the stored
  // thread in id order. Here the message shows at once as a local row until its
  // stored copy arrives, and only a notice the server never saw (a failed
  // request) stays local-only.
  const sendTeamChat = useCallback((teamId: string, text: string, leadIds?: string[]) => {
    const t = (text || "").trim();
    if (!t) return;
    const addLocal = (who: string, text: string) => {
      const m: ThreadMsg = { who, text, local: true };
      set((prev) => ({ chats: { ...prev.chats, [teamId]: (prev.chats[teamId] || []).concat([m]) } }));
    };
    const awaiting = (d: number) => set((prev) => ({ chatAwaiting: { ...prev.chatAwaiting, [teamId]: Math.max(0, (prev.chatAwaiting[teamId] ?? 0) + d) } }));
    addLocal("me", t);
    set({ chatInput: "", chatLeadPicks: [] });
    awaiting(1);

    teamChat(teamId, t, leadIds, Intl.DateTimeFormat().resolvedOptions().timeZone).then(async (res) => {
      // Fetch the stored replies before dropping the dots, so the typing
      // indicator hands straight over to the reveal.
      await pullThread(teamId);
      awaiting(-1);
      // A reply with no id wasn't stored (for example, "Not signed in."). Show it locally.
      for (const m of res.messages as ThreadMsg[]) if (m.id === undefined) addLocal(m.who, m.text);
      if (!res.job) return;
      const job = res.job;
      if (job.kind === "scrape") {
        // The scrape route runs it now (the cron runs it if this tab closes); a
        // finished pod scrape is narrated by the chain, a failed one by reportTeamJob.
        try { await fetch("/api/scrape", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: job.id }) }); } catch { /* the cron picks it up */ }
        try { await fetch("/api/jobs/run", { method: "POST" }); } catch { /* best-effort */ }
        try { await reportTeamJob(teamId, job.id); } catch { /* best-effort */ }
        await pullThread(teamId);
        return;
      }
      // research / outreach / …: the per-minute cron (/api/cron/jobs) runs the job
      // even if this tab closes; kicking the runner here only starts it sooner.
      // reportTeamJob posts the outcome once the job ends, then the thread shows it.
      try { await fetch("/api/jobs/run", { method: "POST" }); } catch { /* best-effort */ }
      let waited = 0;
      let slow = 0; // polls after "still working": the cron may take a few minutes
      const poll = async (): Promise<void> => {
        let status: string | null;
        try { status = await reportTeamJob(teamId, job.id); }
        catch { if (slow > 0) { if (++slow <= 40) setTimeout(poll, 15_000); return; } if (waited >= 40) { addLocal("system", "I've lost track of that run. Please check the agent's page."); return; } waited++; setTimeout(poll, 2500); return; }
        if (!status) return;
        if (status === "done" || status === "failed") { await pullThread(teamId); return; }
        if (waited >= 40) {
          if (slow === 0) addLocal("system", "Still working on it in the background. The result will appear here when it's done.");
          if (++slow > 40) return; // ~10 more minutes; the agent's page shows the result after that
          setTimeout(poll, 15_000);
          return;
        }
        waited++;
        setTimeout(poll, 2500);
      };
      poll();
    }).catch(async () => {
      // The message may or may not have been stored; the thread fetch shows what was.
      await pullThread(teamId);
      awaiting(-1);
      addLocal("system", "I'm sorry. I could not process that now.");
    });
  }, [set, pullThread]);

  // Creates wait for the server to store the row before the agent/team appears:
  // chat and jobs look agents and teams up server-side, so one the server never
  // stored would look fine here but fail everywhere else. The flag stops a double
  // click from creating twice while the save is in flight.
  const creating = useRef(false);

  const createTeam = useCallback(async (): Promise<string | null> => {
    if (creating.current) return null;
    const cur = sRef.current;
    const name = cur.tName.trim() || "New Team";
    const members = selectedMembers(cur.tSel, agents);
    const id = "tx" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const team: Team = {
      id, name, icon: cur.tIcon, iconBg: TEAM_ICON_BG[cur.tIcon] || "#EAF2FF",
      desc: members.length + " agents · just created", members, meetings: 0, pipeline: "-", leads: 0,
      goal: cur.tGoal.trim() || "Define a shared goal for this team.",
      activity: ["Team created. Agents are onboarding.", "Shared goal set"],
      template: cur.tTemplate || "custom",
    };
    creating.current = true;
    try { await saveTeam(team); }
    catch (e) {
      console.error("[createTeam] persist failed:", e);
      showError("Couldn't create " + name + ". Please try again.");
      return null;
    }
    finally { creating.current = false; }
    set((prev) => ({ extraTeams: prev.extraTeams.concat([team]), showTeamModal: false, tName: "", tGoal: "", tSel: {}, tTemplate: "custom", tGapName: {} }));
    showToast(name + " created");
    return id;
  }, [agents, set, showToast, showError]);

  const createAgent = useCallback(async () => {
    if (creating.current) return;
    const cur = sRef.current;
    const name = cur.wName.trim() || "New Agent";
    const initials = name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
    const id = "x" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const at = typeById(cur.wType) ;
    const capabilities = at?.custom ? cur.wCapabilities : (at?.capabilities ?? []);
    const agent: Agent = {
      id, name, initials, role: at?.label ?? "Custom", color: cur.wColor, status: "working",
      task: "Onboarding: configuring capabilities", score: 75,
      goal: cur.wGoals.split(".")[0] || "Ramp up in week 1",
      char: cur.wCharacter,
      type: cur.wType, capabilities,
    };
    creating.current = true;
    try { await saveAgent(agent); }
    catch (e) {
      // Stay on the last wizard step so the user can try again.
      console.error("[createAgent] persist failed:", e);
      showError("Couldn't create " + name + ". Please try again.");
      creating.current = false;
      return;
    }
    // The agent is stored; settings are a separate row. If they fail the agent
    // still exists, so keep it and say the settings need saving again.
    let settingsSaved = true;
    if (Object.keys(cur.wSettings).length) {
      try { await saveAgentConfigAction(id, { settings: cur.wSettings }); }
      catch (e) { console.error("[createAgent] settings persist failed:", e); settingsSaved = false; }
    }
    creating.current = false;
    // 5 input steps (0-4); step 5 is the "agent is live" success screen.
    set((prev) => ({
      extraAgents: prev.extraAgents.concat([agent]), wStep: 5, wCreatedId: id,
      agentConfig: settingsSaved && Object.keys(cur.wSettings).length
        ? { ...prev.agentConfig, [id]: { ...prev.agentConfig[id], settings: cur.wSettings } }
        : prev.agentConfig,
    }));
    if (!settingsSaved) showError(name + " was created, but its settings weren't saved. Set them again on the agent's page.");
  }, [set, showError]);

  const quickCreateAgent = useCallback(async (typeId: string, name: string): Promise<string | null> => {
    const at = typeById(typeId);
    const id = "x" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const nm = name.trim() || (at?.label ?? "Agent");
    const initials = nm.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
    const agent: Agent = {
      id, name: nm, initials, role: at?.label ?? "Custom", color: "#006AFF", status: "working",
      task: "Onboarding", score: 75, goal: "Ramp up in week 1",
      type: typeId, capabilities: at?.capabilities ?? [],
    };
    try { await saveAgent(agent); }
    catch (e) {
      console.error("[quickCreateAgent] persist failed:", e);
      showError("Couldn't create " + nm + ". Please try again.");
      return null;
    }
    set((prev) => ({ extraAgents: prev.extraAgents.concat([agent]) }));
    return id;
  }, [set, showError]);

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
    showToast, showError, signedIn, logout, deleteAgent, deleteTeam, togglePause, saveConfig, addTeamMembers, updateTeam, removeTeamMember, sendTeamChat, clearChat, registerThreadPoll, createTeam, createAgent, quickCreateAgent, animateCount,
  };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
