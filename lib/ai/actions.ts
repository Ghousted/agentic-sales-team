"use server";
// Chat reply server action: an agent responds in-character via Gemini.
// Falls back to the built-in scripted reply when Gemini isn't configured or errors.
import { geminiGenerate, isGeminiConfigured, type Turn } from "./gemini";
import { aiReply } from "@/lib/data";

export interface ChatAgent {
  name: string;
  role: string;
  goal: string;
  task: string;
}
export interface ChatMsgIn {
  who: "ai" | "me";
  text: string;
}

function systemPrompt(a: ChatAgent): string {
  return [
    `You are ${a.name}, an autonomous AI sales agent working as a ${a.role} on the user's AI sales team.`,
    `Your current objective: ${a.goal}.`,
    `Right now you are: ${a.task}.`,
    `The user is your manager checking in. Reply in first person as ${a.name}.`,
    `Be concise (2–4 sentences), concrete, and action-oriented — reference realistic prospects, metrics, and next steps for a B2B sales workflow.`,
    `Never mention that you are a language model; stay in character as the sales agent.`,
  ].join(" ");
}

/** Generate an agent's reply. `history` is prior turns (excluding the new message). */
export async function chatReply(input: { agent: ChatAgent; history: ChatMsgIn[]; message: string }): Promise<string> {
  const { agent, history, message } = input;
  if (!isGeminiConfigured()) {
    return aiReply(message, agent);
  }
  try {
    const turns: Turn[] = history.map((m) => ({ role: m.who === "me" ? "user" : "model", text: m.text }));
    turns.push({ role: "user", text: message });
    return await geminiGenerate(systemPrompt(agent), turns);
  } catch (e) {
    console.error("[chatReply] Gemini failed, using fallback:", e);
    return aiReply(message, agent);
  }
}
