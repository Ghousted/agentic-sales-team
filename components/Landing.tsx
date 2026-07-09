"use client";
// Marketing front door shown to logged-out visitors before the auth screen.
// The hero features the shared <Constellation/> (illustrated agents orbiting a
// goal ring); everything below stays calm and light. CTAs hand off to the
// existing <Login> via the store's showAuth flag. Scroll reveals + hero parallax
// are GSAP ScrollTrigger; the constellation's own entrance is anime.js.
import { useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { useApp } from "@/lib/store";
import { css } from "./primitives";
import { av } from "@/lib/visuals";
import { AGENT_TYPES, CAPABILITIES } from "@/lib/agentTypes";
import Constellation, { DEMO } from "./Constellation";

gsap.registerPlugin(ScrollTrigger, useGSAP);

// Capability → accent colour, matching the app's hub icon palette.
const CAP_COLOR: Record<string, string> = {
  scrape: "#0EA5E9", research: "#F59E0B", outreach: "#5122C1", "follow-up": "#8B5CF6",
  "book-meeting": "#F43F7E", qualify: "#2FA45C", proposal: "#7C3AED", enrich: "#0EA5E9",
  match: "#EC4899", assess: "#F59E0B",
};
const CAP_LABEL: Record<string, string> = Object.fromEntries(CAPABILITIES.map((c) => [c.id, c.label]));

// The roster shown in "Meet your team": a curated slice of AGENT_TYPES, each
// with a sprite character + accent, resolved to its real label/desc/capabilities.
const ROSTER = [
  { id: "sdr", char: 5, color: "#0EA5E9" },
  { id: "closer", char: 7, color: "#8B5CF6" },
  { id: "meeting", char: 1, color: "#F43F7E" },
  { id: "matchmaker", char: 11, color: "#EC4899" },
  { id: "qualifier", char: 3, color: "#2FA45C" },
  { id: "researcher", char: 9, color: "#F59E0B" },
  { id: "followup", char: 12, color: "#8B5CF6" },
  { id: "scout", char: 4, color: "#5122C1" },
];

// The real end-to-end funnel — numbered because order carries meaning here.
const PIPELINE = [
  { n: "01", cap: "scrape", title: "Scrape", line: "Find prospects that match your ICP." },
  { n: "02", cap: "research", title: "Research", line: "Enrich each lead with a research brief." },
  { n: "03", cap: "qualify", title: "Qualify", line: "Score & prioritise — hot, warm, cold." },
  { n: "04", cap: "outreach", title: "Outreach", line: "Draft personalised, grounded emails." },
  { n: "05", cap: "follow-up", title: "Follow up", line: "Re-engage the ones who go quiet." },
  { n: "06", cap: "book-meeting", title: "Book", line: "Put the meeting on your calendar." },
];

// Group-chat demo: mirrors the app's real scrape → qualify → outreach → book chain.
const CHAT = [
  { who: "d-maya", text: "On it — searching fintech CTOs at 51–200-employee companies on AWS." },
  { who: "d-maya", text: "Found 47 leads. Passing the strongest to Theo." },
  { who: "d-theo", text: "Scored the book — 9 hot, 21 warm. Prioritising the 9." },
  { who: "d-kai", text: "Drafted 9 personalised emails, each grounded in the prospect’s stack. They’re in your Emails tab." },
  { who: "d-ava", text: "Ramp replied — booked a demo for Friday 10:00. It’s on your calendar." },
];
const demoById = (id: string) => DEMO.find((d) => d.id === id)!;

export default function Landing() {
  const { set } = useApp();
  const startFree = () => set({ showAuth: true, authMode: "signup" });
  const signIn = () => set({ showAuth: true, authMode: "login" });

  const rootRef = useRef<HTMLDivElement>(null);

  // Scroll-driven reveals. Gated behind matchMedia so reduced-motion visitors
  // get everything visible and static (nothing is pre-hidden in CSS). useGSAP
  // runs before paint and auto-reverts on unmount.
  useGSAP(() => {
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.utils.toArray<HTMLElement>(".lp-sec").forEach((sec) => {
        const intro = sec.querySelectorAll(".lp-eyebrow-d, .lp-h2, .lp-sec-sub");
        if (intro.length) {
          gsap.from(intro, {
            y: 22, autoAlpha: 0, duration: 0.6, ease: "power2.out", stagger: 0.08,
            scrollTrigger: { trigger: sec, start: "top 78%" },
          });
        }
      });

      const group = (targets: string, trigger: string, stagger: number, y = 26) =>
        gsap.from(targets, {
          y, autoAlpha: 0, duration: 0.55, ease: "power2.out", stagger,
          scrollTrigger: { trigger, start: "top 82%" },
        });
      group(".lp-card", ".lp-roster", 0.07);
      group(".lp-step", ".lp-pipe", 0.06, 22);
      group(".lp-msg", ".lp-chat", 0.12, 16);

      gsap.from(".lp-cta-in > *", {
        y: 24, autoAlpha: 0, duration: 0.6, ease: "power2.out", stagger: 0.1,
        scrollTrigger: { trigger: ".lp-cta", start: "top 80%" },
      });

      const par = (target: string, y: number) =>
        gsap.to(target, {
          y, ease: "none",
          scrollTrigger: { trigger: ".lp-hero", start: "top top", end: "bottom top", scrub: true },
        });
      par(".lp-blob-a", 90);
      par(".lp-blob-b", -60);
      par(".lp-stage-wrap", -34);
    });
  }, { scope: rootRef });

  return (
    <div className="lp" ref={rootRef}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* ───────────── top bar ───────────── */}
      <header className="lp-bar">
        <div className="lp-bar-in">
          <div className="lp-word"><span style={{ color: "#C9B8F5" }}>agentic</span> salesforce</div>
          <nav className="lp-nav">
            <button className="lp-btn lp-btn-ghost-d" onClick={signIn}>Sign in</button>
            <button className="lp-btn lp-btn-primary" onClick={startFree}>Get started</button>
          </nav>
        </div>
      </header>

      {/* ───────────── hero ───────────── */}
      <section className="lp-hero">
        <div className="lp-blob lp-blob-a" aria-hidden="true" />
        <div className="lp-blob lp-blob-b" aria-hidden="true" />
        <div className="lp-hero-grid">
          <div className="lp-copy">
            <div className="lp-eyebrow lp-mono">✦ YOUR AI SALES WORKFORCE</div>
            <h1 className="lp-h1">Build a sales team that <span className="lp-h1-accent">runs itself.</span></h1>
            <p className="lp-sub">
              Assemble AI agents that scrape leads, research them, write the outreach, follow up,
              and book the meeting — working your whole book around the clock while you watch every
              move in the group chat.
            </p>
            <div className="lp-cta-row">
              <button className="lp-btn lp-btn-lg lp-btn-primary" onClick={startFree}>Get started →</button>
              <button className="lp-btn lp-btn-lg lp-btn-ghost-d" onClick={signIn}>Sign in</button>
            </div>
            <div className="lp-trust lp-mono">Spin up your first agent in minutes — no seed data, no fake dashboards.</div>
          </div>

          <Constellation />
        </div>
      </section>

      {/* ───────────── meet your team ───────────── */}
      <section className="lp-sec">
        <div className="lp-wrap">
          <div className="lp-eyebrow lp-eyebrow-d lp-mono">BUILD YOUR ROSTER</div>
          <h2 className="lp-h2 lp-poetsen">Meet your team</h2>
          <p className="lp-sec-sub">
            Start from a role — SDR, Closer, Matchmaker — or compose your own from capabilities.
            Every agent comes ready to work the moment you hire it.
          </p>
          <div className="lp-roster">
            {ROSTER.map((r) => {
              const t = AGENT_TYPES.find((x) => x.id === r.id);
              if (!t) return null;
              return (
                <div key={r.id} className="lp-card">
                  <div className="lp-card-head">
                    <span style={{ ...css(av({ id: "card-" + r.id, color: r.color, char: r.char }, 46)), border: `2px solid ${r.color}33` }} aria-hidden="true" />
                    <div>
                      <div className="lp-card-role">{t.label}</div>
                      <div className="lp-card-tag lp-mono" style={{ color: r.color }}>AGENT</div>
                    </div>
                  </div>
                  <p className="lp-card-desc">{t.desc}</p>
                  <div className="lp-chips">
                    {t.capabilities.slice(0, 4).map((c) => (
                      <span key={c} className="lp-chip" style={{ color: CAP_COLOR[c], background: CAP_COLOR[c] + "14" }}>
                        {CAP_LABEL[c] ?? c}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ───────────── how it works ───────────── */}
      <section className="lp-sec lp-sec-tint">
        <div className="lp-wrap">
          <div className="lp-eyebrow lp-eyebrow-d lp-mono">THE FUNNEL, AUTOMATED</div>
          <h2 className="lp-h2">From a cold list to a booked meeting.</h2>
          <p className="lp-sec-sub">
            Every capability is a real engine your agents run. Chain them into a pod and the whole
            funnel works end to end — no hand-offs dropped.
          </p>
          <div className="lp-pipe">
            {PIPELINE.map((s) => (
              <div key={s.n} className="lp-step">
                <div className="lp-step-top">
                  <span className="lp-step-n lp-mono">{s.n}</span>
                  <span className="lp-step-dot" style={{ background: CAP_COLOR[s.cap] }} />
                </div>
                <div className="lp-step-title">{s.title}</div>
                <div className="lp-step-line">{s.line}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ───────────── watch them work ───────────── */}
      <section className="lp-sec">
        <div className="lp-wrap lp-work">
          <div className="lp-work-copy">
            <div className="lp-eyebrow lp-eyebrow-d lp-mono">WATCH THEM WORK</div>
            <h2 className="lp-h2">They narrate every move.</h2>
            <p className="lp-sec-sub lp-sec-sub-l">
              Command the team in plain language. They pick up the work, run it for real, and report
              back in the group chat — so you always know exactly what your workforce is doing.
            </p>
            <button className="lp-btn lp-btn-lg lp-btn-dark" onClick={startFree}>Start commanding your team →</button>
          </div>
          <div className="lp-chat" aria-label="Example group chat with the AI sales team">
            <div className="lp-chat-bar">
              <span className="lp-chat-dot" /><span className="lp-chat-dot" /><span className="lp-chat-dot" />
              <span className="lp-chat-title lp-mono">outbound-pod · group chat</span>
            </div>
            <div className="lp-chat-body">
              <div className="lp-msg lp-msg-me">
                <div className="lp-bubble-me">@team find 50 fintech CTOs on AWS, qualify them, and draft outreach.</div>
              </div>
              {CHAT.map((m, i) => {
                const a = demoById(m.who);
                return (
                  <div key={i} className="lp-msg">
                    <span className="lp-msg-av" style={css(av(a, 30))} aria-hidden="true" />
                    <div className="lp-bubble">
                      <div className="lp-bubble-name" style={{ color: a.color }}>{a.name} <span className="lp-bubble-role lp-mono">{a.role}</span></div>
                      {m.text}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ───────────── cta band ───────────── */}
      <section className="lp-cta">
        <div className="lp-blob lp-blob-c" aria-hidden="true" />
        <div className="lp-wrap lp-cta-in">
          <h2 className="lp-cta-h lp-poetsen">Put your sales floor on autopilot.</h2>
          <p className="lp-cta-p">Build your workforce today. They start working the moment they’re hired.</p>
          <div className="lp-cta-row lp-cta-row-c">
            <button className="lp-btn lp-btn-lg lp-btn-primary" onClick={startFree}>Get started →</button>
            <button className="lp-btn lp-btn-lg lp-btn-ghost-d" onClick={signIn}>Sign in</button>
          </div>
        </div>
      </section>

      <footer className="lp-foot">
        <div className="lp-wrap lp-foot-in">
          <div className="lp-word lp-word-dark"><span style={{ color: "#5122C1" }}>agentic</span> salesforce</div>
          <div className="lp-foot-tag">The command center for your AI sales workforce.</div>
        </div>
      </footer>
    </div>
  );
}

const CSS = `
.lp{font-family:Inter,system-ui,sans-serif;color:#18181B;background:#FAFAFB;overflow-x:hidden;line-height:1.5;}
.lp *{box-sizing:border-box;}
.lp-wrap{max-width:1180px;margin:0 auto;padding:0 32px;}
.lp-mono{font-family:'JetBrains Mono',ui-monospace,monospace;}
.lp-poetsen{font-family:'Poetsen One',sans-serif;font-weight:400;}

/* buttons */
.lp-btn{font-family:inherit;font-size:14px;font-weight:600;border-radius:99px;padding:9px 18px;cursor:pointer;border:1px solid transparent;white-space:nowrap;transition:transform .12s ease,background .15s ease,box-shadow .15s ease,border-color .15s ease;}
.lp-btn-lg{font-size:16px;padding:13px 26px;}
.lp-btn-primary{color:#fff;border:none;background:linear-gradient(180deg,#6B3FE0,#5122C1);box-shadow:0 4px 16px rgba(81,34,193,.4);}
.lp-btn-primary:hover{background:linear-gradient(180deg,#5b32d0,#42199E);box-shadow:0 6px 22px rgba(81,34,193,.5);transform:translateY(-1px);}
.lp-btn-ghost-d{color:#EDE7FB;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.22);}
.lp-btn-ghost-d:hover{background:rgba(255,255,255,.12);border-color:#C9B8F5;}
.lp-btn-dark{color:#fff;background:#18181B;border:none;}
.lp-btn-dark:hover{background:#3F3F46;transform:translateY(-1px);}

/* top bar */
.lp-bar{position:absolute;top:0;left:0;right:0;z-index:5;}
.lp-bar-in{max-width:1180px;margin:0 auto;padding:20px 32px;display:flex;align-items:center;gap:16px;}
.lp-word{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:16px;font-weight:700;letter-spacing:-.01em;line-height:1;color:#fff;}
.lp-word-dark{color:#18181B;}
.lp-nav{margin-left:auto;display:flex;align-items:center;gap:10px;}

/* hero */
.lp-hero{position:relative;background:radial-gradient(1100px 660px at 72% 32%,#2A1657,#150B33 74%);color:#fff;overflow:hidden;}
.lp-blob{position:absolute;border-radius:50%;filter:blur(70px);opacity:.5;pointer-events:none;animation:breathe 9s ease-in-out infinite;}
.lp-blob-a{width:420px;height:420px;background:#7C3AED;top:-80px;right:8%;}
.lp-blob-b{width:360px;height:360px;background:#F43F7E;bottom:-120px;left:4%;opacity:.28;animation-delay:2s;}
.lp-hero-grid{position:relative;z-index:2;max-width:1180px;margin:0 auto;padding:148px 32px 108px;display:grid;grid-template-columns:1.04fr .96fr;gap:44px;align-items:center;}
.lp-eyebrow{font-size:12px;font-weight:600;letter-spacing:.16em;color:#B9AAE6;margin-bottom:20px;}
.lp-h1{font-size:clamp(38px,5.4vw,66px);font-weight:800;letter-spacing:-.03em;line-height:1.03;margin:0;}
.lp-h1-accent{background:linear-gradient(90deg,#C9B8F5,#F0B9D6);-webkit-background-clip:text;background-clip:text;color:transparent;}
.lp-sub{font-size:18px;line-height:1.6;color:#CFC6EA;max-width:33em;margin:22px 0 30px;}
.lp-cta-row{display:flex;gap:12px;flex-wrap:wrap;}
.lp-trust{font-size:12px;color:#A99BD8;margin-top:22px;letter-spacing:.01em;}

/* sections */
.lp-sec{padding:104px 0;}
.lp-sec-tint{background:linear-gradient(180deg,#F4F1FB,#FAFAFB);}
.lp-eyebrow-d{color:#7C6BB0;margin-bottom:14px;}
.lp-h2{font-size:clamp(28px,3.6vw,42px);font-weight:800;letter-spacing:-.02em;line-height:1.08;margin:0 0 16px;}
.lp-h2.lp-poetsen{font-weight:400;letter-spacing:-.01em;}
.lp-sec-sub{font-size:17px;color:#52525B;max-width:34em;margin:0 0 44px;line-height:1.6;}

/* roster */
.lp-roster{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;}
.lp-card{background:#fff;border:1px solid #ECECF1;border-radius:18px;padding:20px;box-shadow:0 1px 3px rgba(24,24,27,.04);transition:transform .16s ease,box-shadow .16s ease;}
.lp-card:hover{transform:translateY(-4px);box-shadow:0 14px 30px rgba(24,24,27,.09);}
.lp-card-head{display:flex;align-items:center;gap:12px;margin-bottom:14px;}
.lp-card-role{font-size:15px;font-weight:700;letter-spacing:-.01em;}
.lp-card-tag{font-size:9.5px;font-weight:700;letter-spacing:.14em;margin-top:2px;}
.lp-card-desc{font-size:13px;color:#71717A;line-height:1.55;margin:0 0 16px;min-height:40px;}
.lp-chips{display:flex;flex-wrap:wrap;gap:6px;}
.lp-chip{font-size:11px;font-weight:600;border-radius:99px;padding:3px 10px;}

/* pipeline */
.lp-pipe{display:grid;grid-template-columns:repeat(6,1fr);gap:14px;}
.lp-step{background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:20px 18px;position:relative;}
.lp-step-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;}
.lp-step-n{font-size:13px;font-weight:600;color:#C4B9E6;letter-spacing:.05em;}
.lp-step-dot{width:12px;height:12px;border-radius:50%;box-shadow:0 0 0 4px rgba(0,0,0,.03);}
.lp-step-title{font-size:15.5px;font-weight:700;margin-bottom:6px;letter-spacing:-.01em;}
.lp-step-line{font-size:12.5px;color:#71717A;line-height:1.5;}

/* watch them work */
.lp-work{display:grid;grid-template-columns:1fr 1fr;gap:56px;align-items:center;}
.lp-sec-sub-l{margin-bottom:32px;}
.lp-chat{background:#fff;border:1px solid #E7E4F0;border-radius:20px;box-shadow:0 22px 60px rgba(42,22,87,.14);overflow:hidden;}
.lp-chat-bar{display:flex;align-items:center;gap:7px;padding:14px 18px;border-bottom:1px solid #F0EEF6;background:#FBFAFE;}
.lp-chat-dot{width:10px;height:10px;border-radius:50%;background:#E4E0EF;}
.lp-chat-title{margin-left:10px;font-size:12px;color:#8A82A6;letter-spacing:.02em;}
.lp-chat-body{padding:20px 18px;display:flex;flex-direction:column;gap:14px;}
.lp-msg{display:flex;align-items:flex-start;gap:10px;}
.lp-msg-me{justify-content:flex-end;}
.lp-msg-av{flex:none;margin-top:2px;}
.lp-bubble{background:#F5F3FB;border:1px solid #ECE8F7;border-radius:4px 14px 14px 14px;padding:10px 14px;font-size:13.5px;color:#3F3A52;line-height:1.5;max-width:80%;}
.lp-bubble-name{font-size:12px;font-weight:700;margin-bottom:3px;}
.lp-bubble-role{font-size:9.5px;font-weight:600;letter-spacing:.1em;color:#A79FC0;margin-left:4px;}
.lp-bubble-me{background:linear-gradient(180deg,#6B3FE0,#5122C1);color:#fff;border-radius:14px 14px 4px 14px;padding:11px 15px;font-size:13.5px;line-height:1.5;max-width:82%;box-shadow:0 4px 14px rgba(81,34,193,.28);}

/* cta band */
.lp-cta{position:relative;background:radial-gradient(900px 500px at 50% 0%,#2A1657,#150B33 78%);color:#fff;padding:100px 0;overflow:hidden;text-align:center;}
.lp-blob-c{width:520px;height:340px;background:#7C3AED;top:-120px;left:50%;transform:translateX(-50%);opacity:.35;}
.lp-cta-in{position:relative;z-index:2;display:flex;flex-direction:column;align-items:center;}
.lp-cta-h{font-size:clamp(30px,4.4vw,52px);letter-spacing:-.01em;line-height:1.08;margin:0 0 16px;}
.lp-cta-p{font-size:18px;color:#CFC6EA;margin:0 0 34px;}
.lp-cta-row-c{justify-content:center;}

/* footer */
.lp-foot{background:#FAFAFB;border-top:1px solid #ECECF1;padding:34px 0;}
.lp-foot-in{display:flex;align-items:center;gap:16px;flex-wrap:wrap;}
.lp-foot-tag{font-size:13px;color:#A1A1AA;}

@media (max-width:960px){
  .lp-hero-grid{grid-template-columns:1fr;gap:8px;padding:128px 32px 84px;text-align:left;}
  .lp-roster{grid-template-columns:repeat(2,1fr);}
  .lp-pipe{grid-template-columns:repeat(3,1fr);}
  .lp-work{grid-template-columns:1fr;gap:36px;}
  .lp-sec{padding:80px 0;}
}
@media (max-width:600px){
  .lp-wrap,.lp-bar-in,.lp-hero-grid{padding-left:20px;padding-right:20px;}
  .lp-nav .lp-btn-ghost-d{display:none;}
  .lp-roster{grid-template-columns:1fr 1fr;gap:12px;}
  .lp-pipe{grid-template-columns:1fr 1fr;}
  .lp-card-desc{min-height:0;}
  .lp-sub{font-size:16px;}
  .lp-cta-row{width:100%;}
  .lp-cta-row .lp-btn{flex:1;text-align:center;}
}
@media (prefers-reduced-motion:reduce){
  .lp *{animation:none !important;transition:none !important;}
}
`;
