"use client";
// The "constellation": illustrated agents orbiting a goal ring that counts
// leads. Shared by the marketing Landing hero and the auth screen so signing in
// continues the landing rather than jumping to a different look.
//
// anime.js (v4) drives an orchestrated entrance on mount — the ring pops, the
// connection lines and agents stagger in, and the number counts up. It is gated
// behind prefers-reduced-motion (instant, static final state). The entrance
// animates INNER wrappers (.lp-node-inner / .lp-goal-inner) so their scale never
// competes with the translate(-50%,-50%) centering on the positioned parents.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { animate, stagger, utils } from "animejs";
import { css } from "./primitives";
import { av } from "@/lib/visuals";

// Illustrated demo agents (char index into AGENT_CHARS), shown on the auth
// screen: the same four teammates as the landing page.
export const DEMO = [
  { id: "d-theo", name: "Theo", role: "Research", color: "#F59E0B", char: 0 },
  { id: "d-pat", name: "Pat", role: "Qualify", color: "#2FA45C", char: 1 },
  { id: "d-maya", name: "Maya", role: "First emails", color: "#006AFF", char: 2 },
  { id: "d-sam", name: "Sam", role: "Follow-ups", color: "#8B5CF6", char: 3 },
];

const CAPTIONS = [
  "Theo researched 25 finance leads in Texas",
  "Pat scored the list: 9 ready, 5 borderline",
  "Maya drafted 5 first emails for your approval",
  "Sam queued 3 follow-ups for you to check",
];

export default function Constellation() {
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [count, setCount] = useState(0);
  const [cap, setCap] = useState(0);

  // Fit the stage to its container width.
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setScale(Math.min(1.05, Math.max(0.52, el.clientWidth / 520)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Cycle the live caption.
  useEffect(() => {
    const id = setInterval(() => setCap((c) => (c + 1) % CAPTIONS.length), 2600);
    return () => clearInterval(id);
  }, []);

  // anime.js entrance on mount.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const inners = root.querySelectorAll(".lp-node-inner");
    const goal = root.querySelectorAll(".lp-goal");
    const goalInner = root.querySelectorAll(".lp-goal-inner");
    const dashes = root.querySelectorAll(".lp-dash");
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      utils.set([...inners, ...goalInner], { opacity: 1, scale: 1, translateY: 0 });
      utils.set([...goal, ...dashes], { opacity: 1 });
      setCount(1240);
      return;
    }
    animate(goal, { opacity: [0, 1], duration: 600, ease: "outQuad" });
    animate(goalInner, { opacity: [0, 1], scale: [0.4, 1], duration: 900, ease: "outBack(1.6)" });
    animate(dashes, { opacity: [0, 1], delay: stagger(70, { start: 250 }), duration: 500, ease: "outQuad" });
    animate(inners, {
      opacity: [0, 1], scale: [0.55, 1], translateY: [14, 0],
      delay: stagger(95, { start: 320 }), duration: 800, ease: "outElastic(1, .75)",
    });
    const counter = { v: 0 };
    animate(counter, { v: 1240, duration: 1500, ease: "outExpo", onUpdate: () => setCount(Math.round(counter.v)) });
  }, []);

  // Nodes sit on an ellipse; each avatar CIRCLE rides LABEL_OFF px above its
  // (x,y) anchor (labels hang below), so the hub is placed at cy - LABEL_OFF for
  // the ring to read centred among the avatars.
  const cx = 260, cy = 260, rx = 202, ry = 162;
  const LABEL_OFF = 31;
  const hubY = cy - LABEL_OFF;
  const nodes = DEMO.map((a, i) => {
    const ang = ((-90 + (i * 360) / DEMO.length) * Math.PI) / 180;
    return { ...a, i, x: Math.round(cx + Math.cos(ang) * rx), y: Math.round(cy + Math.sin(ang) * ry) };
  });

  return (
    <div className="lp-const" ref={rootRef}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="lp-stage-wrap">
        <div className="lp-stage" ref={stageRef} style={{ height: 520 * scale }} role="img" aria-label="AI agents orbiting a shared goal that counts leads worked">
          <div className="lp-stage-in" style={{ transform: `scale(${scale})` }}>
            <div className="lp-orbit lp-orbit-1" />
            <div className="lp-orbit lp-orbit-2" />
            <svg width="520" height="520" viewBox="0 0 520 520" aria-hidden="true" style={{ position: "absolute", inset: 0 }}>
              {nodes.map((n) => (
                <line key={"l" + n.i} x1={cx} y1={hubY} x2={n.x} y2={n.y - LABEL_OFF} stroke="#2B57B5" strokeWidth="1.5" strokeDasharray="3 7" className="lp-dash" />
              ))}
              {nodes.map((n) => (
                <circle key={"p" + n.i} r="2.6" fill="#93C5FD" opacity="0.9">
                  <animateMotion dur={2.4 + (n.i % 4) * 0.6 + "s"} begin={n.i * 0.4 + "s"} repeatCount="indefinite" path={`M${n.x} ${n.y - LABEL_OFF} L${cx} ${hubY}`} />
                </circle>
              ))}
            </svg>

            <div className="lp-goal">
              <span className="lp-ring-pulse" />
              <span className="lp-ring-pulse lp-ring-pulse-2" />
              <div className="lp-goal-inner">
                <div className="lp-ring">
                  <div className="lp-ring-in">
                    <div className="lp-ring-num">{count.toLocaleString()}</div>
                    <div className="lp-ring-lbl lp-mono">LEADS<br />WORKED</div>
                  </div>
                </div>
              </div>
            </div>

            {nodes.map((n) => (
              <div key={n.id} className="lp-node" style={{ left: n.x, top: n.y, animationDelay: (n.i * 0.45).toFixed(2) + "s" }}>
                <div className="lp-node-inner">
                  <div className="lp-node-av">
                    <span style={{ ...css(av(n, 58)), backgroundColor: "#E5EBF6", border: "2px solid #0A1E4D", boxShadow: "0 0 20px rgba(96,165,250,.42)" }} aria-hidden="true" />
                  </div>
                  <div className="lp-node-name"><span className="lp-node-dot" style={{ background: "#2FA45C" }} />{n.name}</div>
                  <div className="lp-node-role">{n.role}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="lp-live" key={cap} aria-live="polite"><span className="lp-live-mark">✦</span>{CAPTIONS[cap]}</div>
      </div>
    </div>
  );
}

const CSS = `
.lp-const{width:100%;}
.lp-const .lp-mono{font-family:'JetBrains Mono',ui-monospace,monospace;}
.lp-stage-wrap{display:flex;flex-direction:column;align-items:center;}
.lp-stage{position:relative;width:100%;max-width:520px;}
.lp-stage-in{position:absolute;top:0;left:0;width:520px;height:520px;transform-origin:top left;}
.lp-orbit{position:absolute;left:260px;top:229px;transform:translate(-50%,-50%);border:1px solid rgba(255,255,255,.06);border-radius:50%;}
.lp-orbit-1{width:568px;height:456px;}
.lp-orbit-2{width:410px;height:334px;}
.lp-dash{opacity:0;animation:dashMove 1.8s linear infinite;}
.lp-goal{position:absolute;left:260px;top:229px;transform:translate(-50%,-50%);display:flex;align-items:center;justify-content:center;z-index:2;opacity:0;}
.lp-goal-inner{display:flex;align-items:center;justify-content:center;}
/* Center with inset+margin (NOT transform): the shared ringPulse keyframe sets
   transform:scale(), which would clobber a translate() centering and shove the
   pulse off the orb. margin:auto centering leaves transform free for the scale. */
.lp-ring-pulse{position:absolute;inset:0;margin:auto;width:124px;height:124px;border-radius:50%;border:2px solid rgba(96,165,250,.5);animation:ringPulse 3s ease-out infinite;}
.lp-ring-pulse-2{animation-delay:1.5s;}
.lp-ring{width:132px;height:132px;border-radius:50%;background:conic-gradient(#60A5FA 0 100%);display:flex;align-items:center;justify-content:center;box-shadow:0 0 46px rgba(59,130,246,.45);}
.lp-ring-in{width:112px;height:112px;border-radius:50%;background:#0A1E4D;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding-top:12px;}
.lp-ring-num{font-family:'General Sans',Inter,sans-serif;font-size:30px;color:#fff;line-height:1;font-variant-numeric:tabular-nums;}
.lp-ring-lbl{font-size:9px;font-weight:700;letter-spacing:.12em;color:#9DB5E6;text-align:center;line-height:1.35;}
.lp-node{position:absolute;transform:translate(-50%,-50%);z-index:2;width:150px;animation:lpFloat 6s ease-in-out infinite;}
@keyframes lpFloat{0%,100%{transform:translate(-50%,-50%);}50%{transform:translate(-50%,calc(-50% - 7px));}}
.lp-node-inner{opacity:0;display:flex;flex-direction:column;align-items:center;gap:5px;}
.lp-node-av{padding:3px;border-radius:50%;background:#fff;}
.lp-node-name{display:flex;align-items:center;gap:5px;font-size:13px;font-weight:700;color:#F1F6FF;}
.lp-node-dot{width:7px;height:7px;border-radius:50%;animation:pulse 2s infinite;}
.lp-node-role{font-size:10.5px;font-weight:600;color:#AFC4EC;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.13);border-radius:99px;padding:2px 10px;}
.lp-live{margin-top:8px;display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;color:#DCE7FF;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16);border-radius:99px;padding:7px 16px;backdrop-filter:blur(8px);white-space:nowrap;animation:fadeUp .4s ease;max-width:100%;overflow:hidden;text-overflow:ellipsis;}
.lp-live-mark{color:#60A5FA;}
@media (max-width:960px){ .lp-stage-wrap{margin-top:20px;} }
@media (prefers-reduced-motion:reduce){ .lp-const *{animation:none !important;} .lp-const .lp-node-inner,.lp-const .lp-goal,.lp-const .lp-dash{opacity:1;} }
`;
