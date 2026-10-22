import "server-only";
// A real, in-character conversational reply for the team chat: used when a
// message is a question or small talk (intent = chat/unknown) rather than a
// command. The responding agent answers with knowledge of its own persona, its
// teammates, and what the platform can do — so "how do you assess leads?" or
// "how do you guys scrape the web?" get real answers, not a canned line.
// When AI isn't configured or the call fails it says so plainly, rather than
// passing a canned line off as an answer.
import { aiGenerate, isAIConfigured, type Turn } from "@/lib/ai/openrouter";
import { CAPABILITIES } from "@/lib/agentTypes";

interface Responder { id: string; name: string; role: string; goal: string; task: string; capabilities: string[] }
interface RosterMember { id: string; name: string; capabilities: string[] }
interface HistMsg { who: string; text: string }

const COMMANDS = `Direct requests still work — for example "book a meeting", "draft outreach" or "any updates?".`;
export const AI_NOT_CONFIGURED = `I can't answer questions right now: AI isn't configured on this workspace (OPENROUTER_API_KEY). ${COMMANDS}`;
export const AI_FAILED = `I couldn't answer that — the AI service didn't respond. Please try again in a moment. ${COMMANDS}`;

const capLabel = (id: string) => CAPABILITIES.find((c) => c.id === id)?.label ?? id;

function systemPrompt(responder: Responder, roster: RosterMember[]): string {
  const mine = responder.capabilities.map(capLabel).join(", ") || "no specialized capabilities";
  const team = roster
    .map((m) => `- ${m.name}: ${m.capabilities.map(capLabel).join(", ") || "coordination only"}`)
    .join("\n");
  const platform = CAPABILITIES.map((c) => `- ${c.label}: ${c.desc}`).join("\n");
  return [
    `You are ${responder.name}, an autonomous AI sales agent working as a ${responder.role} on the user's AI sales team inside a B2B sales platform.`,
    `Your objective: ${responder.goal}. Right now you are: ${responder.task}.`,
    `Your own capabilities: ${mine}.`,
    ``,
    `Your teammates and what each can do:`,
    team,
    ``,
    `What the platform's agents can do, and how the team works:`,
    platform,
    ``,
    `The user (your manager) is asking a question or making conversation — this is NOT a command to run a task. Answer it helpfully and in character:`,
    `- If asked how you or the team does something (how leads are assessed, how prospects are found, etc.), explain the actual approach clearly, grounded in the capabilities above.`,
    `- If the topic is a teammate's specialty, explain it and name the teammate who owns it (e.g. "our Scout finds prospects by...").`,
    `- Stay on sales, prospecting, and how this team and platform work. If asked something unrelated, briefly steer back to how you can help with sales.`,
    `- When your answer naturally leads to an action you can take, offer it as a short question at the end (e.g. "Want me to review your pending leads now?").`,
    `- Do not give the user interface instructions (which button to press, which tab, screen, or menu to open) or bracketed "for example" lists. Say what you'll do or what's ready, not where to click.`,
    `Speak like a real, professional colleague: natural, articulate, and concise (2–4 sentences). No emojis, slang, hype, or exclamation marks. Never say you are a language model; stay in character as ${responder.name}.`,
  ].join("\n");
}

/** Recent thread → LLM turns: user = "me", agents/system = the model side.
 *  Drops system lines, drops leading model turns, and merges adjacent same-role
 *  turns (a team thread has many consecutive agent messages) so the transcript
 *  is user-led and well-formed for the API. */
function toTurns(history: HistMsg[]): Turn[] {
  const out: Turn[] = [];
  for (const m of history) {
    if (!m.text || m.who === "system") continue;
    const role: Turn["role"] = m.who === "me" ? "user" : "model";
    if (!out.length && role === "model") continue;
    const last = out[out.length - 1];
    if (last && last.role === role) last.text += "\n" + m.text;
    else out.push({ role, text: m.text });
  }
  return out;
}

export async function converse(input: {
  responder: Responder;
  roster: RosterMember[];
  history: HistMsg[];
  message: string;
}): Promise<string> {
  const { responder, roster, history, message } = input;
  if (!isAIConfigured()) return AI_NOT_CONFIGURED;
  try {
    const turns = toTurns(history.slice(-10));
    const last = turns[turns.length - 1];
    // The client persists the user's message before this runs, so it may already
    // be the last history turn — don't append it twice.
    if (!last || last.role !== "user" || last.text !== message) {
      turns.push({ role: "user", text: message });
    }
    return await aiGenerate(systemPrompt(responder, roster), turns);
  } catch (e) {
    console.error("[converse] AI call failed:", e);
    return AI_FAILED;
  }
}
