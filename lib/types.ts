// Shared domain types for the Agentic Salesforce app.

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
}

export interface ChatMsg {
  who: "ai" | "me";
  text: string;
}

export type Chats = Record<string, ChatMsg[]>;

export interface StatusMeta {
  label: string;
  bg: string;
  color: string;
  dot: string;
}
