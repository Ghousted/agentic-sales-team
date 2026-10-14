// Landing-only keyframes and hover classes, verbatim from the design file.
// Shared motion (lUp, lFade, cDot, …) and the icon font live in app/globals.css.
export const LANDING_CSS = `
.lp{position:relative;min-height:100vh;background:#ffffff;overflow-x:clip;color:#101418;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro Display","Helvetica Neue",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.lp *{box-sizing:border-box}
.lp button,.lp input{font:inherit;color:inherit}
.lp a{color:#006aff;text-decoration:none}
.lp h1,.lp h2,.lp h3{font-family:"General Sans",system-ui,sans-serif;text-wrap:balance}
.lp p{text-wrap:pretty}
.lp input:focus{outline:none}
.lp ::placeholder{color:#8a94a3}
.lp button:focus-visible,.lp a:focus-visible{outline:2px solid #006aff;outline-offset:2px}
@keyframes tPing{0%{transform:scale(1);opacity:.85}100%{transform:scale(2.2);opacity:0}}
@keyframes tSpin{to{transform:rotate(360deg)}}
@keyframes tKnob{0%,35%{transform:translateX(0)}45%,85%{transform:translateX(14px)}95%,100%{transform:translateX(0)}}
@keyframes tTrack{0%,35%{background:#d5dbe3}45%,85%{background:#006aff}95%,100%{background:#d5dbe3}}
@keyframes hwDrop{0%{top:0;opacity:0}10%{opacity:1}90%{opacity:1}100%{top:calc(100% - 7px);opacity:0}}
@keyframes hwDash{to{background-position:0 12px}}
@keyframes plRun{0%{left:0;opacity:0}8%{opacity:1}92%{opacity:1}100%{left:calc(100% - 7px);opacity:0}}
@keyframes plStub{0%{top:0;opacity:0}20%{opacity:1}100%{top:calc(100% - 7px);opacity:0}}
@keyframes ldFill{0%{clip-path:inset(100% 0 0 0)}55%{clip-path:inset(0 0 0 0)}100%{clip-path:inset(0 0 0 0)}}
@keyframes ldGlow{0%,100%{filter:drop-shadow(0 0 0 rgba(255,255,255,0))}50%{filter:drop-shadow(0 0 18px rgba(255,255,255,.55))}}
@keyframes ldBar{0%{transform:scaleX(0)}70%{transform:scaleX(.85)}100%{transform:scaleX(1)}}
@keyframes ldLetter{0%{opacity:0;transform:translateY(.45em) rotate(4deg);filter:blur(8px)}100%{opacity:1;transform:none;filter:blur(0)}}
@keyframes ldDrift{from{background-position:0 0}to{background-position:22px 22px}}
@keyframes ldRing{0%{transform:scale(.6);opacity:.5}100%{transform:scale(1.9);opacity:0}}
@keyframes kBar{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes kBar2{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes kDot{0%,60%,100%{transform:translateY(0);opacity:.5}30%{transform:translateY(-4px);opacity:1}}
@keyframes kGone{0%,80%{opacity:1}100%{opacity:0;visibility:hidden}}
@keyframes lBar2{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes dWord{0%{opacity:0;transform:translateY(.55em);filter:blur(6px)}100%{opacity:1;transform:none;filter:blur(0)}}
@keyframes dMark{from{background-size:0% 100%}to{background-size:100% 100%}}
@keyframes dCardIn{from{opacity:0;transform:translateY(18px) scale(.97)}to{opacity:1;transform:none}}
@keyframes dCardOut{from{opacity:1;transform:none}to{opacity:0;transform:translateY(-12px) scale(.98)}}
@keyframes dScrimIn{from{opacity:0}to{opacity:1}}
@keyframes dScrimOut{from{opacity:1}to{opacity:0}}
@keyframes dChipIn{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:none}}
@keyframes dSegA{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes dSegB{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes dRipA{0%{transform:scale(.2);opacity:.7}100%{transform:scale(1.6);opacity:0}}
@keyframes dRipB{0%{transform:scale(.2);opacity:.7}100%{transform:scale(1.6);opacity:0}}
@keyframes dPop{0%{opacity:0;transform:translateY(24px) scale(.6)}60%{opacity:1;transform:translateY(-6px) scale(1.06)}100%{opacity:1;transform:none}}
@keyframes dRise{from{opacity:0;transform:translateY(22px)}to{opacity:1;transform:none}}
@keyframes dWipeOut{from{clip-path:inset(0 0 0 0)}to{clip-path:inset(0 0 100% 0)}}
@keyframes dLive{0%,100%{opacity:1}50%{opacity:.35}}
@keyframes dDrift{from{background-position:0 0}to{background-position:22px 22px}}
.dm button{font:inherit;color:inherit}
.dm-h:hover{background:#eceef1!important}
.nl{position:relative;display:inline-flex;align-items:center;padding:6px 0;transition:color .2s}
.nl::before{content:"";position:absolute;left:-12px;top:50%;width:6px;height:6px;margin-top:-3px;background:#006aff;transform:scale(0);transition:transform .25s cubic-bezier(.65,0,.35,1)}
.lp .nl:hover{color:#006aff!important;text-decoration:none}
.nl:hover::before{transform:scale(1)}
.i3d-cube{transform:rotateX(-12deg) rotateY(-24deg);transition:transform .9s cubic-bezier(.22,1,.36,1)}
.i3d-card:hover .i3d-cube{transform:rotateX(-12deg) rotateY(-24deg);animation:i3dSpin 1.1s cubic-bezier(.65,0,.35,1) both}
@keyframes i3dSpin{0%{transform:rotateX(-12deg) rotateY(-24deg)}45%{transform:rotateX(18deg) rotateY(160deg)}100%{transform:rotateX(-12deg) rotateY(336deg)}}
.i3d-fill{clip-path:inset(0 100% 0 0);transition:clip-path .7s cubic-bezier(.65,0,.35,1)}
.i3d-card:hover .i3d-fill{clip-path:inset(0 0 0 0)}
@media (hover:none){.i3d-fill{clip-path:inset(0 0 0 0)}}
@keyframes i3dFloat{0%,100%{transform:translateZ(24px) translateY(0)}50%{transform:translateZ(24px) translateY(-4px)}}
@keyframes i3dShadow{0%,100%{transform:scaleX(1);opacity:1}50%{transform:scaleX(.93);opacity:.85}}
@media (prefers-reduced-motion:reduce){.i3d-card:hover .i3d-cube{animation:none}.i3d-fill{transition:none}}
.i3d-face{position:absolute;inset:0;box-sizing:border-box;backface-visibility:hidden;-webkit-backface-visibility:hidden;outline:1px solid transparent}
.i3d-side{display:flex;align-items:center;justify-content:center;color:#ffffff;font-size:64px}
@media (max-width:820px){.hw-link{display:none}}
@media (max-width:960px){.pl-link{display:none}}
.lpb{transition:background .12s,transform .1s;cursor:pointer}
.lpb:active{transform:scale(.97)}
.lp .lpb-dark{background:#101418;color:#ffffff}.lp .lpb-dark:hover{background:#2a313b;color:#ffffff;text-decoration:none}
.lp .lpb-light{background:#ffffff;color:#101418}.lp .lpb-light:hover{background:#f6f7f9;color:#101418;text-decoration:none}
.lp .lpb-white:hover{background:#f6f7f9;color:#101418;text-decoration:none}
.lp .lpb-onblue:hover{background:#f6f7f9!important}
.lp-step:hover{border-color:#d0d6de!important}
.lp-kind:hover{background:rgba(255,255,255,.12)!important}
.lp-ragent:hover{background:#ffffff!important}
.lp-undo:hover{color:#006aff!important}
.lp-foot a:hover{color:#006aff!important;text-decoration:none}
.lp-logo:hover{opacity:.8;text-decoration:none}
.lp-email:focus-within{border-color:#c7ced8!important;box-shadow:0 10px 30px -14px rgba(16,20,24,.22),0 12px 30px -16px rgba(0,30,90,.35)!important}
`;
