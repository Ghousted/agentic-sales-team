import "server-only";
// The outreach engine: one structured LLM call per lead that qualifies
// (score + stage) and drafts personalized outreach — a formal email when the
// lead has an email, or a short platform DM when it only has a profile. Uses
// the lead's research brief when present. Pure — no DB.
import { aiJSON, isAIConfigured, type Turn } from "./openrouter";
import type { AgentSnapshot, OutreachResult, ResearchBrief } from "@/lib/leads/types";
import type { ProductDTO } from "@/lib/products/store";

const SCHEMA = {
  type: "object",
  properties: {
    score: { type: "integer" },
    stage: { type: "string", enum: ["new", "contacted", "engaged", "replied", "meeting"] },
    subject: { type: "string" },
    body: { type: "string" },
    rationale: { type: "string" },
  },
  required: ["score", "stage", "subject", "body", "rationale"],
} as const;

function systemPrompt(a: AgentSnapshot, channel: "email" | "dm", platform?: string | null): string {
  const lines = [
    `You are ${a.name}, an AI ${a.role} on a B2B sales team.`,
    `Your objective: ${a.goal}. Current focus: ${a.task}.`,
    `Given ONE prospect, do two things: (1) score their fit for your objective from 0 to 100 and pick the best pipeline stage, (2) write personalized outreach.`,
  ];
  if (channel === "email") {
    lines.push(`Write a FORMAL, professional cold EMAIL specific to the prospect's title and company, with a plausible business reason to reach out, aligned with your objective. Tone: courteous, polished business English written as a real person — complete sentences, no slang, no emojis, no exclamation marks, no hype. 90-140 words, plain text, first person as ${a.name}. Open with a courteous salutation using the prospect's actual first name (for example, "Dear Maria,"), and close with a professional sign-off on its own line followed by your name, ${a.name}. Never leave placeholder tokens like [Company] or [First Name] — use the real values or omit them; end with a clear but low-pressure call to action. Put a concise, specific subject line in "subject" and the email body in "body".`);
  } else {
    lines.push(`This prospect has no email — you will reach them by direct message on ${platform || "their platform"}. Write a SHORT, professional and courteous direct message (2-4 sentences), first person as ${a.name}, that opens politely, references something specific about them, and ends with a low-pressure ask. Natural and human, but professional — no slang, emojis, or exclamation marks; no formal letter salutation or signature. Put a one-line context label in "subject" and the message text in "body".`);
  }
  lines.push(`Return ONLY JSON matching the schema.`);
  return lines.join(" ");
}

export async function draftOutreach(
  agent: AgentSnapshot,
  lead: { name: string; title: string; company: string; email: string; platform?: string | null; research?: ResearchBrief | null },
  products?: ProductDTO[],
): Promise<OutreachResult> {
  const hasEmail = !!(lead.email && lead.email.trim());
  const channel: "email" | "dm" = hasEmail ? "email" : "dm";
  const first = lead.name.split(" ")[0] || "there";

  if (!isAIConfigured()) {
    if (hasEmail) {
      return { score: 60, stage: "contacted", subject: `An idea for ${lead.company || "your team"}`, body: `Dear ${first},\n\nI'm ${agent.name}, ${agent.role}. I work with ${lead.title ? lead.title + "s" : "leaders"} on ${agent.goal}, and I believe there may be a worthwhile opportunity for ${lead.company || "your team"}. Would you be open to a brief 15-minute call next week to explore it?\n\nKind regards,\n${agent.name}`, rationale: "Fallback draft (AI not configured)." };
    }
    return { score: 55, stage: "contacted", subject: `Message to ${first}`, body: `Hello ${first}, I'm ${agent.name}. I work on ${agent.goal}, and I came across your ${lead.title || "work"}${lead.company ? " at " + lead.company : ""}. I'd welcome the chance to have a brief conversation if you're open to it.`, rationale: "Fallback DM (AI not configured)." };
  }

  const researchBlock = lead.research
    ? `\n\nResearch brief (use these specifics to personalize):\nSummary: ${lead.research.summary}\nPriorities: ${(lead.research.priorities || []).join("; ")}\nHooks: ${(lead.research.hooks || []).join("; ")}\nRecommended angle: ${lead.research.angle}`
    : "";
  const productBlock = products && products.length
    ? `\n\nRelevant offerings (reference the fitting product + price when natural, don't hard-sell):\n` + products.map((p) => `- ${p.name}${p.price ? " (" + p.price + ")" : ""}${Object.entries(p.attributes ?? {}).map(([k, v]) => ` | ${k}: ${v}`).join("")}`).join("\n")
    : "";
  const contact = hasEmail ? `Email: ${lead.email}` : `Platform: ${lead.platform || "(unknown)"} (no email — direct message)`;
  const turns: Turn[] = [{
    role: "user",
    text: `Prospect:\nName: ${lead.name}\nTitle: ${lead.title || "(unknown)"}\nCompany: ${lead.company || "(unknown)"}\n${contact}${researchBlock}${productBlock}`,
  }];
  const r = await aiJSON<OutreachResult>(systemPrompt(agent, channel, lead.platform), turns, SCHEMA as unknown as Record<string, unknown>, { maxTokens: 700, temperature: 0.6 });
  return {
    score: typeof r.score === "number" ? r.score : 50,
    stage: r.stage || "contacted",
    subject: (r.subject || (hasEmail ? `Quick note for ${lead.company || "you"}` : `Message to ${first}`)).trim(),
    body: (r.body || "").trim(),
    rationale: (r.rationale || "").trim(),
  };
}
