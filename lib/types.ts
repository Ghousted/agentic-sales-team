// Shared domain types for the Agentic Sales Team app.

export type StatusKey = "working" | "waiting" | "offline" | "error";

export interface Agent {
  id: string;
  name: string;
  initials: string;
  role: string;
  color: string;
  status: StatusKey;
  task: string;
  score: number;
  goal: string;
  char?: number; // index into the character sprite (chosen in the create wizard)
  type: string;              // AGENT_TYPES id (e.g. "sdr", "scout", "custom")
  capabilities: string[];    // resolved capability ids this agent can run
}

export interface Team {
  id: string;
  name: string;
  icon: string;
  iconBg: string;
  desc: string;
  members: string[];
  meetings: number;
  pipeline: string;
  leads: number;
  goal: string;
  activity: string[];
  template: string;          // TEAM_TEMPLATES id
}

export interface ChatMsg {
  who: "me" | string;
  text: string;
}

export type Chats = Record<string, ChatMsg[]>;

export interface StatusMeta {
  label: string;
  bg: string;
  color: string;
  dot: string;
}
