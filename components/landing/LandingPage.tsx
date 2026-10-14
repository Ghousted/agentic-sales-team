"use client";
// Marketing front door for logged-out visitors, ported from the "Agentic
// Salesforce - Updated" Claude Design file: loading screen, dot-field hero with
// a tilting live product demo, 3D agent cubes, how-it-works, the "agents
// message you" inbox, per-agent rules, trust grid, plans and a final CTA, with
// the design's GSAP ScrollTrigger choreography. CTAs hand off to <Login> via
// the store's showAuth flag.
import { useCallback, useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useApp } from "@/lib/store";
import { css } from "../primitives";
import DotField from "./DotField";
import HeroDemo from "./HeroDemo";
import { LANDING_CSS } from "./landingCss";
import { AG, avBg, TEAM, STEPS, KINDS, KREPLY, RULES, RPREV, PROMISES, TRUST, PLANS, FOOT, type AgentId } from "./data";

// Hand-off from the hero email field to the sign-up form.
export const SIGNUP_EMAIL_KEY = "as:signupEmail";

const NAME = "Agentic Salesforce";
const AGENT_IDS: AgentId[] = ["theo", "priya", "maya", "sam"];
const reduced = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/* ---------- small shared pieces ---------- */
function Corners({ size, off, top, bottom }: { size: number; off: number; top: string; bottom?: string }) {
  const b = (c: string, w: string, pos: React.CSSProperties) => <span aria-hidden="true" style={{ position: "absolute", width: size, height: size, borderColor: c, borderStyle: "solid", borderWidth: w, pointerEvents: "none", zIndex: 2, ...pos }} />;
  const bt = bottom ?? top;
  return (<>
    {b(top, "1.5px 0 0 1.5px", { left: -off, top: -off })}{b(top, "1.5px 1.5px 0 0", { right: -off, top: -off })}
    {b(bt, "0 0 1.5px 1.5px", { left: -off, bottom: -off })}{b(bt, "0 1.5px 1.5px 0", { right: -off, bottom: -off })}
  </>);
}
const Spark = () => <svg aria-hidden="true" viewBox="0 0 16 16" style={{ width: 16, height: 16, flex: "none" }}><path d="M8 0v6M8 10v6M0 8h6M10 8h6" stroke="currentColor" strokeWidth="1.2" fill="none" /></svg>;
function Band() {
  return (
    <div aria-hidden="true" data-gs="band" style={css("position:relative;z-index:2;width:calc(min(1232px,calc(100% - 32px)) + 16px);height:44px;margin:0 auto;display:flex;align-items:center;gap:14px;color:rgba(0,106,255,.5)")}>
      {[0, 1, 2, 3].map((i) => <BandSeg key={i} />)}<Spark />
    </div>
  );
}
const BandSeg = () => <><Spark /><span style={css("flex:1;height:1px;background:rgba(0,106,255,.16)")} /></>;

/* ---------- page ---------- */
export default function LandingPage() {
  const { set } = useApp();
  const goLogin = (e?: React.SyntheticEvent) => { e?.preventDefault(); set({ showAuth: true, authMode: "login" }); };
  const goSignup = useCallback((e?: React.SyntheticEvent, email?: string) => {
    e?.preventDefault();
    try { if (email) sessionStorage.setItem(SIGNUP_EMAIL_KEY, email); } catch { /* storage unavailable */ }
    set({ showAuth: true, authMode: "signup" });
  }, [set]);

  const [w, setW] = useState(1440);
  const [ld, setLd] = useState<"on" | "out" | "done">("on");
  const [tp, setTp] = useState(0);

  // viewport width + hero tilt progress (flattens over the first 520px of scroll)
  useEffect(() => {
    const onR = () => setW(window.innerWidth);
    let raf = 0;
    const onT = () => {
      raf = 0;
      const flat = window.innerHeight > 1500 || document.documentElement.scrollHeight - window.innerHeight < 300;
      setTp(flat || reduced() ? 1 : Math.max(0, Math.min(1, window.scrollY / 520)));
    };
    const onS = () => { if (!raf) raf = requestAnimationFrame(onT); };
    onR(); onT();
    window.addEventListener("resize", onR);
    window.addEventListener("scroll", onS, { passive: true });
    return () => { window.removeEventListener("resize", onR); window.removeEventListener("scroll", onS); cancelAnimationFrame(raf); };
  }, []);

  // loading screen: at least 3s, then slides up and the hero copy rises in
  useEffect(() => {
    const t0 = performance.now(), min = reduced() ? 250 : 3000;
    const timers: number[] = [];
    let heroCtx: gsap.Context | null = null;
    const done = () => {
      timers.push(window.setTimeout(() => {
        setLd("out");
        timers.push(window.setTimeout(() => { setLd("done"); ScrollTrigger.refresh(); }, 900));
        if (!reduced() && window.innerHeight <= 1500) {
          heroCtx = gsap.context(() => { gsap.from("[data-gs-hero]", { y: 30, opacity: 0, duration: 0.9, ease: "power3.out", stagger: 0.09, delay: 0.15, clearProps: "transform,opacity" }); });
        }
      }, Math.max(0, min - (performance.now() - t0))));
    };
    if (document.readyState === "complete") done(); else window.addEventListener("load", done, { once: true });
    return () => { timers.forEach(clearTimeout); window.removeEventListener("load", done); heroCtx?.revert(); };
  }, []);

  // GSAP ScrollTrigger choreography
  useEffect(() => {
    if (reduced() || window.innerHeight > 1500) return;
    gsap.registerPlugin(ScrollTrigger);
    const ctx = gsap.context(() => {
      const q = (sel: string) => Array.from(document.querySelectorAll<HTMLElement>(sel));
      gsap.to('[data-gs="progress"]', { scaleX: 1, ease: "none", scrollTrigger: { start: 0, end: "max", scrub: 0.3 } });
      gsap.set("[data-rv]", { opacity: 0, y: 40 });
      ScrollTrigger.batch("[data-rv]", { start: "top 88%", once: true, onEnter: (els) => { gsap.to(els, { opacity: 1, y: 0, duration: 0.9, ease: "power3.out", stagger: 0.12, overwrite: true }); } });
      q('[data-gs="band"]').forEach((band) => {
        gsap.timeline({ scrollTrigger: { trigger: band, start: "top 92%", once: true } })
          .from(band.querySelectorAll(":scope > span"), { scaleX: 0, transformOrigin: "50% 50%", duration: 0.9, ease: "power3.inOut", stagger: 0.07 })
          .from(band.querySelectorAll("svg"), { rotate: -90, scale: 0, opacity: 0, duration: 0.6, ease: "back.out(2)", stagger: 0.06 }, "<0.2");
      });
      const spine = document.querySelector<HTMLElement>('[data-gs="spine"]');
      if (spine) gsap.from(spine, { scaleY: 0, transformOrigin: "50% 0", ease: "none", scrollTrigger: { trigger: spine.parentElement, start: "top 75%", end: "bottom 55%", scrub: 0.6 } });
      const steps = q('[data-gs="step"]');
      if (steps.length) gsap.from(steps, { scale: 0.97, opacity: 0, transformOrigin: "50% 50%", duration: 0.7, ease: "power3.out", stagger: 0.12, clearProps: "transform,opacity", scrollTrigger: { trigger: steps[0], start: "top 85%", once: true } });
      gsap.set('[data-gs="cell"]', { opacity: 0, y: 26, scale: 0.95 });
      ScrollTrigger.batch('[data-gs="cell"]', { start: "top 88%", once: true, onEnter: (els) => { gsap.to(els, { opacity: 1, y: 0, scale: 1, duration: 0.8, ease: "power3.out", stagger: 0.12, overwrite: true }); } });
      const link = document.querySelector<HTMLElement>('[data-gs="plan-link"]'), plans = q('[data-gs="plan"]');
      if (plans.length) {
        const tl = gsap.timeline({ scrollTrigger: { trigger: link || plans[0], start: "top 82%", once: true } });
        if (link && getComputedStyle(link).display !== "none") tl.from(link.children, { scaleY: 0, transformOrigin: "50% 0", opacity: 0, duration: 0.45, ease: "power2.out", stagger: 0.1 });
        tl.from(plans, { y: 54, opacity: 0, duration: 0.85, ease: "power3.out", stagger: 0.12 }, link ? "-=0.15" : 0);
      }
      const cta = document.querySelector<HTMLElement>('[data-gs="cta"]');
      if (cta) gsap.fromTo(cta, { scale: 0.9, opacity: 0.6 }, { scale: 1, opacity: 1, ease: "none", scrollTrigger: { trigger: cta, start: "top bottom", end: "center 62%", scrub: 0.5 } });
    });
    // If animation frames never run (hidden tab, preview), undo so nothing stays hidden.
    const f0 = gsap.ticker.frame;
    const safety = window.setTimeout(() => { if (gsap.ticker.frame - f0 < 3) ctx.revert(); }, 3500);
    return () => { clearTimeout(safety); ctx.revert(); };
  }, []);

  const isM = w < 760;
  const tilt = (() => { const e = 1 - Math.pow(1 - tp, 3); return "perspective(1800px) rotateX(" + (48 * (1 - e)).toFixed(2) + "deg) scale(" + (0.92 + 0.08 * e).toFixed(4) + ")"; })();
  const scrollTo = (id: string) => { const el = document.getElementById(id); if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 70, behavior: "smooth" }); };

  return (
    <div className="lp">
      <style dangerouslySetInnerHTML={{ __html: LANDING_CSS }} />
      <div aria-hidden="true" data-gs="progress" style={css("position:fixed;left:0;right:0;top:0;height:3px;z-index:60;transform:scaleX(0);transform-origin:0 50%;background:linear-gradient(90deg,#0047b3,#006aff,#5c9dff);box-shadow:0 0 12px rgba(0,106,255,.6);pointer-events:none")} />
      {ld !== "done" && <Loader out={ld === "out"} />}
      <div aria-hidden="true" style={css("position:absolute;top:0;bottom:0;left:50%;z-index:2;width:min(1232px,calc(100% - 32px));transform:translateX(-50%);border-left:1px solid rgba(0,106,255,.16);border-right:1px solid rgba(0,106,255,.16);pointer-events:none")} />

      {/* ===== nav ===== */}
      <header style={css("position:sticky;top:0;z-index:30;height:92px;margin-bottom:-92px;padding:16px 24px 0;pointer-events:none")}>
        <div style={css("pointer-events:auto;position:relative;max-width:1200px;margin:0 auto;height:64px;padding:0 10px 0 20px;display:flex;align-items:center;gap:28px;border:1px solid rgba(16,20,24,.08);background:rgba(255,255,255,.94);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);color:#101418;box-shadow:0 14px 34px -18px rgba(0,30,90,.4)")}>
          <Corners size={10} off={6} top="rgba(0,106,255,.55)" />
          <a href="#" className="lp-logo" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }} style={css("flex:none;display:flex;align-items:center;gap:10px;color:#101418;transition:opacity .15s")}>
            <span style={css("width:34px;height:34px;background:url('/logo-mark.png') center/cover no-repeat")} />
            <span style={css("font-size:15px;font-weight:600;letter-spacing:-.01em")}>{NAME}</span>
          </a>
          {!isM && (
            <nav aria-label="Main" style={css("flex:1;display:flex;align-items:center;justify-content:center;gap:34px;font-size:14.5px")}>
              {[["agents", "Agents"], ["how", "How it works"], ["control", "Control"], ["plans", "Plans"]].map(([id, t]) => (
                <a key={id} href={"#" + id} className="nl" onClick={(e) => { e.preventDefault(); scrollTo(id); }} style={css("color:#2a313b;font-weight:500")}>{t}</a>
              ))}
            </nav>
          )}
          <span style={css("margin-left:auto;display:flex;align-items:center;gap:8px")}>
            <a href="#" onClick={goLogin} className="lpb lpb-light" style={css("height:40px;padding:0 16px;border:1px solid #d9dee5;border-radius:999px;font-size:14px;font-weight:500;display:flex;align-items:center;white-space:nowrap")}>Log in</a>
            <a href="#" onClick={(e) => goSignup(e)} className="lpb lpb-dark" style={css("height:40px;padding:0 16px 0 18px;border-radius:999px;font-weight:500;font-size:14px;display:flex;align-items:center;gap:6px;white-space:nowrap")}>Get started<i className="icon-arrow-right" style={{ fontSize: 15 }} /></a>
          </span>
        </div>
      </header>

      <Hero isM={isM} tilt={tilt} onSignup={(email) => goSignup(undefined, email)} />
      <Team />
      <Band />
      <HowItWorks />
      <Inbox />
      <Rules />
      <Band />
      <Trust />
      <Band />
      <Plans onSignup={() => goSignup()} />
      <Band />
      <FinalCta onSignup={() => goSignup()} />
      <Band />
      <Footer onLogin={() => goLogin()} scrollTo={scrollTo} />
    </div>
  );
}

/* ---------- loading screen ---------- */
function Loader({ out }: { out: boolean }) {
  return (
    <div role="status" aria-label="Loading Agentic Salesforce" style={{ ...css("position:fixed;inset:0;z-index:100;overflow:hidden;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;text-align:center;color:#ffffff;background:linear-gradient(180deg,#0047b3 0%,#0058e6 55%,#006aff 100%);transition:transform .85s cubic-bezier(.76,0,.24,1),visibility 0s linear " + (out ? ".85s" : "0s")), transform: out ? "translateY(-100%)" : "none", visibility: out ? "hidden" : "visible" }}>
      <span aria-hidden="true" style={css("position:absolute;inset:0;pointer-events:none;background-image:radial-gradient(rgba(255,255,255,.24) 1px,transparent 1.4px);background-size:22px 22px;animation:ldDrift 8s linear infinite;-webkit-mask-image:radial-gradient(ellipse 65% 60% at 50% 48%,#000,transparent 80%);mask-image:radial-gradient(ellipse 65% 60% at 50% 48%,#000,transparent 80%)")} />
      <span aria-hidden="true" style={css("position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse 50% 45% at 50% 46%,rgba(0,82,204,.9),rgba(0,82,204,0) 100%)")} />
      <div style={{ ...css("position:relative;display:flex;flex-direction:column;align-items:center;transition:transform .7s cubic-bezier(.6,0,.2,1),opacity .5s ease"), transform: out ? "translateY(-40px) scale(.96)" : "none", opacity: out ? 0 : 1 }}>
        <div aria-hidden="true" style={css("position:relative;width:76px;height:68px")}>
          <span style={css("position:absolute;left:50%;top:55%;width:96px;height:96px;margin:-48px 0 0 -48px;border-radius:50%;border:1.5px solid rgba(255,255,255,.5);animation:ldRing 1.8s ease-out infinite")} />
          <span style={css("position:absolute;inset:0;background:url('/logo-a.png') center/contain no-repeat;opacity:.18")} />
          <span style={css("position:absolute;inset:0;background:url('/logo-a.png') center/contain no-repeat;animation:ldFill 1.2s cubic-bezier(.65,0,.35,1) forwards,ldGlow 2s 1.2s ease-in-out infinite")} />
        </div>
        <h1 style={css("margin:28px 0 0;font-size:clamp(38px,7vw,76px);line-height:1;font-weight:600;letter-spacing:-.045em;white-space:nowrap")}>
          {NAME.split("").map((c, i) => (
            <span key={i} style={{ display: "inline-block", minWidth: c === " " ? ".28em" : 0, animation: "ldLetter .7s cubic-bezier(.2,.8,.2,1) backwards", animationDelay: (0.75 + i * 0.045).toFixed(3) + "s" }}>{c === " " ? " " : c}</span>
          ))}
        </h1>
        <div aria-hidden="true" style={css("margin-top:30px;display:flex;align-items:center;gap:12px")}>
          <span style={css("position:relative;width:min(260px,60vw);height:2px;background:rgba(255,255,255,.22);overflow:hidden")}>
            <span style={css("position:absolute;inset:0;background:#ffffff;transform-origin:0 50%;animation:ldBar 2.8s cubic-bezier(.65,0,.35,1) forwards")} />
          </span>
        </div>
      </div>
    </div>
  );
}

/* ---------- hero ---------- */
function Hero({ isM, tilt, onSignup }: { isM: boolean; tilt: string; onSignup: (email: string) => void }) {
  const [email, setEmail] = useState("");
  const [sub, setSub] = useState<null | "bad" | "busy">(null);
  const [hw, setHw] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => { const v = Math.round(e.contentRect.width); if (v) setHw(v); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const iw = isM ? 420 : 1440, ih = isM ? 760 : 860;
  const avail = hw || Math.min(1200, Math.max(280, (typeof document !== "undefined" ? document.documentElement.clientWidth : 1200) - 74));
  const sc = Math.min(1, avail / iw);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!/\S+@\S+\.\S+/.test(email.trim())) { setSub("bad"); return; }
    setSub("busy");
    window.setTimeout(() => { setSub(null); onSignup(email.trim()); }, 500);
  };

  return (
    <section data-screen-label="Hero" style={css("position:relative;overflow:hidden;padding:136px 24px 120px;background:linear-gradient(180deg,#0047b3 0%,#006aff 40%,#5c9dff 66%,#bcd8ff 84%,#ffffff 100%);color:#ffffff")}>
      <DotField style={css("-webkit-mask-image:linear-gradient(180deg,#000 55%,transparent 88%);mask-image:linear-gradient(180deg,#000 55%,transparent 88%)")} />
      <div aria-hidden="true" style={css("position:absolute;inset:0;z-index:0;pointer-events:none;background:radial-gradient(ellipse 60% 42% at 50% 20%,rgba(0,82,204,.92) 0%,rgba(0,82,204,.55) 55%,rgba(0,82,204,0) 100%)")} />
      <div style={css("position:relative;z-index:1;max-width:1200px;margin:0 auto;display:flex;flex-direction:column;align-items:center;text-align:center")}>
        <div data-gs-hero="1" style={css("height:42px;padding:0 16px 0 5px;border:1px solid rgba(255,255,255,.35);background:rgba(255,255,255,.14);font-size:13px;font-weight:500;color:#ffffff;display:flex;align-items:center;gap:10px;animation:lUp .5s ease-out backwards")}>
          <span aria-hidden="true" style={css("display:flex;padding-left:8px")}>
            {[1, 2, 3, 4].map((n) => <span key={n} style={css("width:32px;height:32px;margin-left:-8px;border-radius:50%;border:2px solid #ffffff;background:url('/landing/face" + n + ".jpg') center/cover no-repeat #ffffff")} />)}
          </span>
          Trusted by 1,200+ sales teams
        </div>
        <h1 data-gs-hero="1" style={css("margin:20px 0 0;max-width:1040px;font-size:clamp(42px,6.6vw,84px);line-height:1;font-weight:600;letter-spacing:-.04em;animation:lUp .6s .05s ease-out backwards")}>
          An <span style={{ whiteSpace: "nowrap" }}><span aria-hidden="true" style={css("display:inline-block;width:.83em;height:.73em;margin:0 .01em 0 -.02em;vertical-align:0;background:url('/logo-a.png') center bottom/contain no-repeat")} /><span style={css("position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap")}>A</span>I</span> sales team that works for you in chat
        </h1>
        <p data-gs-hero="1" style={css("margin:14px 0 0;max-width:680px;font-size:16.5px;line-height:1.5;color:rgba(255,255,255,.88);text-wrap:balance;animation:lUp .6s .12s ease-out backwards")}>
          Your agents research leads, write first emails, and handle replies. <br />Every action shows up as a chat, and nothing goes out until you approve it.
        </p>
        <form data-gs-hero="1" onSubmit={submit} className="lp-email" style={css("margin-top:22px;width:100%;max-width:440px;display:flex;align-items:center;gap:6px;padding:6px 6px 6px 8px;border:1px solid " + (sub === "bad" ? "#b42318" : "#e3e7ed") + ";border-radius:999px;background:#ffffff;box-shadow:0 6px 24px -12px rgba(16,20,24,.14),0 12px 30px -16px rgba(0,30,90,.35);transition:border-color .15s,box-shadow .15s;animation:lUp .6s .18s ease-out backwards")}>
          <input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setSub(null); }} placeholder="Work email" aria-label="Work email" aria-invalid={sub === "bad"} style={css("flex:1;min-width:0;height:40px;border:0;outline:0;background:transparent;font-size:15px;color:#101418;padding:0 12px")} />
          <button type="submit" className="lpb lpb-dark" style={css("height:40px;flex:none;padding:0 18px;border-radius:999px;border:0;font-weight:500;font-size:14px;display:flex;align-items:center;justify-content:center;gap:8px;white-space:nowrap")}>{sub === "busy" ? "One moment…" : "Get started"}</button>
        </form>
        {sub === "bad" && <div role="alert" style={css("margin-top:10px;font-size:13.5px;color:#ffd4cf;animation:lFade .2s backwards")}>Enter a work email, like you@company.com.</div>}

        <div style={{ ...css("position:relative;margin-top:32px;width:100%;max-width:1226px;padding:12px;border:1px solid rgba(255,255,255,.4);background:linear-gradient(180deg,rgba(255,255,255,.18),rgba(0,106,255,.06));box-shadow:0 0 0 1px rgba(0,71,179,.10),0 30px 60px -30px rgba(0,30,90,.55);transform-origin:50% 0;will-change:transform;animation:lFade .8s .25s ease-out backwards"), transform: tilt }}>
          <Corners size={18} off={11} top="rgba(255,255,255,.85)" bottom="rgba(0,106,255,.45)" />
          <div ref={boxRef} style={css("position:relative;width:100%;height:" + Math.round(ih * sc) + "px;overflow:hidden;box-shadow:0 0 0 1px #e3e7ed,0 24px 60px -36px rgba(16,20,24,.4);background:#ffffff;isolation:isolate")}>
            <div style={{ position: "relative", width: iw, height: ih, transform: "scale(" + sc.toFixed(4) + ")", transformOrigin: "0 0", background: "#ffffff", overflow: "hidden", textAlign: "left", color: "#101418", fontSize: 16 }}>
              <HeroDemo width={iw} height={ih} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- meet the team (3D cubes) ---------- */
function Team() {
  const move = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = e.currentTarget, r = el.getBoundingClientRect();
    el.style.setProperty("--mx", ((e.clientX - r.left) / r.width) * 100 + "%");
    el.style.setProperty("--my", ((e.clientY - r.top) / r.height) * 100 + "%");
    el.style.setProperty("--so", "1");
  };
  const leave = (e: React.MouseEvent<HTMLDivElement>) => e.currentTarget.style.setProperty("--so", "0");
  return (
    <section id="agents" data-screen-label="Agents" style={css("padding:64px 24px 120px")}>
      <div style={css("max-width:1200px;margin:0 auto")}>
        <div data-rv="1" style={css("max-width:760px;margin:0 auto;text-align:center")}>
          <h2 style={css("margin:0;font-size:clamp(34px,5vw,56px);line-height:1.08;font-weight:600;letter-spacing:-.03em")}>Meet the team you just hired</h2>
          <p style={css("margin:16px 0 0;font-size:18px;line-height:1.55;color:#4a5565")}>Each agent has one job, its own permissions, and a name you’ll see in every chat.</p>
        </div>
        <div style={css("margin:56px auto 0;max-width:1120px;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,460px),1fr));gap:24px")}>
          {TEAM.map((t) => {
            const a = AG[t.id];
            const side = (tr: string) => <span className="i3d-face i3d-side" style={{ background: a.fg, transform: tr }}><i className={t.icon} /></span>;
            return (
              <div key={t.id} data-rv="1" style={css("perspective:1000px;display:flex;height:100%")}>
                <div onMouseMove={move} onMouseLeave={leave} className="i3d-card" style={css("position:relative;flex:1;width:100%;min-height:560px;padding:32px;border:1px solid #e3e7ed;background:#ffffff;display:flex;flex-direction:column;gap:14px;transform-style:preserve-3d;transition:transform .5s cubic-bezier(.2,.8,.2,1)")}>
                  <span aria-hidden="true" style={css("position:absolute;inset:-1px;border-radius:inherit;pointer-events:none;opacity:var(--so,0);transition:opacity .3s;padding:1px;background:radial-gradient(260px circle at var(--mx,50%) var(--my,50%),rgba(0,106,255,.55),transparent 70%);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude")} />
                  <div style={css("position:relative;flex:none;margin:-14px -14px 6px;height:260px;background:transparent;display:flex;align-items:flex-end;justify-content:center;overflow:visible;transform-style:preserve-3d")}>
                    <span aria-hidden="true" style={css("position:absolute;left:50%;bottom:14px;width:150px;height:16px;margin-left:-75px;border-radius:50%;background:rgba(16,20,24,.16);filter:blur(7px);animation:i3dShadow 5s ease-in-out infinite")} />
                    <span role="img" aria-label={a.name + ", the " + a.role + " agent"} style={css("position:relative;flex:none;width:176px;height:176px;margin-bottom:48px;perspective:900px;transform:translateZ(24px);animation:i3dFloat 5s ease-in-out infinite")}>
                      <span className="i3d-cube" style={css("position:absolute;inset:0;transform-style:preserve-3d")}>
                        <span className="i3d-face" style={{ transform: "translateZ(88px)", background: avBg(t.id), backgroundSize: "cover", backgroundPosition: "center" }} />
                        {side("rotateY(90deg) translateZ(88px)")}{side("rotateY(180deg) translateZ(88px)")}{side("rotateY(-90deg) translateZ(88px)")}
                        <span className="i3d-face" style={{ background: "linear-gradient(rgba(255,255,255,.28),rgba(255,255,255,.28))," + a.fg, transform: "rotateX(90deg) translateZ(88px)" }} />
                        <span className="i3d-face" style={{ background: "linear-gradient(rgba(0,0,0,.25),rgba(0,0,0,.25))," + a.fg, transform: "rotateX(-90deg) translateZ(88px)" }} />
                      </span>
                    </span>
                  </div>
                  <div style={css("flex:none;min-height:60px")}>
                    <span style={css("position:relative;display:inline-block;font-size:30px;font-weight:600;letter-spacing:-.01em;line-height:1.2;color:#7a8494")}>
                      {a.name}<span className="i3d-fill" aria-hidden="true" style={{ position: "absolute", inset: 0, whiteSpace: "nowrap", color: a.fg }}>{a.name}</span>
                    </span>
                    <span style={css("display:block;margin-top:2px;font-size:15px;color:#6b7686")}>{a.role}</span>
                  </div>
                  <p style={css("margin:0;min-height:84px;font-size:17px;line-height:1.6;color:#101418")}>{t.does}</p>
                  <div style={css("margin-top:auto;padding-top:14px;border-top:1px solid #f1f3f6;font-size:13px;color:#6b7686;display:flex;align-items:center;gap:8px")}><i className={t.icon} style={{ fontSize: 15 }} />{t.chat}</div>
                </div>
              </div>
            );
          })}
        </div>
        <p data-rv="1" style={css("margin:28px 0 0;text-align:center;font-size:15px;color:#6b7686")}>Or build your own: create agents of any type and give them any name.</p>
      </div>
    </section>
  );
}

/* ---------- how it works ---------- */
function HowItWorks() {
  const [step, setStep] = useState(0);
  const [key, setKey] = useState(0);
  const iv = useRef<number>();
  const start = useCallback(() => { window.clearInterval(iv.current); iv.current = window.setInterval(() => { setStep((s) => (s + 1) % STEPS.length); setKey((k) => k + 1); }, 5000); }, []);
  useEffect(() => { start(); return () => window.clearInterval(iv.current); }, [start]);
  const cur = STEPS[step], a = AG[cur.id];
  return (
    <section id="how" data-screen-label="How it works" style={css("padding:96px 24px;background:#f6f7f9")}>
      <div style={css("max-width:1200px;margin:0 auto")}>
        <div data-rv="1" style={css("max-width:960px;margin:0 auto;text-align:center")}>
          <h2 style={css("margin:0;font-size:clamp(26px,3.6vw,44px);line-height:1.08;font-weight:600;letter-spacing:-.03em")}>Go from a list of names to booked calls</h2>
          <p style={css("margin:14px 0 0;font-size:16px;line-height:1.55;color:#4a5565")}>Work moves between agents on its own. You step in only when they ask.</p>
        </div>
        <div data-rv="1" style={css("margin-top:48px;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,380px),1fr));gap:20px;align-items:stretch")}>
          <div role="tablist" aria-label="Steps" style={css("position:relative;display:flex;flex-direction:column;gap:4px")}>
            <span aria-hidden="true" data-gs="spine" style={css("position:absolute;left:36px;top:34px;bottom:34px;width:1.5px;margin-left:-.75px;background:linear-gradient(180deg,rgba(0,106,255,.35) 50%,transparent 50%) 0 0/1.5px 12px;animation:hwDash .8s linear infinite")}>
              <span style={css("position:absolute;left:-2.75px;width:7px;height:7px;border-radius:50%;background:#006aff;box-shadow:0 0 0 4px rgba(0,106,255,.15);animation:hwDrop 5s ease-in-out infinite")} />
            </span>
            {STEPS.map((st, i) => {
              const on = i === step;
              return (
                <button key={st.title} role="tab" data-gs="step" aria-selected={on} className="lp-step" onClick={() => { setStep(i); setKey((k) => k + 1); start(); }} style={css("position:relative;text-align:left;padding:20px 22px;border:1px solid " + (on ? "#e3e7ed" : "transparent") + ";background:" + (on ? "#ffffff" : "transparent") + ";cursor:pointer;transition:background .2s,border-color .2s")}>
                  <span style={css("display:flex;align-items:center;gap:12px")}>
                    <span style={css("position:relative;width:28px;height:28px;flex:none;box-shadow:0 0 0 4px " + (on ? "#ffffff" : "#f6f7f9") + ";background:" + (on ? "#006aff" : "#e9eef6") + ";color:" + (on ? "#ffffff" : "#4a5565") + ";font-size:12.5px;font-weight:600;display:flex;align-items:center;justify-content:center;transition:background .2s,color .2s")}>{i + 1}</span>
                    <span style={css("font-size:16px;font-weight:500;color:" + (on ? "#101418" : "#4a5565") + ";transition:color .2s")}>{st.title}</span>
                    <span style={{ flex: 1 }} />
                    <span style={css("font-size:13px;color:#6b7686")}>{AG[st.id].name}</span>
                  </span>
                  {on && <span style={css("display:block;margin:10px 0 0 40px;font-size:15px;line-height:1.55;color:#4a5565;animation:lFade .25s backwards")}>{st.body}</span>}
                  {on && <span key={key} style={css("position:absolute;left:16px;right:16px;bottom:-1px;height:2px;background:#006aff;transform-origin:0 50%;animation:" + (key % 2 ? "lBar" : "lBar2") + " 5s linear forwards")} />}
                  {on && (
                    <span aria-hidden="true" className="hw-link" style={css("position:absolute;left:100%;top:50%;width:21px;height:1.5px;margin-top:-.75px;background:#006aff")}>
                      <span style={css("position:absolute;left:-4px;top:-3.25px;width:8px;height:8px;border-radius:50%;background:#ffffff;border:1.5px solid #006aff")} />
                      <span style={css("position:absolute;right:-4px;top:-3.25px;width:8px;height:8px;border-radius:50%;background:#006aff")} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div style={css("min-height:380px;border:1px solid #cfe0ff;background:#ffffff;box-shadow:0 24px 50px -36px rgba(0,106,255,.45);padding:28px;display:flex;flex-direction:column;justify-content:center")}>
            <div key={key} style={css("animation:" + (key % 2 ? "lUp" : "lFade") + " .35s ease-out backwards")}>
              <div style={css("display:flex;align-items:center;gap:10px")}>
                <span style={{ ...css("width:30px;height:30px;border-radius:50%"), background: avBg(cur.id) }} />
                <span style={css("font-size:14px;font-weight:500")}>{a.name}</span>
                <span style={css("font-size:13px;color:#8a94a3")}>· just now</span>
              </div>
              <div style={css("margin-top:12px;font-size:15px;line-height:1.6")}>{cur.msg}</div>
              <div style={css("margin-top:16px;border:1px solid #e3e7ed;overflow:hidden")}>
                {cur.rows.map(([ra, rb, rc, fg], j) => (
                  <div key={ra} style={{ ...css("display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid #f1f3f6;font-size:14px;animation:lUp .3s ease-out backwards"), animationDelay: 0.08 + j * 0.08 + "s" }}>
                    <span style={css("flex:1;min-width:0")}><span style={css("display:block;font-weight:500")}>{ra}</span><span style={css("display:block;font-size:13px;color:#6b7686")}>{rb}</span></span>
                    <span style={css("display:flex;align-items:center;gap:6px;font-size:13px;font-weight:500;color:" + fg)}><span style={css("width:7px;height:7px;border-radius:50%;background:" + fg)} />{rc}</span>
                  </div>
                ))}
              </div>
              {cur.btn && (
                <div style={css("margin-top:14px;display:flex;gap:8px")}>
                  <span style={css("height:34px;padding:0 16px;background:#101418;color:#ffffff;font-size:14px;font-weight:500;display:flex;align-items:center")}>{cur.btn}</span>
                  <span style={css("height:34px;padding:0 14px;border:1px solid #d0d6de;font-size:14px;font-weight:500;display:flex;align-items:center")}>Edit</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- agents message you ---------- */
function Inbox() {
  const [kind, setKind] = useState(0);
  const [key, setKey] = useState(0);
  const [kres, setKres] = useState<Record<number, "a" | "b">>({});
  const [auto, setAuto] = useState(true);
  const [pause, setPause] = useState(false);
  const t = useRef<number>(), at = useRef(0), left = useRef(6000);
  const sched = useCallback((ms: number) => {
    window.clearTimeout(t.current);
    if (reduced()) return;
    at.current = Date.now(); left.current = ms;
    t.current = window.setTimeout(() => { setKind((k) => (k + 1) % KINDS.length); setKey((k) => k + 1); sched(6000); }, ms);
  }, []);
  useEffect(() => { sched(6000); return () => window.clearTimeout(t.current); }, [sched]);
  const hold = (on: boolean) => {
    if (!auto || reduced()) return;
    if (on && !pause) { window.clearTimeout(t.current); left.current = Math.max(0, left.current - (Date.now() - at.current)); setPause(true); }
    if (!on && pause) { setPause(false); sched(left.current || 6000); }
  };
  const pick = (i: number) => { window.clearTimeout(t.current); setKind(i); setKey((k) => k + 1); setAuto(false); setPause(false); };
  const answer = (v: "a" | "b" | null) => { window.clearTimeout(t.current); setKres((r) => { const n = { ...r }; if (v) n[kind] = v; else delete n[kind]; return n; }); setAuto(false); setPause(false); };
  const open = KINDS.filter((_, i) => !kres[i]).length;
  const k = KINDS[kind], ka = AG[k.id], r = kres[kind], R = KREPLY[kind];

  return (
    <section data-screen-label="Every action is a chat" style={css("padding:24px 24px 104px;background:#ffffff")}>
      <div style={css("position:relative;max-width:1200px;margin:0 auto")}>
        <Corners size={18} off={11} top="rgba(0,106,255,.45)" />
        <div data-rv="1" style={css("padding:10px;border:1px solid #cfe0ff;background:linear-gradient(180deg,#f2f7ff,#ffffff);box-shadow:0 30px 70px -48px rgba(0,106,255,.55)")}>
          <div onMouseEnter={() => hold(true)} onMouseLeave={() => hold(false)} style={css("position:relative;overflow:hidden;border:1px solid rgba(0,71,179,.3);background:linear-gradient(180deg,#0047b3 0%,#006aff 55%,#5c9dff 100%);color:#ffffff;padding:clamp(28px,5vw,64px)")}>
            <div aria-hidden="true" style={css("position:absolute;inset:0;pointer-events:none;background-image:radial-gradient(rgba(255,255,255,.28) 1px,transparent 1.4px);background-size:20px 20px;-webkit-mask-image:radial-gradient(ellipse 80% 70% at 50% 40%,#000 0%,transparent 80%);mask-image:radial-gradient(ellipse 80% 70% at 50% 40%,#000 0%,transparent 80%)")} />
            <div aria-hidden="true" style={css("position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse 55% 60% at 25% 45%,rgba(0,82,204,.85) 0%,rgba(0,82,204,.45) 55%,rgba(0,82,204,0) 100%)")} />
            <div style={css("position:relative;z-index:1;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));gap:clamp(32px,5vw,64px);align-items:stretch")}>
              <div>
                <div style={css("display:inline-flex;align-items:center;gap:8px;height:34px;padding:0 14px 0 12px;border:1px solid rgba(255,255,255,.35);background:rgba(255,255,255,.14);font-size:13px;font-weight:500")}>
                  <span aria-hidden="true" style={css("position:relative;width:8px;height:8px;border-radius:50%;background:#7cf0b0")}><span style={css("position:absolute;inset:0;border-radius:50%;background:#7cf0b0;animation:ldRing 1.6s ease-out infinite")} /></span>
                  {open ? open + (open === 1 ? " thing needs" : " things need") + " you right now" : "All caught up"}
                </div>
                <h2 style={css("margin:18px 0 0;font-size:clamp(30px,4vw,48px);line-height:1.06;font-weight:600;letter-spacing:-.035em")}>Your agents message you when they need you</h2>
                <p style={css("margin:16px 0 0;max-width:470px;font-size:16.5px;line-height:1.6;color:rgba(255,255,255,.86)")}>No dashboards to check. When an agent needs your approval, gets a reply, or hits a problem, it tells you in chat, and you act on it right there. Try it.</p>
                <div role="tablist" aria-label="Message types" style={css("margin-top:28px;display:flex;flex-direction:column;gap:6px;max-width:470px")}>
                  {KINDS.map((x, i) => {
                    const sel = i === kind, done = !!kres[i];
                    return (
                      <button key={x.label} role="tab" aria-selected={sel} className="lp-kind" onClick={() => pick(i)} style={css("position:relative;overflow:hidden;display:flex;align-items:center;gap:14px;min-height:56px;padding:0 16px;border:1px solid " + (sel ? "rgba(255,255,255,.45)" : "rgba(255,255,255,.14)") + ";background:" + (sel ? "rgba(255,255,255,.18)" : "rgba(255,255,255,.04)") + ";color:#ffffff;text-align:left;cursor:pointer;transition:background .2s,border-color .2s")}>
                        <span style={css("width:34px;height:34px;flex:none;background:" + (sel ? "#ffffff" : "rgba(255,255,255,.14)") + ";display:flex;align-items:center;justify-content:center;transition:background .2s")}><i className={x.icon} style={{ fontSize: 17, color: sel ? "#006aff" : "#ffffff" }} /></span>
                        <span style={css("flex:1;min-width:0")}><span style={css("display:block;font-size:15px;font-weight:500;color:#ffffff")}>{x.label}</span><span style={css("display:block;font-size:12.5px;color:rgba(255,255,255,.68)")}>{AG[x.id].name} · {x.title}</span></span>
                        {done ? <span style={css("display:flex;align-items:center;gap:5px;font-size:12.5px;font-weight:500;color:#bff5d6")}><i className="icon-check" style={{ fontSize: 14 }} />Handled</span>
                          : <span style={css("min-width:22px;height:22px;padding:0 7px;background:#ffffff;color:#0047b3;font-size:12px;font-weight:600;display:flex;align-items:center;justify-content:center")}>1</span>}
                        {sel && auto && !reduced() && (
                          <span aria-hidden="true" style={css("position:absolute;left:0;right:0;bottom:0;height:2px;background:rgba(255,255,255,.18)")}>
                            <span key={key} style={{ ...css("position:absolute;inset:0;background:#ffffff;transform-origin:0 50%"), animation: (key % 2 ? "kBar" : "kBar2") + " 6s linear forwards", animationPlayState: pause ? "paused" : "running" }} />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div style={css("display:flex;flex-direction:column;padding:10px;border:1px solid rgba(255,255,255,.4);background:rgba(255,255,255,.14);box-shadow:0 30px 60px -30px rgba(0,30,90,.55)")}>
                <div style={css("flex:1;display:flex;flex-direction:column;border:1px solid #e3e7ed;background:#ffffff;color:#101418;overflow:hidden")}>
                  <div style={css("display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid #eceef1")}>
                    <span aria-hidden="true" style={css("width:26px;height:26px;background:url('/logo-mark.png') center/cover no-repeat")} />
                    <span style={css("font-size:14px;font-weight:600")}>Agentic Salesforce</span>
                    <span style={css("font-size:13px;color:#8a94a3")}>· Chat</span>
                    <span style={{ flex: 1 }} />
                    <span style={css("height:26px;padding:0 10px;background:" + (open ? "#e6f0ff" : "#e7f5ec") + ";color:" + (open ? "#0b57d0" : "#0f7b3f") + ";font-size:12.5px;font-weight:500;display:flex;align-items:center;gap:6px;transition:background .2s")}><i className={open ? "icon-bell" : "icon-check"} style={{ fontSize: 13 }} />{open ? open + " need you" : "All caught up"}</span>
                  </div>
                  <div aria-live="polite" style={css("flex:1;position:relative;min-height:340px;padding:22px 20px 20px;background:linear-gradient(180deg,#ffffff,#f8fafc)")}>
                    <div key={key} style={css("animation:" + (key % 2 ? "lUp" : "lFade") + " .3s ease-out backwards")}>
                      <div aria-hidden="true" style={css("position:absolute;left:20px;top:22px;display:flex;align-items:center;gap:10px;animation:kGone .75s ease-out forwards")}>
                        <span style={{ ...css("width:36px;height:36px;border-radius:50%"), background: avBg(k.id) }} />
                        <span style={css("display:flex;gap:4px;padding:12px 14px;background:#eef2f7")}>
                          {[0, 0.15, 0.3].map((d) => <span key={d} style={{ ...css("width:6px;height:6px;border-radius:50%;background:#8a94a3"), animation: "kDot 1s " + d + "s ease-in-out infinite" }} />)}
                        </span>
                      </div>
                      <div style={css("display:flex;gap:12px;animation:lUp .4s .65s ease-out backwards")}>
                        <span aria-hidden="true" style={{ ...css("width:36px;height:36px;flex:none;border-radius:50%;box-shadow:0 0 0 1px #e3e7ed"), background: avBg(k.id) }} />
                        <div style={css("flex:1;min-width:0")}>
                          <div style={css("display:flex;align-items:baseline;gap:6px;flex-wrap:wrap")}><span style={css("font-size:14px;font-weight:600")}>{ka.name}</span><span style={css("font-size:12.5px;color:#8a94a3")}>{ka.role} · just now</span></div>
                          <div style={css("margin-top:6px;font-size:16px;font-weight:600;letter-spacing:-.01em")}>{k.title}</div>
                          <div style={css("margin-top:4px;font-size:15px;line-height:1.6;color:#2b3440")}>{k.msg}</div>
                          <div style={css("margin-top:12px;padding:12px 14px;border:1px solid #e3e7ed;background:#ffffff;font-size:14px;line-height:1.55;color:#101418;display:flex;gap:10px;align-items:flex-start")}><i className={k.icon} style={{ fontSize: 16, color: ka.fg, marginTop: 2 }} /><span>{k.card}</span></div>
                          {!r && (
                            <div style={css("margin-top:14px;display:flex;gap:8px;flex-wrap:wrap")}>
                              <button onClick={() => answer("a")} className="lpb lpb-dark" style={css("height:36px;padding:0 16px;border-radius:999px;border:0;font-weight:500;font-size:14px;display:flex;align-items:center;justify-content:center;gap:8px")}>{k.a}</button>
                              <button onClick={() => answer("b")} className="lpb lpb-light" style={css("height:36px;padding:0 14px;border:1px solid #d9dee5;border-radius:999px;font-size:14px;font-weight:500")}>{k.b}</button>
                            </div>
                          )}
                        </div>
                      </div>
                      {r && (<>
                        <div style={css("margin-top:16px;display:flex;justify-content:flex-end;animation:lUp .3s ease-out backwards")}><span style={css("max-width:80%;padding:10px 14px;background:#006aff;color:#ffffff;font-size:14px;font-weight:500")}>{r === "b" ? R[2] : R[0]}</span></div>
                        <div style={css("margin-top:12px;display:flex;gap:12px;animation:lUp .35s .45s ease-out backwards")}>
                          <span aria-hidden="true" style={{ ...css("width:28px;height:28px;flex:none;border-radius:50%;box-shadow:0 0 0 1px #e3e7ed"), background: avBg(k.id) }} />
                          <div style={css("flex:1;min-width:0")}>
                            <div style={css("padding:10px 14px;background:#eef2f7;font-size:14px;line-height:1.55;color:#101418")}>{r === "b" ? R[3] : R[1]}</div>
                            <button onClick={() => answer(null)} className="lp-undo" style={css("margin-top:6px;padding:4px 2px;border:0;background:transparent;color:#4a5565;font-size:12.5px;font-weight:500;cursor:pointer;display:inline-flex;align-items:center;gap:5px")}>
                              <svg aria-hidden="true" viewBox="0 0 24 24" style={{ width: 13, height: 13 }} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>Undo
                            </button>
                          </div>
                        </div>
                      </>)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- rules ---------- */
const initRules = () => Object.fromEntries(AGENT_IDS.map((id) => [id, Object.fromEntries(RULES[id].map((x) => [x[0], true]))])) as Record<AgentId, Record<string, boolean>>;
function Rules() {
  const [rules, setRules] = useState(initRules);
  const [cur, setCur] = useState<AgentId>("maya");
  const [rKey, setRKey] = useState(0);
  const [mKey, setMKey] = useState(0);
  const word = (id: AgentId) => RULES[id].every((x) => rules[id][x[0]]) ? "Supervised" : RULES[id].every((x) => x[4] === "s" || !rules[id][x[0]]) ? "Independent" : "Balanced";
  const setFor = (id: AgentId, fn: (o: Record<string, boolean>) => Record<string, boolean>) => { setRules((r) => ({ ...r, [id]: fn(r[id]) })); setMKey((k) => k + 1); };
  const w = word(cur), R = rules[cur], a = AG[cur];
  const ns = RULES[cur].filter((x) => x[4] !== "s"), meter = Math.round(8 + 92 * (ns.length ? ns.filter((x) => !R[x[0]]).length / ns.length : 0)) + "%";
  const preview = RPREV[cur][R[RULES[cur][0][0]] ? 0 : 1];

  return (
    <section id="control" data-screen-label="Control" style={css("padding:96px 24px 104px;background:#ffffff")}>
      <div style={css("max-width:1200px;margin:0 auto")}>
        <div data-rv="1" style={css("max-width:760px;margin:0 auto;text-align:center")}>
          <h2 style={css("margin:0;font-size:clamp(32px,4.6vw,52px);line-height:1.06;font-weight:600;letter-spacing:-.035em")}>You set the rules. Your agents follow them.</h2>
          <p style={css("margin:14px auto 0;max-width:580px;font-size:17px;line-height:1.55;color:#4a5565")}>Decide how independent each agent is. Start with approval on everything and loosen it as you build trust. Pick an agent and try it.</p>
        </div>
        <div data-rv="1" style={css("margin:48px auto 0;max-width:1100px;padding:10px;border:1px solid #cfe0ff;background:linear-gradient(180deg,#f2f7ff,#ffffff);box-shadow:0 30px 70px -48px rgba(0,106,255,.55)")}>
          <div style={css("display:flex;flex-wrap:wrap;border:1px solid #e3e7ed;background:#ffffff;overflow:hidden")}>
            <div role="tablist" aria-label="Agents" style={css("flex:1 1 240px;padding:14px;background:#f8fafc;border-right:1px solid #eceef1;display:flex;flex-direction:column;gap:4px")}>
              <div style={css("padding:6px 10px 10px;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#6b7686")}>Your team</div>
              {AGENT_IDS.map((id) => {
                const sel = id === cur, ww = word(id);
                return (
                  <button key={id} role="tab" aria-selected={sel} className="lp-ragent" onClick={() => { setCur(id); setRKey((k) => k + 1); setMKey((k) => k + 1); }} style={css("display:flex;align-items:center;gap:12px;min-height:60px;padding:8px 12px;border:1px solid " + (sel ? "#cfe0ff" : "transparent") + ";background:" + (sel ? "#ffffff" : "transparent") + ";text-align:left;cursor:pointer;box-shadow:" + (sel ? "0 10px 24px -16px rgba(0,106,255,.5)" : "none") + ";transition:background .2s,border-color .2s,box-shadow .2s")}>
                    <span aria-hidden="true" style={{ ...css("width:40px;height:40px;flex:none;border-radius:50%;transition:box-shadow .2s;box-shadow:0 0 0 2px " + (sel ? "#006aff" : "#ffffff")), background: avBg(id) }} />
                    <span style={css("flex:1;min-width:0")}><span style={css("display:block;font-size:15px;font-weight:600;color:#101418")}>{AG[id].name}</span><span style={css("display:block;font-size:12.5px;color:#6b7686")}>{AG[id].role}</span></span>
                    <span style={css("font-size:12px;font-weight:500;white-space:nowrap;color:" + (ww === "Supervised" ? "#0b57d0" : ww === "Balanced" ? "#9a5800" : "#0f7b3f"))}>{ww}</span>
                  </button>
                );
              })}
            </div>
            <div style={css("flex:999 1 440px;padding:clamp(18px,3vw,28px);min-width:0")}>
              <div style={css("display:flex;align-items:center;gap:14px;flex-wrap:wrap")}>
                <span style={css("flex:1;min-width:200px")}><span style={css("display:block;font-size:20px;font-weight:600;letter-spacing:-.01em")}>{a.name}’s rules</span></span>
                <div role="radiogroup" aria-label="Independence" style={css("display:flex;gap:2px;padding:3px;border:1px solid #e3e7ed;border-radius:999px;background:#f6f7f9")}>
                  {(["Supervised", "Balanced", "Independent"] as const).map((label) => {
                    const sel = label === w;
                    return (
                      <button key={label} role="radio" aria-checked={sel} onClick={() => setFor(cur, () => Object.fromEntries(RULES[cur].map((x) => [x[0], label === "Supervised" ? true : label === "Balanced" ? x[4] !== "a" : x[4] === "s"])))} style={css("height:32px;padding:0 14px;border:0;border-radius:999px;background:" + (sel ? "#ffffff" : "transparent") + ";color:" + (sel ? "#101418" : "#4a5565") + ";font-size:13.5px;font-weight:500;cursor:pointer;box-shadow:" + (sel ? "0 1px 3px rgba(16,20,24,.12),0 0 0 1px #e3e7ed" : "none") + ";transition:background .2s,color .2s")}>{label}</button>
                    );
                  })}
                </div>
              </div>
              <div aria-hidden="true" style={css("margin-top:18px;display:flex;align-items:center;gap:12px")}>
                <span style={css("font-size:12px;font-weight:500;color:#6b7686;white-space:nowrap")}>Asks first</span>
                <span style={css("position:relative;flex:1;height:6px;background:#e9eef6;overflow:hidden")}><span style={{ ...css("position:absolute;left:0;top:0;bottom:0;background:linear-gradient(90deg,#5c9dff,#006aff);transition:width .45s cubic-bezier(.2,.8,.2,1)"), width: meter }} /></span>
                <span style={css("font-size:12px;font-weight:500;color:#6b7686;white-space:nowrap")}>On its own</span>
              </div>
              <div key={rKey} style={css("margin-top:14px;animation:" + (rKey % 2 ? "lUp" : "lFade") + " .3s ease-out backwards")}>
                {RULES[cur].map(([key, icon, label, sub]) => {
                  const v = !!R[key];
                  return (
                    <button key={key} role="switch" aria-checked={v} onClick={() => setFor(cur, (o) => ({ ...o, [key]: !v }))} style={css("width:100%;display:flex;align-items:center;gap:14px;padding:14px 4px;border:0;border-top:1px solid #f1f3f6;background:transparent;text-align:left;cursor:pointer")}>
                      <span style={css("width:34px;height:34px;flex:none;background:" + (v ? "#e6f0ff" : "#f1f3f6") + ";color:" + (v ? "#006aff" : "#8a94a3") + ";display:flex;align-items:center;justify-content:center;transition:background .2s,color .2s")}><i className={icon} style={{ fontSize: 16 }} /></span>
                      <span style={css("flex:1;min-width:0")}><span style={css("display:block;font-size:15px;font-weight:500;color:#101418")}>{label}</span><span style={css("display:block;margin-top:2px;font-size:13px;color:#6b7686")}>{sub}</span></span>
                      <span style={css("width:44px;height:26px;flex:none;background:" + (v ? "#006aff" : "#d0d6de") + ";padding:3px;transition:background .2s")}><span style={{ ...css("display:block;width:20px;height:20px;background:#ffffff;box-shadow:0 1px 3px rgba(16,20,24,.25);transition:transform .18s cubic-bezier(.3,1.3,.5,1)"), transform: "translateX(" + (v ? 18 : 0) + "px)" }} /></span>
                    </button>
                  );
                })}
              </div>
              <div style={css("margin-top:6px;padding:16px;background:#f6f7f9")}>
                <div style={css("font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#6b7686")}>What {a.name} will say in chat</div>
                <div key={mKey} style={css("margin-top:10px;display:flex;gap:10px;align-items:flex-start;animation:" + (mKey % 2 ? "lUp" : "lFade") + " .35s ease-out backwards")}>
                  <span aria-hidden="true" style={{ ...css("width:30px;height:30px;flex:none;border-radius:50%;box-shadow:0 0 0 1px #e3e7ed"), background: avBg(cur) }} />
                  <span style={css("padding:10px 14px;background:#ffffff;border:1px solid #e3e7ed;font-size:14.5px;line-height:1.55;color:#101418")}>{preview}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div style={css("margin:40px auto 0;max-width:1100px;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:16px")}>
          {PROMISES.map(([icon, t, d]) => (
            <div key={t} data-rv="1" style={css("display:flex;gap:14px;padding:20px;border:1px solid #e3e7ed;background:#ffffff")}>
              <span style={css("width:40px;height:40px;flex:none;background:#e6f0ff;color:#006aff;display:flex;align-items:center;justify-content:center")}><i className={icon} style={{ fontSize: 19 }} /></span>
              <span><span style={css("display:block;font-size:15.5px;font-weight:600")}>{t}</span><span style={css("display:block;margin-top:4px;font-size:14px;line-height:1.55;color:#4a5565")}>{d}</span></span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- trust ---------- */
function Trust() {
  return (
    <section data-screen-label="Trust" style={css("padding:88px 24px 104px;background:#f6f7f9")}>
      <div style={css("max-width:1200px;margin:0 auto")}>
        <div data-rv="1" style={css("max-width:640px;margin:0 auto;text-align:center")}>
          <h2 style={css("margin:0;font-size:clamp(30px,4vw,44px);line-height:1.08;font-weight:600;letter-spacing:-.03em")}>Your data stays yours</h2>
          <p style={css("margin:14px 0 0;font-size:16px;line-height:1.55;color:#4a5565")}>Agents only touch the leads and sources you give them.</p>
        </div>
        <div data-rv="1" style={css("position:relative;max-width:1040px;margin:48px auto 0")}>
          {[["left", "top"], ["right", "top"], ["left", "bottom"], ["right", "bottom"]].map(([x, y]) => (
            <span key={x + y} aria-hidden="true" style={{ position: "absolute", [x]: -8, [y]: -8, width: 16, height: 16, color: "#006aff", opacity: 0.6 }}><Spark /></span>
          ))}
          <div style={css("position:relative;z-index:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));gap:1px;border:1px solid #e3e7ed;overflow:hidden;background:#e3e7ed;box-shadow:0 30px 60px -44px rgba(16,20,24,.35)")}>
            {TRUST.map((x) => (
              <div key={x.t} data-gs="cell" style={css("display:flex;flex-direction:column;align-items:center;text-align:center;padding:36px 32px 38px;background:#ffffff")}>
                <div aria-hidden="true" style={css("position:relative;width:100%;max-width:360px;height:200px")}>
                  <span style={css("position:absolute;inset:0;background:radial-gradient(circle,#c9d1db 1px,transparent 1.3px) 0 0/14px 14px;-webkit-mask-image:radial-gradient(ellipse at center,#000 35%,transparent 75%);mask-image:radial-gradient(ellipse at center,#000 35%,transparent 75%)")} />
                  {x.kind === "lock" ? (
                    <div style={css("position:absolute;inset:0;display:flex;align-items:center;justify-content:center")}>
                      <span style={css("position:absolute;width:156px;height:156px;border-radius:50%;border:1.5px dashed #c9d1db;animation:tSpin 20s linear infinite")}>
                        <span style={css("position:absolute;left:50%;top:-5px;width:10px;height:10px;margin-left:-5px;border-radius:50%;background:#006aff")} />
                        <span style={css("position:absolute;left:-4px;top:50%;width:8px;height:8px;margin-top:-4px;border-radius:50%;background:#9cc2ff")} />
                        <span style={css("position:absolute;right:16px;bottom:12px;width:8px;height:8px;border-radius:50%;background:#c9d1db")} />
                      </span>
                      <span style={css("position:absolute;width:66px;height:66px;border:1.5px solid rgba(0,106,255,.55);animation:tPing 2.6s ease-out infinite")} />
                      <span style={css("position:absolute;width:66px;height:66px;border:1.5px solid rgba(0,106,255,.55);animation:tPing 2.6s 1.3s ease-out infinite")} />
                      <span style={css("position:relative;width:66px;height:66px;background:linear-gradient(180deg,#2f86ff,#006aff);color:#ffffff;display:flex;align-items:center;justify-content:center;box-shadow:0 14px 30px -12px rgba(0,106,255,.7)")}><i className="icon-lock" style={{ fontSize: 28 }} /></span>
                    </div>
                  ) : (
                    <div style={css("position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;gap:10px;padding:0 44px")}>
                      {(["maya", "priya", "theo"] as AgentId[]).map((id, i) => (
                        <div key={id} style={css("display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid #e6e9ee;background:#ffffff;box-shadow:0 4px 14px -10px rgba(16,20,24,.3)")}>
                          <span style={{ ...css("width:26px;height:26px;flex:none;border-radius:50%"), background: avBg(id) }} />
                          <span style={css("flex:1;display:flex;flex-direction:column;gap:5px")}><span style={css("width:78%;height:6px;background:#e3e7ed")} /><span style={css("width:48%;height:6px;background:#eef1f5")} /></span>
                          <span style={{ ...css("position:relative;width:34px;height:20px;flex:none;background:#d5dbe3"), animation: "tTrack 4.5s " + i * 1.5 + "s ease-in-out infinite" }}>
                            <span style={{ ...css("position:absolute;left:3px;top:3px;width:14px;height:14px;border-radius:50%;background:#ffffff;box-shadow:0 1px 3px rgba(16,20,24,.3)"), animation: "tKnob 4.5s " + i * 1.5 + "s ease-in-out infinite" }} />
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div style={css("margin-top:22px;font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:#006aff")}>{x.t}</div>
                <div style={css("margin-top:10px;max-width:360px;font-size:15.5px;line-height:1.6;color:#2a313b")}>{x.d}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- plans ---------- */
function Plans({ onSignup }: { onSignup: () => void }) {
  const move = (e: React.MouseEvent<HTMLDivElement>) => { const el = e.currentTarget, r = el.getBoundingClientRect(); el.style.setProperty("--mx", e.clientX - r.left + "px"); el.style.setProperty("--my", e.clientY - r.top + "px"); el.style.setProperty("--so", "1"); };
  const leave = (e: React.MouseEvent<HTMLDivElement>) => e.currentTarget.style.setProperty("--so", "0");
  const third = "calc((100% - 32px) / 6)";
  return (
    <section id="plans" data-screen-label="Plans" style={css("padding:104px 24px")}>
      <div style={css("max-width:1200px;margin:0 auto")}>
        <div data-rv="1" style={css("max-width:640px;margin:0 auto;text-align:center")}>
          <h2 style={css("margin:0;font-size:clamp(30px,4vw,44px);line-height:1.08;font-weight:600;letter-spacing:-.03em")}>Start where you are</h2>
          <p style={css("margin:14px 0 0;font-size:16px;line-height:1.55;color:#4a5565")}>Begin with one agent and add more as your pipeline grows.</p>
        </div>
        <div aria-hidden="true" data-gs="plan-link" className="pl-link" style={css("position:relative;height:56px;margin-top:20px")}>
          <span style={css("position:absolute;left:50%;top:0;height:24px;border-left:1.5px dashed rgba(0,106,255,.4)")}><span style={css("position:absolute;left:-4.25px;width:7px;height:7px;border-radius:50%;background:#006aff;animation:plStub 2.6s ease-in infinite")} /></span>
          <span style={{ ...css("position:absolute;top:24px;bottom:0;border:1.5px dashed rgba(0,106,255,.4);border-bottom:0"), left: third, right: third }}><span style={css("position:absolute;top:-4.25px;width:7px;height:7px;border-radius:50%;background:#006aff;box-shadow:0 0 0 4px rgba(0,106,255,.15);animation:plRun 4.2s ease-in-out infinite")} /></span>
          <span style={css("position:absolute;left:50%;top:24px;bottom:0;border-left:1.5px dashed rgba(0,106,255,.4)")} />
          {[{ left: "calc(" + third + " - 4.5px)" }, { left: "calc(50% - 4.5px)" }, { right: "calc(" + third + " - 4.5px)" }].map((pos, i) => <span key={i} style={{ ...css("position:absolute;bottom:-5px;width:9px;height:9px;border-radius:50%;background:#ffffff;border:1.5px solid #006aff"), ...pos }} />)}
        </div>
        <div style={css("margin-top:28px;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:16px")}>
          {PLANS.map((p) => (
            <div key={p.name} data-gs="plan" style={css("position:relative;padding:1px;overflow:hidden;display:flex")}>
              {p.hi && <span aria-hidden="true" style={css("position:absolute;left:50%;top:50%;width:200%;aspect-ratio:1;margin:-100% 0 0 -100%;background:conic-gradient(from 0deg,transparent 0deg,transparent 280deg,#5aa2ff 320deg,#ffffff 340deg,#5aa2ff 355deg,transparent 360deg);animation:lBeam 4.5s linear infinite")} />}
              <div onMouseMove={move} onMouseLeave={leave} style={css("position:relative;flex:1;padding:28px;border:1px solid " + (p.hi ? "#006aff" : "#e3e7ed") + ";background:" + (p.hi ? "linear-gradient(180deg,#0047b3 0%,#006aff 100%)" : "#ffffff") + ";color:" + (p.hi ? "#ffffff" : "#101418") + ";display:flex;flex-direction:column;overflow:hidden")}>
                <span aria-hidden="true" style={css("position:absolute;inset:0;pointer-events:none;opacity:var(--so,0);transition:opacity .3s;background:radial-gradient(420px circle at var(--mx,50%) var(--my,50%)," + (p.hi ? "rgba(255,255,255,.2)" : "rgba(0,106,255,.07)") + ",transparent 62%)")} />
                <div style={css("font-size:18px;font-weight:600")}>{p.name}</div>
                <div style={css("margin-top:6px;font-size:15px;line-height:1.5;color:" + (p.hi ? "rgba(255,255,255,.85)" : "#4a5565"))}>{p.for}</div>
                <ul style={css("list-style:none;margin:22px 0 0;padding:0;display:flex;flex-direction:column;gap:10px")}>
                  {p.items.map((it) => <li key={it} style={css("display:flex;gap:10px;font-size:14px;line-height:1.45")}><i className="icon-check" style={{ fontSize: 15, marginTop: 2 }} />{it}</li>)}
                </ul>
                <div style={css("flex:1;min-height:24px")} />
                <a href="#" onClick={(e) => { e.preventDefault(); onSignup(); }} className={"lpb " + (p.hi ? "lpb-light" : "lpb-dark")} style={css("position:relative;height:40px;border-radius:999px;border:1px solid " + (p.hi ? "#ffffff" : "#101418") + ";font-size:14px;font-weight:500;display:flex;align-items:center;justify-content:center;gap:6px")}>{p.cta}</a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- final CTA + footer ---------- */
function FinalCta({ onSignup }: { onSignup: () => void }) {
  return (
    <section data-screen-label="Final CTA" style={css("padding:40px 24px 104px")}>
      <div data-gs="cta" style={css("max-width:1200px;margin:0 auto;position:relative;overflow:hidden;background:linear-gradient(180deg,#0047b3 0%,#006aff 55%,#5c9dff 100%);color:#ffffff;padding:72px 24px;display:flex;flex-direction:column;align-items:center;text-align:center")}>
        <DotField strength={0.48} />
        <div aria-hidden="true" style={css("position:absolute;inset:0;z-index:0;pointer-events:none;background:radial-gradient(ellipse 46% 52% at 50% 50%,rgba(0,82,204,.7) 0%,rgba(0,82,204,.3) 55%,rgba(0,82,204,0) 100%)")} />
        <div style={css("position:relative;z-index:1;display:flex;flex-direction:column;align-items:center")}>
          <div style={css("display:flex;padding-left:8px")}>{AGENT_IDS.map((id) => <span key={id} style={{ ...css("width:44px;height:44px;margin-left:-8px;border-radius:50%;border:3px solid #ffffff"), background: avBg(id) }} />)}</div>
          <h2 style={css("margin:22px 0 0;max-width:640px;font-size:clamp(32px,4.5vw,52px);line-height:1.05;font-weight:600;letter-spacing:-.035em")}>Grow your pipeline without growing headcount</h2>
          <p style={css("margin:16px 0 0;max-width:480px;font-size:16px;line-height:1.55;color:rgba(255,255,255,.88)")}>Set up your first agent in a few minutes. <br />You approve every email until you decide otherwise.</p>
          <a href="#" onClick={(e) => { e.preventDefault(); onSignup(); }} className="lpb lpb-light" style={css("margin-top:28px;height:40px;padding:0 16px 0 20px;border:0;border-radius:999px;font-size:14px;font-weight:500;display:flex;align-items:center;gap:8px")}>Get started<i className="icon-arrow-right" style={{ fontSize: 16 }} /></a>
        </div>
      </div>
    </section>
  );
}

function Footer({ onLogin, scrollTo }: { onLogin: () => void; scrollTo: (id: string) => void }) {
  const go = (t: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    if (t === "Log in") onLogin();
    else if (t === "Agents") scrollTo("agents");
    else if (t === "How it works") scrollTo("how");
    else if (t === "Plans") scrollTo("plans");
  };
  return (
    <footer className="lp-foot" style={css("padding:56px 24px 36px")}>
      <div style={css("max-width:1200px;margin:0 auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:32px")}>
        <div>
          <div style={css("display:flex;align-items:center;gap:10px")}><span style={css("width:28px;height:28px;background:url('/logo-mark.png') center/cover no-repeat")} /><span style={css("font-size:15px;font-weight:500")}>{NAME}</span></div>
          <p style={css("margin:12px 0 0;font-size:14px;line-height:1.55;color:#6b7686;max-width:220px")}>An AI sales team that works for you in chat.</p>
        </div>
        {FOOT.map((c) => (
          <div key={c.h}>
            <div style={css("font-size:13px;font-weight:500")}>{c.h}</div>
            <div style={css("margin-top:12px;display:flex;flex-direction:column;gap:9px")}>
              {c.links.map((t) => <a key={t} href="#" onClick={go(t)} style={css("font-size:14px;color:#4a5565")}>{t}</a>)}
            </div>
          </div>
        ))}
      </div>
      <div style={css("max-width:1200px;margin:40px auto 0;padding-top:20px;border-top:1px solid #f1f3f6;font-size:13px;color:#8a94a3")}>© 2026 {NAME}</div>
    </footer>
  );
}
