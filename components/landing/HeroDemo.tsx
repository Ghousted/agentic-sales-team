"use client";
// The landing hero's "live product demo": a scripted, looping walkthrough of a
// miniature copy of the app (sidebar, home composer, threads and cards), ported
// from the "Agentic Salesforce Demo" Claude Design file. A cursor clicks
// through each chapter while a camera zooms the chat column; chapter cards,
// a top progress bar and pause/restart/jump controls frame it. Rendered at a
// fixed 1440x860 (or 420x760 on phones) and scaled by the hero.
import { useCallback, useEffect, useRef, useState } from "react";
import { css } from "../primitives";
import { AG, avBg, type AgentId } from "./data";

/* ---------------- script data ---------------- */
const CHAPTERS: { agent: AgentId; title: string; sub: string; dur: number }[] = [
  { agent: "theo", title: "Ask in plain English", sub: "Tell Theo who you want. He *researches* *every* *lead* and shows his sources.", dur: 22 },
  { agent: "priya", title: "You make the close calls", sub: "Pat scores every lead and asks you only about the *close* *calls.*", dur: 10 },
  { agent: "maya", title: "Nothing sends without your yes", sub: "Maya writes every first email. *You* *approve* before anything sends.", dur: 9 },
  { agent: "maya", title: "Replies handled in chat", sub: "A prospect writes back. Maya *drafts* *the* *answer* from your approved pages.", dur: 8 },
  { agent: "sam", title: "Problems come to you first", sub: "An email bounces? Sam *pauses* *right* *away* and tells you how to fix it.", dur: 8 },
];
const ROLE: Record<AgentId, string> = { theo: "Lead research", priya: "Lead qualification", maya: "Sales development", sam: "Follow-ups" };
const FIRST: Record<AgentId, string> = { theo: "Theo", priya: "Pat", maya: "Maya", sam: "Sam" };
const ASK = "Find 25 finance leaders at 50–500 person companies in the US";

const QROWS = [
  { id: "q1", name: "Leah Kim", title: "Head of Finance", company: "Cobalt Freight", score: 67, why: "Right title. The company has 340 people, just above your range." },
  { id: "q2", name: "Nora Lindqvist", title: "Controller", company: "Brightpath Dental", score: 64, why: "Good fit on size. No sign they close in spreadsheets." },
  { id: "q3", name: "Ana Ruiz", title: "Accounting Lead", company: "Fieldnote", score: 61, why: "Fits on size. Title is one level below finance leadership." },
  { id: "q4", name: "Sam Patel", title: "Finance Manager", company: "Orchard Labs", score: 58, why: "Based in the UK. Your criteria say US or Canada." },
  { id: "q5", name: "Victor Hughes", title: "VP Finance", company: "Pallet & Co", score: 52, why: "Right title, but they recently signed with a competitor." },
];
// [text, highlight?] — 1 = from lead research, 2 = unverified claim
type Seg = [string, number?];
const DRAFTS: { id: string; name: string; company: string; subject: string; seg: Seg[]; flagged?: boolean; tint: [string, string] }[] = [
  { id: "d1", name: "Aisha Rahman", company: "Controller, Quillstack", subject: "Month-end at Quillstack", tint: ["#e6f0ff", "#0b57d0"], seg: [["Hi Aisha,\n\n"], ["Saw Quillstack opened a second office in Austin", 1], [". That’s usually when month-end starts to drag: more cards, more receipts, more people to chase.\n\nWorth a 20-minute look next week?"]] },
  { id: "d2", name: "Jonah Reyes", company: "VP Finance, Harborline", subject: "Closing the books at Harborline", tint: ["#fde7ef", "#a3245a"], seg: [["Hi Jonah,\n\n"], ["Congrats on Harborline’s Series B", 1], [". Finance teams often tell us close gets harder right after a raise.\n\nOpen to a 20-minute look next week?"]] },
  { id: "d3", name: "Tom Okafor", company: "Finance Lead, Redwood Freight", subject: "Receipts at Redwood Freight", tint: ["#fff1e0", "#9a5800"], seg: [["Hi Tom,\n\n"], ["With drivers spending on cards across 6 states", 1], [", chasing receipts is probably a big part of your month.\n\nWould a quick walkthrough be useful?"]] },
  { id: "d5", name: "Daniel Cho", company: "VP Finance, Kestrel Health", subject: "Month-end at Kestrel Health", flagged: true, tint: ["#e5f6f8", "#0e6f7a"], seg: [["Hi Daniel,\n\n"], ["As VP Finance at a 180-person company", 1], [", you’re probably closing with more spreadsheets than you’d like.\n\n"], ["Tallyroom is trusted by 500+ finance teams. ", 2], ["Open to a short call next week?"]] },
];
const RESEARCH_STEPS: Work["steps"] = [
  { t: "Searching for “Find 25 finance leaders at 50–500…”", d: "Looking for VP Finance and Controller roles at 50 to 500 person companies…", src: [["icon-globe", "Brightloop · Leadership team", "brightloop.com"], ["icon-globe", "Glasshouse AI · About us", "glasshouse.ai"], ["icon-globe", "Fernway Logistics · Team", "fernway.co"], ["icon-globe", "Cobalt Freight · Company", "cobaltfreight.com"], ["icon-globe", "Tidewater Labs · People", "tidewaterlabs.io"]] },
  { t: "Checking recent news for 18 companies", d: "Funding rounds, new finance hires and ERP changes…", src: [["icon-newspaper", "Brightloop raises $40M Series B", "Sep 30"], ["icon-newspaper", "Glasshouse AI moves to NetSuite", "Sep 18"]] },
  { t: "Finding and verifying work emails", d: "18 of 18 addresses verified. 2 duplicates removed." },
  { t: "Saving them to Leads", d: "Marked as Researched so Pat can score them." },
];
const PLAN_STEPS = ["Search for companies that match your ideal customer", "Find the finance lead at each company", "Check emails and remove duplicates", "Add them to Leads as Researched"];

/* ---------------- state types ---------------- */
interface Work { steps: { t: string; d?: string; src?: [string, string, string][] }[]; shown: number; done: boolean; open: boolean; secs?: number }
interface Msg { k: string; you?: string; a?: string; rev?: number; time?: string; work?: Work; card?: "plan" | "qualify" | "drafts" | "thread" | "suggest" | "bounce" }
interface Thread {
  id: string; title: string; agent: AgentId; dot: boolean; typing?: boolean; msgs: Msg[];
  plan?: { run: number }; picks?: Record<string, "yes" | "no" | undefined>; qDone?: boolean;
  drafts?: Record<string, "pending" | "sending" | "sent">; sugg?: "open" | "sending" | "sent"; bounce?: "open" | "sending" | "done";
}
let kk = 0;
const key = () => "m" + ++kk;
const A = (a: string, time = ""): Msg => ({ k: key(), a, rev: a.length, time });
const initThreads = (): Thread[] => [
  { id: "t-drafts", title: "Approve 4 first emails", agent: "maya", dot: true, drafts: Object.fromEntries(DRAFTS.map((d) => [d.id, "pending"])), msgs: [A("I drafted first emails for 4 leads in Q4 finance leaders. Nothing sends until you approve it.", "9:38 AM"), A("One of them says Tallyroom is “trusted by 500+ finance teams”. I couldn’t find that in your approved sources, so I flagged it."), { k: key(), card: "drafts" }] },
  { id: "t-dana", title: "Dana Whitfield replied", agent: "maya", dot: true, sugg: "open", msgs: [A("Dana Whitfield, VP Finance at Brightloop, replied to my first email. She’s interested and wants pricing and a couple of times next week. I stopped her 2 scheduled follow-ups.", "9:30 AM"), { k: key(), card: "thread" }, A("Here’s a reply I drafted. The pricing link comes from your approved Pricing page."), { k: key(), card: "suggest" }] },
  { id: "t-qualify", title: "5 borderline leads to review", agent: "priya", dot: true, picks: {}, msgs: [A("I scored 25 researched leads. 18 are a good fit and 2 aren’t. These 5 landed in between, so I’d like your call before passing them to Maya.", "9:36 AM"), { k: key(), card: "qualify" }] },
  { id: "t-bounce", title: "Email to Owen Pryce bounced", agent: "sam", dot: true, bounce: "open", msgs: [A("My email to Owen Pryce at Tidewater Labs bounced because the mailbox doesn’t exist, so I paused his follow-ups. Their team page lists a different address.", "9:17 AM"), { k: key(), card: "bounce" }] },
  { id: "t-hana", title: "Hana Sato asked about NetSuite", agent: "maya", dot: true, msgs: [A("Hana Sato asked whether Tallyroom works with NetSuite. Your Integrations page says it does, so I drafted a short answer.", "9:04 AM")] },
  { id: "t-research", title: "Researching 25 new leads", agent: "theo", dot: false, msgs: [A("I’m researching the 25 leads from the Q4 import: company size, recent news and the right finance contact.", "9:40 AM")] },
  { id: "t-report", title: "Morning summary: Q4 finance leaders", agent: "maya", dot: false, msgs: [A("Here’s where Q4 finance leaders stands this morning.", "9:00 AM")] },
];
const SLIDES = [
  { title: "5 borderline leads to review", sub: "Pat would like your call on 5 leads that scored between 50 and 70.", rows: ["priya", "maya", "theo"] as AgentId[], alert: false },
  { title: "Dana Whitfield replied", sub: "Maya drafted an answer with pricing and two times next week.", rows: ["maya", "maya", "priya"] as AgentId[], alert: false },
  { title: "An email bounced", sub: "Sam paused follow-ups to Owen Pryce and found a new address.", rows: ["sam", "theo", "sam"] as AgentId[], alert: true },
];

/* words with highlighted phrases (*word*), as in the design's dWords */
function words(text: string, start: number, dark: boolean) {
  const parts: { em: boolean; t: string }[] = [];
  text.split(" ").forEach((w) => { const em = w.startsWith("*"), t = w.replace(/\*/g, ""), prev = parts[parts.length - 1]; if (prev && em && prev.em) prev.t += " " + t; else parts.push({ em, t }); });
  if (parts.length > 2) { const a = parts[parts.length - 2], b = parts[parts.length - 1]; if (a.em === b.em) { a.t += " " + b.t; parts.pop(); } }
  return parts.map((p, i) => {
    const d = start + i * 0.055;
    return (
      <span key={i} style={{ display: "inline-block", marginRight: ".26em", whiteSpace: "nowrap", fontWeight: p.em ? 600 : "inherit", color: p.em ? (dark ? "#ffffff" : "#0047b3") : "inherit", backgroundImage: "linear-gradient(" + (p.em ? (dark ? "rgba(255,255,255,.22)" : "rgba(0,106,255,.14)") : "transparent") + "," + (p.em ? (dark ? "rgba(255,255,255,.22)" : "rgba(0,106,255,.14)") : "transparent") + ")", backgroundRepeat: "no-repeat", backgroundPosition: "0 88%", backgroundSize: "0% 100%", padding: "0 .04em", animation: "dWord .5s cubic-bezier(.2,.8,.2,1) backwards" + (p.em ? ",dMark .45s cubic-bezier(.65,0,.35,1) forwards" : ""), animationDelay: d.toFixed(3) + "s" + (p.em ? "," + (d + 0.35).toFixed(3) + "s" : "") }}>{p.t}</span>
    );
  });
}

const Av = ({ id, size, ring }: { id: AgentId; size: number; ring?: string }) => (
  <span aria-hidden="true" style={{ width: size, height: size, flex: "none", borderRadius: "50%", background: avBg(id), boxShadow: ring }} />
);
const Spin = ({ c = "#0b57d0", b = "#c6d9f7", s = 11 }: { c?: string; b?: string; s?: number }) => <span style={{ width: s, height: s, borderRadius: "50%", border: "1.5px solid " + b, borderTopColor: c, animation: "cSpin .8s linear infinite", flex: "none" }} />;
const CARD = "border:1px solid #e6e9ee;border-radius:18px;overflow:hidden;background:#ffffff;box-shadow:0 1px 2px rgba(16,20,24,.04),0 12px 30px -22px rgba(16,20,24,.25);animation:cUp .3s ease-out backwards";
const CARD_HEAD = "display:flex;align-items:center;gap:10px;min-height:50px;padding:0 16px;border-bottom:1px solid #f0f2f5";
const CARD_FOOT = "display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 16px;border-top:1px solid #f0f2f5;background:#fafbfc";
const BTN_DARK = "height:34px;padding:0 16px;border:0;border-radius:999px;background:#101418;color:#ffffff;font-size:14px;font-weight:500;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;transition:background .12s,transform .1s";
const BTN_LIGHT = "height:34px;padding:0 14px;border:1px solid #d9dee5;border-radius:999px;background:#ffffff;font-size:14px;font-weight:500;cursor:pointer";
const BTN_GHOST = "height:34px;padding:0 12px;border:0;border-radius:999px;background:transparent;color:#6b7686;font-size:14px;cursor:pointer";

/* ---------------- component ---------------- */
export default function HeroDemo({ width, height }: { width: number; height: number }) {
  const sm = width < 760;
  const [threads, setThreads] = useState<Thread[]>(initThreads);
  const [active, setActive] = useState<string>("new");
  const [draft, setDraft] = useState("");
  const [agentSel, setAgentSel] = useState<AgentId>("maya");
  const [agentMenu, setAgentMenu] = useState(false);
  const [slide, setSlide] = useState(0);
  const [cam, setCam] = useState("translate(0px,0px) scale(1)");
  const [cur, setCur] = useState({ x: width * 0.62, y: height * 0.7, on: false, down: false, rip: 0 });
  const [intro, setIntro] = useState<0 | 1 | 2>(1);
  const [outro, setOutro] = useState(false);
  const [card, setCard] = useState<0 | 1 | 2>(0);
  const [chip, setChip] = useState(false);
  const [idx, setIdx] = useState(-1);
  const [seg, setSeg] = useState({ run: false, key: 0 });
  const [paused, setPaused] = useState(false);

  const camRef = useRef<HTMLDivElement>(null);
  const gen = useRef(0);
  const pausedRef = useRef(false);
  const threadsRef = useRef(threads);
  threadsRef.current = threads;
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  useEffect(() => { const t = window.setInterval(() => setSlide((s) => s + 1), 6000); return () => window.clearInterval(t); }, []);

  /* ----- thread helpers ----- */
  const upd = useCallback((id: string, f: (t: Thread) => Partial<Thread>) => setThreads((ts) => ts.map((t) => (t.id === id ? { ...t, ...f(t) } : t))), []);

  /* ----- script primitives (pause-aware, cancellable) ----- */
  const sleep = useCallback((ms: number, g: number) => new Promise<void>((res, rej) => {
    let left = ms;
    const tick = () => { if (g !== gen.current) return rej("stop"); if (!pausedRef.current) left -= 50; if (left <= 0) return res(); window.setTimeout(tick, 50); };
    tick();
  }), []);
  const el = (sel: string) => { const c = camRef.current; if (!c) return null; const e = c.querySelector<HTMLElement>('[data-demo="' + sel + '"]'); return e && e.getClientRects().length ? e : null; };
  const rect = (e: HTMLElement) => { const c = camRef.current!, cr = c.getBoundingClientRect(), r = e.getBoundingClientRect(), k = cr.width / (c.offsetWidth || 1) || 1; return { x: (r.left - cr.left) / k, y: (r.top - cr.top) / k, w: r.width / k, h: r.height / k }; };
  const zoom = (sel: string | null, maxZ = 1.3) => {
    const c = camRef.current;
    const e = sel ? el(sel) : null;
    if (!c || !e) { setCam("translate(0px,0px) scale(1)"); return; }
    let n: HTMLElement = e, r = rect(n);
    while (n.parentElement && n.parentElement !== c && (r.w < 560 || r.h < 150)) { n = n.parentElement; r = rect(n); }
    const W = c.offsetWidth, H = c.offsetHeight, pad = 48;
    const side = c.querySelector<HTMLElement>("aside"), sr = side && side.getClientRects().length ? rect(side) : null, edge = sr ? sr.x + sr.w : 0;
    if (!edge || r.x < edge - 1 || W - edge < 400) { setCam("translate(0px,0px) scale(1)"); return; }
    const z = Math.min(maxZ, 1.3, W / (W - edge));
    const tx = -edge * z;
    let ty = r.h * z > H - pad * 2 ? pad - r.y * z : H / 2 - (r.y + r.h / 2) * z;
    ty = Math.min(0, Math.max(H - H * z, ty));
    setCam("translate(" + Math.round(tx) + "px," + Math.round(ty) + "px) scale(" + z.toFixed(3) + ")");
  };
  const move = async (sel: string, g: number, ms = 850) => {
    const e = el(sel);
    if (!e) return null;
    const r = rect(e);
    setCur((c) => ({ ...c, x: r.x + r.w / 2, y: r.y + r.h / 2 + 4, on: true }));
    await sleep(ms, g);
    return e;
  };
  const click = async (sel: string, g: number, run: () => void) => {
    await move(sel, g);
    setCur((c) => ({ ...c, down: true, rip: c.rip + 1 }));
    await sleep(170, g);
    run();
    setCur((c) => ({ ...c, down: false }));
    await sleep(300, g);
  };
  const waitFor = async (sel: string, g: number, max = 12000) => { let t = 0; while (!el(sel) && t < max) { await sleep(150, g); t += 150; } };
  // agent message that types itself out
  const say = async (id: string, text: string, g: number, extra: Msg[] = []) => {
    const k = key(), time = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    upd(id, (t) => ({ typing: false, msgs: [...t.msgs, { k, a: text, rev: 0, time }] }));
    const step = Math.max(3, Math.round(text.length / 40));
    for (let r = 0; r < text.length; r += step) { await sleep(28, g); upd(id, (t) => ({ msgs: t.msgs.map((m) => (m.k === k ? { ...m, rev: Math.min(text.length, r + step) } : m)) })); }
    if (extra.length) { await sleep(160, g); upd(id, (t) => ({ msgs: [...t.msgs, ...extra] })); }
  };
  const typing = async (id: string, g: number, ms = 900) => { upd(id, () => ({ typing: true })); await sleep(ms, g); };
  const work = async (id: string, steps: Work["steps"], g: number) => {
    const k = key(), t0 = Date.now();
    const W = (f: (w: Work) => Work) => upd(id, (t) => ({ msgs: t.msgs.map((m) => (m.k === k && m.work ? { ...m, work: f(m.work) } : m)) }));
    upd(id, (t) => ({ msgs: [...t.msgs, { k, work: { steps, shown: 1, done: false, open: true } }] }));
    for (let i = 0; i < steps.length; i++) {
      await sleep(700 + (steps[i].src ? steps[i].src!.length * 220 : 300) + Math.random() * 400, g);
      if (i < steps.length - 1) W((w) => ({ ...w, shown: w.shown + 1 }));
    }
    W((w) => ({ ...w, done: true, open: false, secs: Math.max(2, Math.round((Date.now() - t0) / 1000)) }));
    await sleep(220, g);
  };

  /* ----- scenes ----- */
  const reset = () => {
    setThreads(initThreads()); setActive("new"); setDraft(""); setAgentSel("maya"); setAgentMenu(false);
    setCam("translate(0px,0px) scale(1)");
    setCur({ x: width * 0.62, y: height * 0.7, on: false, down: false, rip: 0 });
  };
  const open = async (id: string, g: number) => { setCam("translate(0px,0px) scale(1)"); await click("th-" + id, g, () => { setActive(id); upd(id, () => ({ dot: false })); }); await sleep(900, g); };

  const scene0 = async (g: number) => {
    await click("agent-btn", g, () => setAgentMenu(true));
    await sleep(250, g);
    await click("ag-theo", g, () => { setAgentSel("theo"); setAgentMenu(false); });
    zoom("composer", 1.6); await sleep(900, g);
    await move("composer", g, 500);
    for (let i = 2; i <= ASK.length + 1; i += 2) { setDraft(ASK.slice(0, i)); await sleep(30 + Math.random() * 30, g); }
    await sleep(250, g);
    const id = "t-new";
    await click("send", g, () => {
      setThreads((ts) => [{ id, title: ASK.slice(0, 42) + "…", agent: "theo", dot: false, plan: { run: -1 }, msgs: [{ k: key(), you: ASK }] }, ...ts]);
      setActive(id); setDraft("");
    });
    setCur((c) => ({ ...c, on: false }));
    setCam("translate(0px,0px) scale(1)");
    await sleep(400, g);
    await work(id, RESEARCH_STEPS, g);
    await say(id, "Here’s how I’d do it. Nothing goes out to anyone without your approval.", g, [{ k: key(), card: "plan" }]);
    await waitFor("plan-start", g);
    await sleep(500, g);
    zoom("plan-start", 1.55); await sleep(1300, g);
    await click("plan-start", g, () => upd(id, () => ({ plan: { run: 0 } })));
    for (let r = 1; r <= PLAN_STEPS.length; r++) { await sleep(900, g); upd(id, () => ({ plan: { run: r } })); }
    await typing(id, g, 700);
    await say(id, "Done. I found 18 new finance leads and added them to Leads. Pat will score them next.", g);
    await sleep(1600, g);
    setCam("translate(0px,0px) scale(1)"); await sleep(1100, g);
  };
  const pick = (id: string, q: string, v: "yes" | "no") => upd(id, (t) => ({ picks: { ...t.picks, [q]: v } }));
  const scene1 = async (g: number) => {
    await open("t-qualify", g);
    zoom("yes-q1", 1.5); await sleep(1200, g);
    await click("yes-q1", g, () => pick("t-qualify", "q1", "yes"));
    await click("yes-q2", g, () => pick("t-qualify", "q2", "yes"));
    await click("no-q4", g, () => pick("t-qualify", "q4", "no"));
    zoom("q-done", 1.6); await sleep(900, g);
    await click("q-done", g, () => upd("t-qualify", () => ({ qDone: true })));
    await typing("t-qualify", g, 700);
    await say("t-qualify", "Thanks. Leah and Nora went to Maya, and I won’t bring Sam Patel up again. I’ll hold the other 2 until they have more activity.", g);
    await sleep(1200, g); setCam("translate(0px,0px) scale(1)"); await sleep(1200, g);
  };
  const scene2 = async (g: number) => {
    await open("t-drafts", g);
    zoom("approve-all", 1.6); await sleep(1300, g);
    await click("approve-all", g, () => upd("t-drafts", (t) => ({ drafts: Object.fromEntries(DRAFTS.map((d) => [d.id, d.flagged ? t.drafts![d.id]! : "sending"])) })));
    setCur((c) => ({ ...c, on: false }));
    for (const d of DRAFTS.filter((x) => !x.flagged)) { await sleep(550, g); upd("t-drafts", (t) => ({ drafts: { ...t.drafts!, [d.id]: "sent" } })); }
    await typing("t-drafts", g, 600);
    await say("t-drafts", "Sent 3. I held back Daniel’s email until the flagged claim is fixed.", g);
    await sleep(1300, g); setCam("translate(0px,0px) scale(1)"); await sleep(1300, g);
  };
  const scene3 = async (g: number) => {
    await open("t-dana", g);
    zoom("cs-send", 1.55); await sleep(1600, g);
    await click("cs-send", g, () => upd("t-dana", () => ({ sugg: "sending" })));
    await sleep(900, g); upd("t-dana", () => ({ sugg: "sent" }));
    await say("t-dana", "Sent to Dana. I’ll book the call as soon as she picks a time.", g);
    await sleep(1200, g); setCam("translate(0px,0px) scale(1)"); await sleep(1300, g);
  };
  const scene4 = async (g: number) => {
    await open("t-bounce", g);
    zoom("cb-retry", 1.6); await sleep(1300, g);
    await click("cb-retry", g, () => upd("t-bounce", () => ({ bounce: "sending" })));
    await sleep(900, g); upd("t-bounce", () => ({ bounce: "done" }));
    await say("t-bounce", "Sent to owen.pryce@tidewaterlabs.io. His follow-ups pick up from there.", g);
    await sleep(1100, g); setCam("translate(0px,0px) scale(1)"); await sleep(1100, g);
  };
  const scenes = [scene0, scene1, scene2, scene3, scene4];

  const chapter = async (c: number, g: number) => {
    reset();
    setIdx(c); setCard(1); setChip(false); setSeg((s) => ({ run: false, key: s.key }));
    await sleep(1600, g);
    setCard(2); await sleep(320, g);
    setCard(0); setChip(true); setSeg((s) => ({ run: true, key: s.key + 1 }));
    await sleep(250, g);
    await scenes[c](g);
    setCam("translate(0px,0px) scale(1)");
    await sleep(1000, g);
  };
  const run = useCallback(async (from: number, withIntro: boolean) => {
    const g = ++gen.current;
    setPaused(false); setOutro(false); setIntro(0);
    try {
      if (withIntro) { reset(); setIntro(1); setIdx(-1); await sleep(5500, g); setIntro(2); await sleep(700, g); setIntro(0); }
      for (let c = from; c < CHAPTERS.length; c++) await chapter(c, g);
      setChip(false); setIdx(CHAPTERS.length); setOutro(true); setIntro(1); setCur((c) => ({ ...c, on: false }));
      await sleep(9000, g);
      run(0, false);
    } catch (e) { if (e !== "stop") console.warn(e); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { setIntro(0); return; }
    // Start once the landing's loading screen has gone.
    let n = 0, t = 0;
    const go = () => { n++; if (document.querySelector('[aria-label="Loading Agentic Salesforce"]') && n < 60) { t = window.setTimeout(go, 200); return; } run(0, true); };
    t = window.setTimeout(go, 400);
    return () => { window.clearTimeout(t); gen.current++; };
  }, [run]);

  /* ---------------- render ---------------- */
  const th = threads.find((t) => t.id === active);
  const ch = CHAPTERS[Math.max(0, Math.min(CHAPTERS.length - 1, idx))];
  const avSz = sm ? 52 : 84;

  return (
    <div className="dm" style={{ position: "relative", width, height, overflow: "hidden", background: "#ffffff", fontFamily: '-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",system-ui,sans-serif', color: "#101418" }}>
      <div ref={camRef} style={{ position: "relative", width: "100%", height: "100%", transform: cam, transformOrigin: "0 0", transition: "transform 1.15s cubic-bezier(.22,1,.36,1)", willChange: "transform" }}>
        <div style={{ width: "100%", height, display: "flex", overflow: "hidden", background: "#ffffff" }}>
          {!sm && <Sidebar threads={threads} active={active} />}
          <div style={css("flex:1;min-width:0;display:flex;flex-direction:column;height:" + height + "px")}>
            <header style={css("height:60px;flex:none;display:flex;align-items:center;gap:8px;padding:0 16px")}>
              {th && (
                <div key={th.id} style={css("min-width:0;display:flex;align-items:center;gap:10px;padding-left:8px;animation:cSwapA .2s ease-out backwards")}>
                  <Av id={th.agent} size={28} />
                  <span style={css("min-width:0")}><span style={css("display:block;font-size:15px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{th.title}</span><span style={css("display:block;font-size:12px;color:#6b7686;white-space:nowrap")}>{FIRST[th.agent]} · {ROLE[th.agent]}</span></span>
                </div>
              )}
            </header>
            {th ? <ThreadView th={th} /> : (
              <Home sm={sm} draft={draft} agentSel={agentSel} agentMenu={agentMenu} slide={slide} />
            )}
          </div>
        </div>
        {/* cursor */}
        <div aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, zIndex: 150, pointerEvents: "none", transform: "translate(" + Math.round(cur.x) + "px," + Math.round(cur.y) + "px)", opacity: cur.on ? 1 : 0, transition: "transform .8s cubic-bezier(.65,0,.35,1),opacity .3s" }}>
          <span key={cur.rip} style={{ position: "absolute", left: -22, top: -22, width: 44, height: 44, borderRadius: "50%", border: "2px solid #006aff", background: "rgba(0,106,255,.18)", opacity: 0, animation: cur.rip ? (cur.rip % 2 ? "dRipA" : "dRipB") + " .6s ease-out" : "none" }} />
          <svg viewBox="0 0 24 24" style={{ position: "absolute", left: -3, top: -2, width: 26, height: 26, filter: "drop-shadow(0 4px 8px rgba(0,30,90,.35))", transform: "scale(" + (cur.down ? 0.82 : 1) + ")", transformOrigin: "3px 2px", transition: "transform .12s" }}><path d="M4 2.5 20 11l-7.2 1.8L9.4 20z" fill="#101418" stroke="#ffffff" strokeWidth="1.6" strokeLinejoin="round" /></svg>
        </div>
      </div>

      {/* progress segments */}
      <div aria-hidden="true" style={css("position:absolute;left:0;right:0;top:0;z-index:210;height:4px;display:flex;gap:3px;pointer-events:none")}>
        {CHAPTERS.map((c, i) => (
          <span key={i} style={css("position:relative;flex:1;background:rgba(0,106,255,.16);overflow:hidden")}>
            <span key={i === idx ? seg.key : "x"} style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg,#0047b3,#006aff)", transformOrigin: "0 50%", transform: "scaleX(" + (i < idx ? 1 : 0) + ")", animation: i === idx && seg.run ? (seg.key % 2 ? "dSegA" : "dSegB") + " " + c.dur + "s linear forwards" : "none", animationPlayState: paused ? "paused" : "running" }} />
          </span>
        ))}
      </div>

      {/* chapter chip */}
      {chip && (
        <div aria-hidden="true" style={css("position:absolute;z-index:220;top:18px;right:18px;max-width:calc(100% - 36px);display:flex;align-items:center;gap:12px;padding:10px 16px 10px 10px;background:rgba(255,255,255,.94);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);border:1px solid #cfe0ff;box-shadow:0 20px 44px -22px rgba(0,47,120,.55);pointer-events:none;animation:dChipIn .5s cubic-bezier(.2,.8,.2,1) backwards")}>
          <Av id={ch.agent} size={38} ring="0 0 0 2px #e6f0ff" />
          <span style={css("min-width:0")}>
            <span style={css("display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#006aff")}><span style={css("width:6px;height:6px;border-radius:50%;background:#16a34a;animation:dLive 1.4s ease-in-out infinite")} />{FIRST[ch.agent]}</span>
            <span style={css("display:block;margin-top:1px;font-family:'General Sans',system-ui,sans-serif;font-size:16px;font-weight:600;letter-spacing:-.01em;color:#101418;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{ch.title}</span>
          </span>
        </div>
      )}

      {/* controls */}
      <div style={css("position:absolute;z-index:230;right:16px;bottom:16px;display:flex;gap:6px")}>
        <CtlBtn label={paused ? "Play demo" : "Pause demo"} onClick={() => { if (!outro) setPaused((p) => !p); }}>
          {paused ? <svg aria-hidden="true" viewBox="0 0 24 24" style={{ width: 16, height: 16 }}><path d="M7 4.5v15l12-7.5z" fill="currentColor" /></svg>
            : <svg aria-hidden="true" viewBox="0 0 24 24" style={{ width: 16, height: 16 }}><path d="M7 4h3.5v16H7zM13.5 4H17v16h-3.5z" fill="currentColor" /></svg>}
        </CtlBtn>
        <CtlBtn label="Restart demo" onClick={() => run(0, true)}>
          <svg aria-hidden="true" viewBox="0 0 24 24" style={{ width: 16, height: 16 }} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
        </CtlBtn>
        {!sm && CHAPTERS.map((c, i) => (
          <CtlBtn key={i} label={"Jump to step " + (i + 1) + ": " + c.title} on={i === idx} onClick={() => run(i, false)}>
            <span style={css("font-size:12px;font-weight:600")}>{"0" + (i + 1)}</span>
          </CtlBtn>
        ))}
      </div>

      {/* chapter card */}
      {card > 0 && idx >= 0 && idx < CHAPTERS.length && (
        <div aria-hidden="true" style={{ ...css("position:absolute;inset:0;z-index:240;display:flex;align-items:center;justify-content:center;padding:24px;pointer-events:none;background:rgba(6,22,56,.42);-webkit-backdrop-filter:blur(5px) saturate(1.1);backdrop-filter:blur(5px) saturate(1.1)"), animation: card === 2 ? "dScrimOut .32s ease-in forwards" : "dScrimIn .35s ease-out backwards" }}>
          <div style={{ ...css("position:relative;width:min(640px,100%);background:#ffffff;border:1px solid #cfe0ff;box-shadow:0 50px 100px -40px rgba(0,20,60,.7)"), padding: sm ? 22 : "34px 36px", animation: card === 2 ? "dCardOut .32s ease-in forwards" : "dCardIn .55s cubic-bezier(.2,.8,.2,1) backwards" }}>
            {[["left", "top", "2px 0 0 2px"], ["right", "top", "2px 2px 0 0"], ["left", "bottom", "0 0 2px 2px"], ["right", "bottom", "0 2px 2px 0"]].map(([x, y, bw]) => <span key={x + y} style={{ position: "absolute", [x]: -7, [y]: -7, width: 12, height: 12, borderStyle: "solid", borderColor: "#ffffff", borderWidth: bw }} />)}
            <div style={css("display:flex;align-items:center;gap:16px")}>
              <span style={{ width: avSz, height: avSz, flex: "none", borderRadius: "50%", boxShadow: "0 0 0 3px #ffffff,0 14px 30px -12px rgba(0,30,90,.55)", background: avBg(ch.agent), animation: "dPop .7s .1s cubic-bezier(.2,.8,.2,1) backwards" }} />
              <span style={{ display: "block", fontFamily: "'General Sans',system-ui,sans-serif", fontSize: sm ? 26 : 42, lineHeight: 1.04, fontWeight: 600, letterSpacing: "-.035em", color: "#101418", animation: "dRise .55s .15s cubic-bezier(.2,.8,.2,1) backwards" }}>{ch.title}</span>
            </div>
            <p style={{ margin: "16px 0 0", fontSize: sm ? 15 : 18, lineHeight: 1.6, color: "#4a5565" }}>{words(ch.sub, 0.2, false)}</p>
            <div style={css("margin-top:18px;height:3px;background:#e9eef6;overflow:hidden")}><span style={css("display:block;height:100%;background:#006aff;transform-origin:0 50%;animation:dSegA 1.6s linear forwards")} /></div>
          </div>
        </div>
      )}

      {/* intro / outro */}
      {intro > 0 && (
        <div style={{ ...css("position:absolute;inset:0;z-index:260;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;padding:32px;text-align:center;color:#101418;background:linear-gradient(180deg,#ffffff 0%,#f6f9ff 60%,#eaf2ff 100%)"), animation: intro === 2 ? "dWipeOut .7s cubic-bezier(.65,0,.35,1) forwards" : "lFade .4s ease-out backwards" }}>
          <span aria-hidden="true" style={css("position:absolute;inset:0;pointer-events:none;background-image:radial-gradient(rgba(0,106,255,.22) 1px,transparent 1.4px);background-size:22px 22px;animation:dDrift 6s linear infinite;-webkit-mask-image:radial-gradient(ellipse 70% 65% at 50% 45%,#000,transparent 80%);mask-image:radial-gradient(ellipse 70% 65% at 50% 45%,#000,transparent 80%)")} />
          <span aria-hidden="true" style={css("position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse 55% 50% at 50% 45%,rgba(255,255,255,.95),rgba(255,255,255,0) 100%)")} />
          <div style={css("position:relative;display:inline-flex;align-items:center;gap:8px;height:32px;padding:0 14px;border:1px solid #cfe0ff;background:#f2f7ff;color:#0b57d0;font-size:13px;font-weight:500;animation:dRise .5s cubic-bezier(.2,.8,.2,1) backwards")}>
            <span style={css("width:7px;height:7px;border-radius:50%;background:#16a34a;animation:dLive 1.2s ease-in-out infinite")} />
            {outro ? "That’s a morning of work, in about a minute" : "Live product demo · about 1 minute"}
          </div>
          <div aria-hidden="true" style={{ position: "relative", display: "flex", gap: sm ? 14 : 26 }}>
            {(["theo", "priya", "maya", "sam"] as AgentId[]).map((id, i) => (
              <span key={id} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, animation: "dPop .7s cubic-bezier(.2,.8,.2,1) backwards", animationDelay: 0.15 + i * 0.12 + "s" }}>
                <span style={{ width: avSz, height: avSz, borderRadius: "50%", boxShadow: "0 0 0 3px #ffffff,0 0 0 4px #cfe0ff,0 14px 30px -12px rgba(0,47,120,.35)", background: avBg(id) }} />
                <span style={css("font-size:13px;font-weight:600;color:#4a5565")}>{FIRST[id]}</span>
              </span>
            ))}
          </div>
          <h2 style={{ position: "relative", margin: 0, maxWidth: 900, fontFamily: "'General Sans',system-ui,sans-serif", fontSize: sm ? 30 : 64, lineHeight: 1.02, fontWeight: 600, letterSpacing: "-.04em", animation: "dRise .6s .35s cubic-bezier(.2,.8,.2,1) backwards" }}>
            {outro ? "Your AI sales team, working in chat." : "Meet the sales team that never stops working."}
          </h2>
          <p key={outro ? "o" : "i"} style={{ position: "relative", margin: 0, maxWidth: 640, fontSize: sm ? 15 : 18, lineHeight: 1.6, color: "#4a5565" }}>
            {words(outro ? "Theo researches, Pat qualifies, Maya writes and Sam follows up. *You* *approve* *what* *matters.*" : "Watch four agents turn a list of names into *booked* *calls,* and check with you *before* *anything* *sends.*", 0.55, false)}
          </p>
        </div>
      )}
    </div>
  );
}

function CtlBtn({ label, on, onClick, children }: { label: string; on?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} style={{ width: 40, height: 40, border: "1px solid " + (on ? "#006aff" : "#cfe0ff"), background: on ? "#006aff" : "rgba(255,255,255,.94)", color: on ? "#ffffff" : "#0047b3", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: "0 10px 24px -14px rgba(0,47,120,.5)", transition: "background .2s,color .2s" }}>{children}</button>
  );
}

/* ---------------- app pieces ---------------- */
function Sidebar({ threads, active }: { threads: Thread[]; active: string }) {
  return (
    <aside aria-label="Sidebar" style={css("width:272px;flex:none;height:100%;background:#f6f7f9;border-right:1px solid #eceef1;display:flex;flex-direction:column")}>
      <div style={css("height:62px;flex:none;display:flex;align-items:center;gap:10px;padding:14px 12px 0 15px")}>
        <span style={css("width:34px;height:34px;flex:none;border-radius:10px;background:url('/logo-mark.png') center/cover no-repeat")} />
        <span style={css("flex:1;font-size:15px;font-weight:500;letter-spacing:-.01em;white-space:nowrap")}>Agentic Salesforce</span>
        <span style={css("width:34px;height:34px;color:#6b7686;display:flex;align-items:center;justify-content:center")}><i className="icon-chevrons-left" style={{ fontSize: 18 }} /></span>
      </div>
      <div style={css("padding:4px 10px 0;display:flex;flex-direction:column;gap:2px")}>
        <div style={css("height:40px;display:flex;align-items:center;gap:12px;padding:0 12px;border-radius:10px;font-size:14px;color:#8a94a3")}><i className="icon-search" style={{ fontSize: 17, color: "#4a5565" }} />Search</div>
        <div style={css("height:40px;display:flex;align-items:center;gap:12px;padding:0 12px;border-radius:10px;font-size:14px;font-weight:500;background:" + (active === "new" ? "#eceef1" : "transparent"))}><i className="icon-square-pen" style={{ fontSize: 17, color: "#4a5565" }} />New chat</div>
        {[["icon-chart-column", "Dashboard"], ["icon-users-round", "Leads"], ["icon-blocks", "Products"], ["icon-clock", "Calendar"]].map(([ic, t]) => (
          <div key={t} style={css("height:40px;display:flex;align-items:center;gap:12px;padding:0 12px;border-radius:10px;font-size:14px;color:#2a313b")}><i className={ic} style={{ fontSize: 17, color: "#4a5565" }} />{t}</div>
        ))}
      </div>
      <nav style={css("flex:1;overflow:hidden;padding:18px 10px 12px")}>
        <div style={css("padding:0 12px 6px;font-size:13px;font-weight:500;color:#6b7686")}>Recent chats</div>
        {threads.map((t, i) => (
          <div key={t.id} data-demo={"th-" + t.id} style={{ ...css("position:relative;width:100%;display:flex;align-items:center;gap:10px;height:36px;padding:0 10px 0 12px;border-radius:10px;transition:background .12s"), background: t.id === active ? "#eceef1" : "transparent", animation: t.id === "t-new" && i === 0 ? "cSide .3s ease-out backwards" : "none" }}>
            <Av id={t.agent} size={18} />
            <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: t.dot ? 500 : 400, color: t.dot || t.id === active ? "#101418" : "#6b7686", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", transition: "color .2s" }}>{t.title}</span>
            {t.dot && <span aria-hidden="true" style={css("width:7px;height:7px;flex:none;border-radius:50%;background:#006aff")} />}
          </div>
        ))}
      </nav>
      <div style={css("flex:none;padding:8px 10px 12px;border-top:1px solid #eceef1;display:flex;flex-direction:column;gap:2px")}>
        <div style={css("height:40px;display:flex;align-items:center;gap:12px;padding:0 12px;font-size:14px")}><i className="icon-bell" style={{ fontSize: 17, color: "#4a5565" }} />Notifications<span style={css("margin-left:auto;min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:#006aff;color:#ffffff;font-size:12px;font-weight:600;display:flex;align-items:center;justify-content:center")}>5</span></div>
        <div style={css("height:1px;background:#eceef1;margin:6px 2px")} />
        <div style={css("height:44px;display:flex;align-items:center;gap:10px;padding:0 10px")}>
          <span style={css("width:28px;height:28px;border-radius:8px;background:#101418;color:#ffffff;font-size:12px;font-weight:600;display:flex;align-items:center;justify-content:center")}>T</span>
          <span style={css("flex:1;min-width:0")}><span style={css("display:block;font-size:11.5px;color:#6b7686")}>Workspace</span><span style={css("display:block;font-size:14px;font-weight:500")}>Tallyroom</span></span>
          <i className="icon-chevrons-up-down" style={{ fontSize: 15, color: "#8a94a3" }} />
        </div>
        <div style={css("height:48px;display:flex;align-items:center;gap:10px;padding:0 10px")}>
          <span style={css("width:32px;height:32px;border-radius:50%;background:#eceef1;color:#4a5565;font-size:12px;font-weight:500;display:flex;align-items:center;justify-content:center")}>AR</span>
          <span style={css("flex:1;min-width:0")}><span style={css("display:block;font-size:14px;font-weight:500")}>Alex Rivera</span><span style={css("display:block;font-size:12.5px;color:#6b7686")}>alex@tallyroom.com</span></span>
          <i className="icon-ellipsis" style={{ fontSize: 16, color: "#8a94a3" }} />
        </div>
      </div>
    </aside>
  );
}

function Home({ sm, draft, agentSel, agentMenu, slide }: { sm: boolean; draft: string; agentSel: AgentId; agentMenu: boolean; slide: number }) {
  const sl = SLIDES[slide % SLIDES.length];
  return (
    <main style={css("flex:1;overflow:hidden;display:flex;flex-direction:column;align-items:center;padding:0 20px 28px")}>
      <div style={css("flex:1;min-height:24px;max-height:22vh")} />
      <div style={css("width:100%;max-width:760px;display:flex;flex-direction:column;align-items:center;animation:cSwapA .28s ease-out backwards")}>
        <h1 style={{ margin: 0, textAlign: "center", fontSize: sm ? 30 : 40, lineHeight: 1.15, fontWeight: 500, letterSpacing: "-.035em", fontFamily: "'General Sans',system-ui,sans-serif" }}>What should your team work on?</h1>
        <div style={css("position:relative;width:100%;margin-top:36px")}>
          <div style={css("position:relative;z-index:2;display:flex;flex-direction:column;gap:10px;padding:16px 14px 12px 18px;border:1px solid #e3e7ed;border-radius:24px;background:#ffffff;box-shadow:0 6px 24px -12px rgba(16,20,24,.14)")}>
            <div data-demo="composer" style={{ minHeight: 52, fontSize: 16, lineHeight: 1.55, color: draft ? "#101418" : "#8a94a3", whiteSpace: "pre-wrap" }}>
              {draft || "What should " + FIRST[agentSel] + " do?"}
              {draft && <span aria-hidden="true" style={{ display: "inline-block", width: 2, height: "1em", marginLeft: 2, verticalAlign: -2, background: "#101418", animation: "cBlink .9s step-end infinite" }} />}
            </div>
            <div style={css("display:flex;align-items:center;gap:8px")}>
              <span style={css("width:36px;height:36px;flex:none;border:1px solid #e3e7ed;border-radius:50%;color:#4a5565;display:flex;align-items:center;justify-content:center")}><i className="icon-plus" style={{ fontSize: 17 }} /></span>
              <div style={css("position:relative;flex:none")}>
                <span data-demo="agent-btn" style={css("height:36px;padding:0 10px 0 5px;border:1px solid #e3e7ed;border-radius:999px;background:#ffffff;font-size:14px;font-weight:500;display:flex;align-items:center;gap:7px")}>
                  <Av id={agentSel} size={24} />{FIRST[agentSel]}<i className="icon-chevron-down" style={{ fontSize: 14, color: "#6b7686" }} />
                </span>
                {agentMenu && (
                  <div role="menu" style={css("position:absolute;left:0;top:calc(100% + 8px);z-index:20;width:280px;padding:6px;background:#ffffff;border:1px solid rgba(16,20,24,.08);border-radius:14px;box-shadow:0 14px 40px rgba(16,20,24,.14);animation:cPop .14s ease-out backwards;transform-origin:0 0")}>
                    <div style={css("padding:6px 10px 8px;font-size:12px;color:#6b7686")}>Ask an agent</div>
                    {(["theo", "priya", "maya", "sam"] as AgentId[]).map((id) => (
                      <div key={id} data-demo={"ag-" + id} style={css("display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px")}>
                        <Av id={id} size={30} />
                        <span style={css("flex:1;min-width:0")}><span style={css("display:block;font-size:14px;font-weight:500")}>{FIRST[id]}</span><span style={css("display:block;font-size:12px;color:#6b7686")}>{ROLE[id]}</span></span>
                        {id === agentSel && <i className="icon-check" style={{ fontSize: 16 }} />}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ flex: 1 }} />
              <span style={css("width:36px;height:36px;color:#4a5565;display:flex;align-items:center;justify-content:center")}><i className="icon-mic" style={{ fontSize: 18 }} /></span>
              <span data-demo="send" style={{ ...css("width:36px;height:36px;flex:none;border-radius:50%;color:#ffffff;display:flex;align-items:center;justify-content:center;transition:background .15s"), background: draft ? "#006aff" : "#c7ced8" }}><i className="icon-arrow-up" style={{ fontSize: 18 }} /></span>
            </div>
          </div>
        </div>
        <div style={{ width: "100%", marginTop: 18, display: "grid", gridTemplateColumns: sm ? "1fr 1fr" : "repeat(4,1fr)", gap: 8 }}>
          {([["icon-search", "Find 25 finance leads in Texas", "theo"], ["icon-pen-line", "Draft emails for my ready leads", "maya"], ["icon-chart-column", "How did this week go?", "maya"], ["icon-list-checks", "Score my newest leads", "priya"]] as [string, string, AgentId][]).map(([ic, label, ag]) => (
            <div key={label} style={css("min-width:0;min-height:112px;padding:14px 14px 12px;border:1px solid #e3e7ed;border-radius:18px;background:#ffffff;display:flex;flex-direction:column;align-items:flex-start;gap:10px")}>
              <span style={css("width:30px;height:30px;flex:none;border-radius:9px;background:#f3f4f6;color:#4a5565;display:flex;align-items:center;justify-content:center")}><i className={ic} style={{ fontSize: 16 }} /></span>
              <span style={css("flex:1;font-size:14px;font-weight:500;line-height:1.35;color:#1f252d")}>{label}</span>
              <span style={css("display:flex;align-items:center;gap:6px;font-size:12px;color:#6b7686")}><Av id={ag} size={16} />{FIRST[ag]}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={css("flex:1;min-height:40px")} />
      <div style={css("width:100%;max-width:760px;display:flex;flex-direction:column;align-items:center;gap:12px")}>
        <div style={css("position:relative;width:100%;height:116px;border-radius:20px;background:#f3f4f6;overflow:hidden")}>
          <div key={slide} style={css("position:absolute;inset:0;display:flex;align-items:center;gap:16px;padding:0 0 0 22px;animation:cSwapA .3s ease-out backwards")}>
            <span style={css("flex:1;min-width:0")}>
              <span style={css("display:flex;align-items:center;gap:8px;font-size:15px;font-weight:500")}>{sl.alert && <span style={css("width:7px;height:7px;border-radius:50%;background:#b42318")} />}{sl.title}</span>
              <span style={css("display:block;margin-top:3px;font-size:14px;line-height:1.45;color:#4a5565")}>{sl.sub}</span>
            </span>
            <span style={css("width:170px;height:100%;flex:none;position:relative;padding:14px 18px 0 0;display:flex;flex-direction:column;gap:7px")}>
              {sl.rows.map((id, i) => (
                <span key={i} style={css("display:flex;align-items:center;gap:8px;height:30px;padding:0 9px;border-radius:9px;background:#ffffff;box-shadow:0 2px 8px -4px rgba(16,20,24,.18)")}>
                  <Av id={id} size={20} /><span style={css("flex:1;height:5px;border-radius:3px;background:#eceef1")} />
                </span>
              ))}
            </span>
          </div>
        </div>
        <div style={css("display:flex;gap:6px")}>
          {SLIDES.map((_, i) => <span key={i} style={{ width: i === slide % SLIDES.length ? 18 : 6, height: 6, borderRadius: 3, background: i === slide % SLIDES.length ? "#101418" : "#d0d6de", transition: "width .2s,background .2s" }} />)}
        </div>
      </div>
    </main>
  );
}

function ThreadView({ th }: { th: Thread }) {
  const scRef = useRef<HTMLElement>(null);
  const n = th.msgs.length + (th.typing ? 1 : 0) + th.msgs.reduce((a, m) => a + (m.work ? m.work.shown * 10 : 0) + Math.floor((m.rev ?? 0) / 60), 0);
  useEffect(() => { const s = scRef.current; if (s) s.scrollTo({ top: s.scrollHeight, behavior: "smooth" }); }, [n]);
  return (
    <>
      <main ref={scRef} style={css("flex:1;overflow-y:hidden;padding:12px 20px 24px")}>
        <div key={th.id} style={css("max-width:740px;margin:0 auto;display:flex;flex-direction:column;gap:22px;padding-top:12px;animation:cSwapA .2s ease-out backwards")}>
          {th.msgs.map((m, i) => {
            if (m.you) return <div key={m.k} style={css("display:flex;justify-content:flex-end;animation:cUp .25s ease-out backwards")}><div style={css("max-width:78%;padding:11px 16px;border-radius:20px 20px 6px 20px;background:#006aff;color:#ffffff;font-size:15px;line-height:1.55;white-space:pre-wrap")}>{m.you}</div></div>;
            const prev = th.msgs[i - 1], showAv = !prev || !!prev.you;
            return (
              <div key={m.k} style={css("display:flex;gap:12px;animation:cUp .25s ease-out backwards")}>
                <span style={css("width:30px;flex:none")}>{showAv && <Av id={th.agent} size={30} />}</span>
                <div style={css("flex:1;min-width:0;display:flex;flex-direction:column;gap:10px")}>
                  {m.work && <WorkBlock w={m.work} />}
                  {showAv && !m.work && <div style={css("font-size:13px;font-weight:500;padding-top:5px")}>{FIRST[th.agent]}<span style={css("font-weight:400;color:#8a94a3")}> · {m.time || "9:41 AM"}</span></div>}
                  {m.a && (
                    <div style={css("align-self:flex-start;max-width:92%;padding:11px 16px;border-radius:6px 20px 20px 20px;background:#f1f3f6;font-size:15px;line-height:1.6;white-space:pre-wrap")}>
                      {m.a.slice(0, m.rev ?? m.a.length)}
                      {(m.rev ?? m.a.length) < m.a.length && <span aria-hidden="true" style={{ display: "inline-block", width: 2, height: "1em", marginLeft: 2, verticalAlign: -2, background: "#101418", animation: "cBlink .9s step-end infinite" }} />}
                    </div>
                  )}
                  {m.card === "plan" && <PlanCard th={th} />}
                  {m.card === "qualify" && <QualifyCard th={th} />}
                  {m.card === "drafts" && <DraftsCard th={th} />}
                  {m.card === "thread" && <EmailThreadCard />}
                  {m.card === "suggest" && <SuggestCard th={th} />}
                  {m.card === "bounce" && <BounceCard th={th} />}
                </div>
              </div>
            );
          })}
          {th.typing && (
            <div style={css("display:flex;gap:12px;animation:cFade .2s backwards")}>
              <Av id={th.agent} size={30} />
              <span style={css("display:flex;align-items:center;gap:4px;height:40px;padding:0 16px;border-radius:6px 20px 20px 20px;background:#f1f3f6")}>
                {[0, 0.15, 0.3].map((d) => <span key={d} style={{ width: 6, height: 6, borderRadius: "50%", background: "#6b7686", animation: "cDot 1s " + d + "s ease-in-out infinite" }} />)}
              </span>
            </div>
          )}
        </div>
      </main>
      <div style={css("flex:none;padding:0 20px 20px")}>
        <div style={css("max-width:740px;margin:0 auto;display:flex;align-items:center;gap:10px;padding:10px 10px 10px 18px;border:1px solid #e3e7ed;border-radius:24px;background:#ffffff;box-shadow:0 6px 24px -12px rgba(16,20,24,.14)")}>
          <span style={css("flex:1;font-size:15px;color:#8a94a3")}>Reply to {FIRST[th.agent]}…</span>
          <span style={css("width:36px;height:36px;border-radius:50%;background:#c7ced8;color:#ffffff;display:flex;align-items:center;justify-content:center")}><i className="icon-arrow-up" style={{ fontSize: 18 }} /></span>
        </div>
      </div>
    </>
  );
}

function WorkBlock({ w }: { w: Work }) {
  const head = w.done ? "Worked for " + (w.secs ?? 6) + "s" : w.steps[w.shown - 1].t.replace(/…$/, "") + "…";
  return (
    <div style={css("display:flex;flex-direction:column;animation:cUp .25s ease-out backwards")}>
      <div style={css("align-self:flex-start;display:flex;align-items:center;gap:8px;height:30px;padding:0 8px 0 2px;margin-left:-2px")}>
        {w.done ? (<><i className="icon-sparkle" style={{ fontSize: 16, color: "#8a94a3" }} /><span style={css("font-size:14.5px;color:#4a5565;animation:cFade .2s backwards")}>{head}</span></>)
          : (<><i className="icon-sparkle" style={{ fontSize: 16, color: "#006aff", animation: "cBreath 1.4s ease-in-out infinite" }} /><span style={css("font-size:14.5px;font-weight:500;background:linear-gradient(90deg,#4a5565 0%,#4a5565 40%,#c7ced8 50%,#4a5565 60%,#4a5565 100%);background-size:200% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:cShim 1.8s linear infinite")}>{head}</span></>)}
        <i className="icon-chevron-down" style={{ fontSize: 15, color: "#8a94a3", transition: "transform .18s", transform: "rotate(" + (w.open ? 180 : 0) + "deg)" }} />
      </div>
      {w.open && (
        <div style={css("margin-top:8px;display:flex;flex-direction:column;animation:cFade .15s backwards")}>
          {w.steps.slice(0, w.shown).map((st, i) => {
            const curr = i === w.shown - 1 && !w.done;
            return (
              <div key={i} style={css("display:flex;gap:14px;animation:cUp .28s ease-out backwards")}>
                <span style={css("width:9px;flex:none;display:flex;flex-direction:column;align-items:center")}>
                  <span style={{ width: 9, height: 9, marginTop: 6, flex: "none", borderRadius: "50%", background: curr ? "#006aff" : "#c7ced8", boxShadow: curr ? "0 0 0 4px rgba(0,106,255,.15)" : "none", transition: "background .2s" }} />
                  {i < w.shown - 1 && <span style={css("flex:1;width:1.5px;margin:4px 0 -2px;background:#e3e7ed")} />}
                </span>
                <div style={css("flex:1;min-width:0;padding-bottom:16px")}>
                  <div style={{ fontSize: 14.5, fontWeight: 500, lineHeight: 1.45, color: curr ? "#101418" : "#4a5565" }}>{st.t}</div>
                  {st.d && <div style={css("margin-top:2px;font-size:14px;line-height:1.5;color:#6b7686")}>{st.d}</div>}
                  {st.src && (
                    <div style={css("margin-top:10px;border:1px solid #e3e7ed;border-radius:14px;background:#ffffff;padding:6px 6px 4px")}>
                      {st.src.map(([ic, title, meta], j) => (
                        <div key={j} style={{ ...css("display:flex;align-items:center;gap:12px;min-height:38px;padding:0 10px;border-radius:9px;animation:cUp .25s ease-out backwards"), animationDelay: j * 0.12 + "s" }}>
                          <i className={ic} style={{ width: 18, flex: "none", fontSize: 16, color: "#6b7686", textAlign: "center" }} />
                          <span style={css("flex:1;min-width:0;font-size:14px;color:#2a313b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{title}</span>
                          <span style={css("flex:none;font-size:13px;color:#6b7686")}>{meta}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PlanCard({ th }: { th: Thread }) {
  const run = th.plan?.run ?? -1;
  return (
    <div style={css(CARD)}>
      <div style={css(CARD_HEAD)}>
        <span style={css("width:26px;height:26px;flex:none;border-radius:8px;background:#f1f3f6;display:flex;align-items:center;justify-content:center")}><i className="icon-list-checks" style={{ fontSize: 14, color: "#4a5565" }} /></span>
        <span style={css("flex:1;font-size:14px;font-weight:500")}>Plan</span>
        <span style={css("font-size:13px;color:#6b7686")}>{run >= PLAN_STEPS.length ? "Done" : run >= 0 ? "Step " + Math.min(run + 1, PLAN_STEPS.length) + " of " + PLAN_STEPS.length : PLAN_STEPS.length + " steps"}</span>
      </div>
      <ol style={css("list-style:none;margin:0;padding:14px 18px 16px;display:flex;flex-direction:column;gap:12px")}>
        {PLAN_STEPS.map((t, i) => {
          const done = run > i, running = run === i;
          return (
            <li key={i} style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 15, color: done ? "#6b7686" : "#101418", transition: "color .2s" }}>
              <span style={{ width: 22, height: 22, flex: "none", borderRadius: "50%", border: done ? "0" : "1.5px solid " + (running ? "#c6d9f7" : "#d0d6de"), background: done ? "#0f7b3f" : "#ffffff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600, color: "#4a5565", transition: "background .2s" }}>
                {done ? <i className="icon-check" style={{ fontSize: 12, color: "#ffffff", animation: "cCheck .2s ease-out backwards" }} /> : running ? <Spin s={10} /> : i + 1}
              </span>
              {t}
            </li>
          );
        })}
      </ol>
      {run < 0 && (
        <div style={css(CARD_FOOT)}>
          <span data-demo="plan-start" style={css(BTN_DARK + ";padding:0 18px")}><i className="icon-play" style={{ fontSize: 13 }} />Start</span>
          <span style={css(BTN_GHOST + ";display:flex;align-items:center")}>Not now</span>
        </div>
      )}
    </div>
  );
}

function QualifyCard({ th }: { th: Thread }) {
  const picks = th.picks ?? {};
  const n = Object.values(picks).filter(Boolean).length;
  return (
    <div style={css(CARD)}>
      <div style={css(CARD_HEAD)}>
        <span style={css("width:26px;height:26px;flex:none;border-radius:8px;background:#efe8fb;display:flex;align-items:center;justify-content:center")}><i className="icon-scale" style={{ fontSize: 14, color: "#5b3aa8" }} /></span>
        <span style={css("flex:1;font-size:14px;font-weight:500")}>Borderline leads</span>
        <span style={css("font-size:13px;color:#6b7686")}>Fit score out of 100</span>
      </div>
      {QROWS.map((r, i) => {
        const p = picks[r.id], tone = r.score >= 60 ? "#9a5800" : "#b42318";
        return (
          <div key={r.id} style={{ ...css("display:flex;align-items:center;gap:14px;padding:14px 16px"), borderTop: i ? "1px solid #f0f2f5" : "0" }}>
            <span style={css("width:44px;flex:none;display:flex;flex-direction:column;align-items:center;gap:6px")}>
              <span style={{ fontSize: 18, fontWeight: 500, lineHeight: 1, color: tone, fontFamily: "'General Sans',system-ui,sans-serif" }}>{r.score}</span>
              <span style={css("width:30px;height:4px;border-radius:2px;background:#eef1f5;overflow:hidden")}><span style={{ display: "block", height: "100%", width: r.score + "%", background: tone, borderRadius: 2 }} /></span>
            </span>
            <span style={{ flex: 1, minWidth: 200, opacity: p === "no" ? 0.5 : 1, transition: "opacity .2s" }}>
              <span style={css("display:block;font-size:15px;font-weight:500;line-height:1.3")}>{r.name}</span>
              <span style={css("display:block;font-size:13px;color:#6b7686")}>{r.title}, {r.company}</span>
              <span style={css("display:flex;align-items:flex-start;gap:6px;margin-top:6px;font-size:13px;line-height:1.45;color:#4a5565")}><i className="icon-sparkle" style={{ fontSize: 12, color: "#8a94a3", marginTop: 3 }} />{r.why}</span>
            </span>
            <span style={css("display:flex;padding:3px;border-radius:999px;background:#f1f3f6")}>
              <span data-demo={"yes-" + r.id} style={{ ...css("height:30px;padding:0 12px;border-radius:999px;font-size:13px;font-weight:500;display:flex;align-items:center;gap:5px;transition:background .15s,color .15s"), background: p === "yes" ? "#101418" : "transparent", color: p === "yes" ? "#ffffff" : "#4a5565" }}>{p === "yes" && <i className="icon-check" style={{ fontSize: 13, animation: "cCheck .15s ease-out backwards" }} />}Send to Maya</span>
              <span data-demo={"no-" + r.id} style={{ ...css("height:30px;padding:0 12px;border-radius:999px;font-size:13px;font-weight:500;display:flex;align-items:center;transition:background .15s,color .15s"), background: p === "no" ? "#ffffff" : "transparent", color: p === "no" ? "#101418" : "#4a5565", boxShadow: p === "no" ? "0 1px 3px rgba(16,20,24,.12)" : "none" }}>Skip</span>
            </span>
          </div>
        );
      })}
      {!th.qDone && (
        <div style={css(CARD_FOOT)}>
          <span style={css("flex:1;min-width:180px;display:flex;flex-direction:column;gap:7px")}>
            <span style={css("font-size:13px;color:#4a5565")}>{n ? n + " of 5 decided" : "Decide on each lead, then press Done"}</span>
            <span style={css("width:160px;height:4px;border-radius:2px;background:#e6e9ee;overflow:hidden")}><span style={{ display: "block", height: "100%", width: (n / 5) * 100 + "%", background: "#101418", borderRadius: 2, transition: "width .25s ease-out" }} /></span>
          </span>
          <span data-demo="q-done" style={{ ...css(BTN_DARK), background: n ? "#101418" : "#c7ced8" }}>Done</span>
        </div>
      )}
    </div>
  );
}

function DraftsCard({ th }: { th: Thread }) {
  const st = th.drafts ?? {};
  const sent = DRAFTS.filter((d) => st[d.id] === "sent").length;
  const busy = DRAFTS.some((d) => st[d.id] === "sending");
  return (
    <div style={css(CARD)}>
      <div style={css(CARD_HEAD)}>
        <span style={css("width:26px;height:26px;flex:none;border-radius:8px;border:1px solid #eceef1;display:flex;align-items:center;justify-content:center")}><i className="icon-mail" style={{ fontSize: 14, color: "#4a5565" }} /></span>
        <span style={css("flex:1;font-size:14px;font-weight:500")}>First emails</span>
        <span style={css("font-size:13px;color:#6b7686")}>{sent ? sent + " of 3 sent" : DRAFTS.length + " drafts"}</span>
      </div>
      {DRAFTS.slice(0, 3).concat(DRAFTS.slice(3)).map((d, i) => {
        const s = st[d.id];
        return (
          <div key={d.id} style={{ padding: "14px 18px 14px", borderTop: i ? "1px solid #f0f2f5" : "0" }}>
            <div style={css("display:flex;align-items:center;gap:12px")}>
              <span style={{ ...css("width:32px;height:32px;flex:none;border-radius:50%;font-size:12px;font-weight:500;display:flex;align-items:center;justify-content:center"), background: d.tint[0], color: d.tint[1] }}>{d.name.split(" ").map((w) => w[0]).join("")}</span>
              <span style={css("flex:1;min-width:0")}><span style={css("display:block;font-size:14.5px;font-weight:500;line-height:1.3")}>{d.name}</span><span style={css("display:block;font-size:13px;color:#6b7686")}>{d.company}</span></span>
              {s === "sending" && <span style={css("height:24px;padding:0 10px;border-radius:999px;background:#e6f0ff;color:#0b57d0;font-size:12.5px;font-weight:500;display:flex;align-items:center;gap:5px")}><Spin />Sending</span>}
              {s === "sent" && <span style={css("height:24px;padding:0 10px;border-radius:999px;background:#e7f6ec;color:#0f7b3f;font-size:12.5px;font-weight:500;display:flex;align-items:center;gap:5px;animation:cFade .2s backwards")}><i className="icon-check" style={{ fontSize: 13, animation: "cCheck .2s ease-out backwards" }} />Sent 9:52 AM</span>}
              {s === "pending" && <span style={css("height:24px;padding:0 10px;border-radius:999px;background:#fff1e0;color:#9a5800;font-size:12.5px;font-weight:500;display:flex;align-items:center")}>Needs approval</span>}
            </div>
            <div style={css("margin-left:44px")}>
              <div style={css("margin-top:10px;font-size:15px;font-weight:500")}>{d.subject}</div>
              {i < 2 && (
                <div style={css("margin-top:6px;font-size:14.5px;line-height:1.65;color:#2a313b;white-space:pre-wrap")}>
                  {d.seg.map(([t, h], j) => <span key={j} style={{ background: h === 1 ? "#fdf0b8" : h === 2 ? "#fde2df" : "transparent", textDecoration: h === 2 ? "underline wavy #d92d20" : "none", borderRadius: 4 }}>{t}</span>)}
                </div>
              )}
              {d.flagged && (
                <div style={css("margin-top:12px;padding:10px 12px;border-radius:12px;background:#fdf2f2;font-size:13px;color:#9b1c1c;display:flex;align-items:center;gap:10px")}><i className="icon-triangle-alert" style={{ fontSize: 15 }} /><span style={{ flex: 1 }}>This claim isn’t in your approved sources.</span><span style={css("height:30px;padding:0 12px;border:1px solid #f0c5c2;border-radius:999px;background:#ffffff;color:#9b1c1c;font-size:13px;font-weight:500;display:flex;align-items:center")}>Remove it</span></div>
              )}
            </div>
          </div>
        );
      })}
      {!sent && !busy && (
        <div style={css(CARD_FOOT)}>
          <span style={css("flex:1;min-width:180px;display:flex;align-items:center;gap:8px;font-size:13px;color:#6b7686")}><span style={css("width:12px;height:12px;flex:none;border-radius:3px;background:#fdf0b8")} />Highlighted text comes from lead research.</span>
          <span data-demo="approve-all" style={{ ...css(BTN_DARK), background: "#006aff" }}>Approve 3 ready</span>
        </div>
      )}
    </div>
  );
}

function EmailThreadCard() {
  return (
    <div style={css(CARD)}>
      <div style={css(CARD_HEAD)}>
        <span style={css("width:26px;height:26px;flex:none;border-radius:8px;border:1px solid #eceef1;display:flex;align-items:center;justify-content:center")}><i className="icon-mail" style={{ fontSize: 14, color: "#4a5565" }} /></span>
        <span style={css("flex:1;font-size:14px;font-weight:500")}>Month-end at Brightloop</span>
        <span style={css("font-size:13px;color:#6b7686")}>2 messages</span>
      </div>
      <div style={css("display:flex;gap:12px;padding:14px 18px;background:#fafbfc")}>
        <span style={css("width:30px;height:30px;flex:none;border-radius:50%;background:#101418;color:#ffffff;font-size:11px;font-weight:500;display:flex;align-items:center;justify-content:center")}>AR</span>
        <div style={css("flex:1;min-width:0")}><div style={css("font-size:13px;color:#6b7686")}><b style={css("color:#2a313b;font-weight:500")}>You</b> · Oct 8, 9:14 AM</div><div style={css("margin-top:4px;font-size:14px;line-height:1.55;color:#6b7686;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden")}>Hi Dana, saw Brightloop just crossed 200 people. That’s usually when month-end starts taking a full week…</div></div>
      </div>
      <div style={css("display:flex;gap:12px;padding:14px 18px 16px;border-top:1px solid #f0f2f5")}>
        <span style={css("width:30px;height:30px;flex:none;border-radius:50%;background:#e6f0ff;color:#0b57d0;font-size:11px;font-weight:500;display:flex;align-items:center;justify-content:center")}>DW</span>
        <div style={css("flex:1;min-width:0")}>
          <div style={css("display:flex;align-items:center;gap:8px;font-size:13px;color:#6b7686")}><b style={css("color:#101418;font-weight:500")}>Dana Whitfield</b> · 12 min ago<span style={css("height:20px;padding:0 8px;border-radius:999px;background:#e6f0ff;color:#0b57d0;font-size:11.5px;font-weight:500;display:flex;align-items:center")}>Replied</span></div>
          <div style={css("margin-top:6px;font-size:15px;line-height:1.55;color:#101418")}>Hi Maya, timing is actually good. We’re still closing in spreadsheets and it’s painful. Can you send pricing and a couple of times next week?</div>
        </div>
      </div>
    </div>
  );
}

function SuggestCard({ th }: { th: Thread }) {
  const s = th.sugg ?? "open";
  return (
    <div style={css(CARD)}>
      <div style={css(CARD_HEAD)}>
        <span style={css("width:26px;height:26px;flex:none;border-radius:8px;background:#e6f0ff;display:flex;align-items:center;justify-content:center")}><i className="icon-sparkles" style={{ fontSize: 14, color: "#0b57d0" }} /></span>
        <span style={css("flex:1;font-size:14px;font-weight:500")}>Suggested reply</span>
        <span style={{ ...css("height:24px;padding:0 10px;border-radius:999px;font-size:12.5px;font-weight:500;display:flex;align-items:center;gap:5px;transition:background .2s,color .2s"), background: s === "sent" ? "#e7f6ec" : "#fff1e0", color: s === "sent" ? "#0f7b3f" : "#9a5800" }}>{s === "sent" && <i className="icon-check" style={{ fontSize: 13, animation: "cCheck .2s ease-out backwards" }} />}{s === "sent" ? "Sent" : "Needs approval"}</span>
      </div>
      <div style={css("padding:14px 18px 16px")}>
        <div style={css("font-size:13px;color:#6b7686")}>To <b style={css("color:#2a313b;font-weight:500")}>Dana Whitfield</b> · from Maya</div>
        <div style={css("margin-top:10px;font-size:15px;line-height:1.65;white-space:pre-wrap;color:#101418")}>{"Hi Dana,\n\nGlad the timing works. Pricing is here: tallyroom.com/pricing.\n\nWould Tuesday at 10:00 or Wednesday at 2:00 (your time) work for 20 minutes?\n\nMaya"}</div>
      </div>
      {s !== "sent" && (
        <div style={css(CARD_FOOT)}>
          <span data-demo="cs-send" style={css(BTN_DARK + ";min-width:150px")}>{s === "sending" ? <Spin c="#ffffff" b="rgba(255,255,255,.4)" s={12} /> : <i className="icon-send" style={{ fontSize: 14 }} />}Approve and send</span>
          <span style={css(BTN_LIGHT + ";display:flex;align-items:center")}>Edit</span>
          <span style={css(BTN_GHOST + ";display:flex;align-items:center")}>Don’t send</span>
        </div>
      )}
    </div>
  );
}

function BounceCard({ th }: { th: Thread }) {
  const s = th.bounce ?? "open";
  return (
    <div style={css(CARD)}>
      <div style={css(CARD_HEAD)}>
        <span style={css("width:26px;height:26px;flex:none;border-radius:8px;background:#fdecea;display:flex;align-items:center;justify-content:center")}><i className="icon-mail-x" style={{ fontSize: 14, color: "#b42318" }} /></span>
        <span style={css("flex:1;font-size:14px;font-weight:500")}>Email bounced</span>
        <span style={css("font-size:13px;color:#6b7686")}>Oct 8</span>
      </div>
      <div style={css("padding:16px 18px")}>
        <div style={css("display:flex;align-items:center;gap:12px")}>
          <span style={css("width:32px;height:32px;flex:none;border-radius:50%;background:#e5f6f8;color:#0e6f7a;font-size:12px;font-weight:500;display:flex;align-items:center;justify-content:center")}>OP</span>
          <span><span style={css("display:block;font-size:14.5px;font-weight:500;line-height:1.3")}>Owen Pryce</span><span style={css("display:block;font-size:13px;color:#6b7686")}>Head of FP&amp;A, Tidewater Labs</span></span>
        </div>
        <div style={css("margin-top:14px;border:1px solid #eceef1;border-radius:12px")}>
          <div style={css("display:flex;align-items:center;gap:10px;min-height:44px;padding:0 14px;font-size:14px")}><i className="icon-circle-x" style={{ fontSize: 16, color: "#b42318" }} /><span style={css("flex:1;text-decoration:line-through;color:#8a94a3")}>owen@tidewaterlabs.io</span><span style={css("font-size:12.5px;color:#b42318")}>Bounced</span></div>
          <div style={css("display:flex;align-items:center;gap:10px;min-height:44px;padding:0 14px;border-top:1px solid #f0f2f5;font-size:14px")}><i className="icon-circle-check" style={{ fontSize: 16, color: "#0f7b3f" }} /><span style={{ flex: 1 }}>owen.pryce@tidewaterlabs.io</span><span style={css("font-size:12.5px;color:#0f7b3f")}>{s === "done" ? "Sent just now" : "Found on team page"}</span></div>
        </div>
      </div>
      {s !== "done" && (
        <div style={css(CARD_FOOT)}>
          <span data-demo="cb-retry" style={css(BTN_DARK + ";min-width:190px")}>{s === "sending" && <Spin c="#ffffff" b="rgba(255,255,255,.4)" s={12} />}Send to the new address</span>
          <span style={css(BTN_LIGHT + ";display:flex;align-items:center")}>Stop emailing Owen</span>
          <span style={css("flex-basis:100%;display:flex;align-items:center;gap:6px;font-size:13px;color:#6b7686")}><i className="icon-info" style={{ fontSize: 14 }} />The first email never arrived, so this won’t send twice.</span>
        </div>
      )}
    </div>
  );
}
