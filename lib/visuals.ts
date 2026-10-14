// Visual helpers ported verbatim from v5: procedurally-generated SVG avatars,
// nav glyphs, and the inline-style-string builders for avatars/pills/chips.
import type { StatusMeta } from "./types";

export function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

// ---- character avatars ----
// Agents are drawn as the four illustrated characters from the redesign
// (public/agents/*.jpg: square head-and-shoulders portraits). Any agent maps to
// one of them; the circle is tinted with the agent's own colour so agents that
// share a character still read as different people.
export const AGENT_CHARS = [
  { key: "theo", src: "/agents/theo.jpg", label: "Theo" },
  { key: "pat", src: "/agents/pat.jpg", label: "Pat" },
  { key: "maya", src: "/agents/maya.jpg", label: "Maya" },
  { key: "sam", src: "/agents/sam.jpg", label: "Sam" },
];
// Deterministic character per agent: named seeds get a hand-matched figure; anyone
// else (agents created in the wizard) can carry an explicit `char`, else hash by id.
const SEED_CHAR: Record<string, number> = { sk: 2, mt: 0, ew: 1, rp: 3, al: 0, nc: 1, ps: 2, lm: 3 };
export function agentCharIndex(a: { id: string; char?: number }): number {
  if (typeof a.char === "number") return a.char % AGENT_CHARS.length;
  if (a.id in SEED_CHAR) return SEED_CHAR[a.id];
  return hashId(a.id) % AGENT_CHARS.length;
}
export function charSrc(i: number): string {
  return AGENT_CHARS[((i % AGENT_CHARS.length) + AGENT_CHARS.length) % AGENT_CHARS.length].src;
}

export function av(a: { id: string; color: string; char?: number }, size: number): string {
  return (
    "width:" + size + "px;height:" + size + "px;border-radius:50%;flex:none;overflow:hidden;background-color:" +
    a.color + "26;background-image:url('" + charSrc(agentCharIndex(a)) + "');background-repeat:no-repeat;" +
    "background-size:114%;background-position:center;color:transparent;display:flex;align-items:center;" +
    "justify-content:center;font-size:" + Math.round(size * 0.37) + "px;font-weight:700"
  );
}

export function statusPill(m: StatusMeta): string {
  return (
    "margin-left:auto;display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:600;color:" +
    m.color + ";background:" + m.bg + ";border-radius:99px;padding:3px 10px;flex:none"
  );
}

export function chip(bg: string, color: string): string {
  return "font-size:10.5px;font-weight:600;color:" + color + ";background:" + bg + ";border-radius:99px;padding:2px 9px;flex:none";
}

const NAV_PATHS: Record<string, string> = {
  compose: '<path d="M4 20.2h4.3L19.4 9.1a1.7 1.7 0 0 0 0-2.4l-2.1-2.1a1.7 1.7 0 0 0-2.4 0L3.8 15.7v4.5Z"/><rect x="12.5" y="18.7" width="8" height="1.6" rx=".8"/>',
  grid: '<rect x="3.5" y="3.5" width="7.4" height="7.4" rx="2"/><rect x="13.1" y="3.5" width="7.4" height="7.4" rx="2"/><rect x="3.5" y="13.1" width="7.4" height="7.4" rx="2"/><rect x="13.1" y="13.1" width="7.4" height="7.4" rx="2"/>',
  box: '<path d="M12 2.6 3.4 7v10L12 21.4l8.6-4.4V7Z"/><path d="M3.9 7.3 12 11.5l8.1-4.2M12 11.5v9.5" fill="none" stroke="#fff" stroke-width="1.4" stroke-opacity=".7"/>',
  search: '<path d="M10.6 3.6a7 7 0 1 0 4.3 12.5l4.4 4.4 1.4-1.4-4.4-4.4A7 7 0 0 0 10.6 3.6Zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z"/>',
  home: '<path d="M12 3.1 3.6 10.3a.8.8 0 0 0-.28.6V20a1 1 0 0 0 1 1H9.6v-5.4a1 1 0 0 1 1-1h2.8a1 1 0 0 1 1 1V21h5.28a1 1 0 0 0 1-1v-9.1a.8.8 0 0 0-.28-.6Z"/>',
  robot: '<rect x="5" y="4" width="14" height="8.4" rx="2.6"/><circle cx="9.4" cy="8.2" r="1.35" fill="#fff"/><circle cx="14.6" cy="8.2" r="1.35" fill="#fff"/><rect x="4" y="14.4" width="16" height="6.6" rx="3.1"/>',
  chat: '<path d="M11.6 4a8.3 8.3 0 1 0 4.2 15.5L20 20.7l-1.1-4.2A8.3 8.3 0 0 0 11.6 4Z"/><circle cx="8.8" cy="12" r="1.25" fill="#fff"/><circle cx="13.6" cy="12" r="1.25" fill="#fff"/><path d="M19.6 1.6l.9 1.9 1.9.9-1.9.9-.9 1.9-.9-1.9-1.9-.9 1.9-.9Z"/>',
  gear: '<path d="M12 8.5A3.5 3.5 0 1 0 12 15.5 3.5 3.5 0 0 0 12 8.5Zm8.6 5-1.9 1.1.1 2.2-2.2 1.3-1.9-1.2-2 .8-.7 2.1h-2.6l-.7-2.1-2-.8-1.9 1.2-2.2-1.3.1-2.2L1 13.5v-2.6l1.9-1.1-.1-2.2L5 6.3l1.9 1.2 2-.8.7-2.1h2.6l.7 2.1 2 .8L16.8 6.3 19 7.6l-.1 2.2 1.9 1.1Z"/>',
  logout: '<rect x="3" y="3" width="18" height="18" rx="4.5"/><path d="M11.2 7.6l4.4 4.4-4.4 4.4v-3.2H5.8v-2.4h5.4V7.6Z" fill="#fff"/>',
  panel: '<rect x="3.75" y="4.75" width="16.5" height="14.5" rx="2.5" fill="none" stroke="#667085" stroke-width="1.6"/><line x1="10" y1="4.75" x2="10" y2="19.25" stroke="#667085" stroke-width="1.6"/>',
  leads: '<path d="M8.5 11.2a3.1 3.1 0 1 0 0-6.2 3.1 3.1 0 0 0 0 6.2Zm0 1.7c-2.7 0-5.7 1.35-5.7 3.5V19h11.4v-2.6c0-2.15-3-3.5-5.7-3.5Zm7.3-1.7a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2Zm.5 1.75c-.35 0-.7.02-1.03.07 1 .77 1.63 1.83 1.63 3.18V19h4.3v-2.4c0-1.95-2.5-3.15-4.9-3.15Z"/>',
  calendar: '<rect x="3.5" y="5.5" width="17" height="15" rx="2.6"/><rect x="6.8" y="3" width="1.8" height="4" rx="0.9"/><rect x="15.4" y="3" width="1.8" height="4" rx="0.9"/><rect x="3.5" y="9.2" width="17" height="1.5" fill="#fff" fill-opacity="0.55"/><circle cx="8" cy="13.6" r="1.05" fill="#fff"/><circle cx="12" cy="13.6" r="1.05" fill="#fff"/><circle cx="16" cy="13.6" r="1.05" fill="#fff"/><circle cx="8" cy="17" r="1.05" fill="#fff"/><circle cx="12" cy="17" r="1.05" fill="#fff"/>',
};
export function navIcon(key: string, color: string): string {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="' + color + '">' + (NAV_PATHS[key] || "") + "</svg>";
  return (
    'width:22px;height:22px;flex:none;background-image:url("data:image/svg+xml,' +
    encodeURIComponent(svg) + '");background-size:contain;background-repeat:no-repeat;background-position:center'
  );
}
