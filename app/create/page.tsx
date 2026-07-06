"use client";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/store";
import { css, Box, Btn } from "@/components/primitives";

/* ---------- character sprite (public/agents-sprite.png, 980x980) ----------
   The design crops individual business-character illustrations out of one
   sprite sheet. CHARS are the pixel-exact bounding boxes [x, y, w, h] of all 14
   figures (extracted by alpha-scanning the sheet). Indices are canonical and
   shared with the app's avatar head-crops (lib/visuals.ts), so the character you
   pick here is the one shown as the agent's avatar everywhere. PICKS is the
   subset offered in the wizard. charBox() height-normalizes each character
   (scale = targetH / box.h) with the window sized to the box so nothing clips. */
const SPRITE = "/agents-sprite.png";
const CHARS: [number, number, number, number][] = [
  [118, 104, 106, 239], [273, 101, 126, 242], [427, 112, 105, 231], [568, 121, 124, 222],
  [719, 121, 127, 222], [123, 402, 135, 230], [325, 388, 177, 244], [536, 389, 148, 243],
  [744, 398, 107, 234], [124, 679, 128, 243], [289, 693, 106, 230], [434, 690, 108, 232],
  [582, 685, 106, 237], [724, 695, 139, 227],
];
const PICKS = [0, 1, 2, 3, 4, 5, 7, 13];
function charBox(i: number, targetH: number) {
  const [x, y, w, h] = CHARS[i];
  const scale = targetH / h;
  const size = Math.round(980 * scale);
  return (
    "width:" + Math.round(w * scale) + "px;height:" + Math.round(targetH) +
    "px;background-image:url('" + SPRITE + "');background-repeat:no-repeat;background-size:" +
    size + "px " + size + "px;background-position:-" + Math.round(x * scale) + "px -" + Math.round(y * scale) + "px"
  );
}

/* ---------- static content ---------- */
const STEPS = ["Identity", "Appearance", "Position", "Prospect", "Goal"];
const POSITIONS: [string, string][] = [
  ["SDR", "Prospects, qualifies, and books first meetings"],
  ["BDR", "Outbound-only pipeline generation at volume"],
  ["Account Executive", "Runs deals from demo to close"],
  ["Sales Manager", "Coordinates agents, balances workloads, reports"],
  ["Recruiter", "Sources and screens sales candidates"],
  ["Customer Success", "Onboards, retains, and expands accounts"],
];
const POSITION_SUGGESTIONS = ["Partnerships Manager", "Enterprise AE", "RevOps Analyst", "Lifecycle Marketer"];
const INDUSTRIES = ["Healthcare", "SaaS", "Manufacturing", "Finance", "Retail", "Logistics"];
const SIZES = ["1-50", "51-200", "201-1,000", "1,000-10,000", "20,000-50,000", "100,000+"];

const inputStyle = "width:100%;border:0.5px solid #f2f2f2;background:#f2f2f2;border-radius:12px;padding:16px;font-size:14px;color:#181d27;outline:none";
const titleStyle = "font-family:'Poetsen One',sans-serif;font-size:24px;color:#000;letter-spacing:-.24px;line-height:32px";
const subtitleStyle = "font-size:14px;color:#606b79;letter-spacing:-.14px;line-height:20px";

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: dir === "right" ? "rotate(180deg)" : "none" }}>
      <path d="M15 18 9 12l6-6" />
    </svg>
  );
}

function pill(selected: boolean): string {
  return "font-size:13px;font-weight:600;border-radius:99px;padding:7px 15px;cursor:pointer;transition:all .12s;border:2px solid " +
    (selected ? "#5122c1;background:#F1EDFD;color:#5122c1" : "#ECECF1;background:#fff;color:#3F3F46");
}

/* Horizontal stepper: circle per step + connecting trail. */
function Stepper({ step }: { step: number }) {
  return (
    <div style={css("display:flex;gap:8px;align-items:flex-start")}>
      {STEPS.map((label, i) => {
        const done = i < step;
        const cur = i === step;
        return (
          <div key={label} style={css("display:flex;align-items:flex-start")}>
            <div style={css("display:flex;flex-direction:column;align-items:center;gap:10px;width:32px;flex:none")}>
              <div style={css("width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:500;flex:none;" + (done ? "background:#5122c1;color:#fff" : cur ? "background:#EEE9F8;color:#5122c1" : "background:#F0F1F3;color:#242E39"))}>
                {done ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
                ) : (i + 1)}
              </div>
              <div style={css("font-size:13px;white-space:nowrap;" + (cur || done ? "font-weight:700;color:#5122c1" : "font-weight:500;color:#465668"))}>{label}</div>
            </div>
            {i < STEPS.length - 1 && (
              <div style={css("width:84.75px;height:32px;display:flex;align-items:center")}>
                <div style={css("width:100%;height:2px;background:" + (i <= step ? "#5122c1" : "#a1aebe"))} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function CreatePage() {
  const { s, set, showToast, createAgent } = useApp();
  const router = useRouter();
  const step = s.wStep;
  const character = s.wCharacter;

  const reset = () => set({ wStep: 0, wName: "", wGoals: "", wTitles: "", wGeo: "", wPosInput: "" });
  const back = () => set((p) => ({ wStep: Math.max(0, p.wStep - 1) }));
  const next = () => set((p) => ({ wStep: Math.min(4, p.wStep + 1) }));
  const submitPos = () => {
    const v = s.wPosInput.trim();
    if (!v) return;
    set({ wPosition: v, wPosInput: "" });
    showToast('Generating capabilities for "' + v + '"');
  };

  const name = s.wName.trim() || "New Agent";
  const knownPos = POSITIONS.find((p) => p[0] === s.wPosition);

  /* ---------- success screen (step 5) ---------- */
  if (step === 5) {
    return (
      <div style={css("position:fixed;inset:0;background:#fafafa;z-index:40;display:flex;flex-direction:column;animation:fadeUp .3s ease")}>
        <Header onClose={() => { router.push("/agents"); reset(); }} />
        <div style={css("flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px;text-align:center;padding:40px")}>
          <div style={css("display:flex;flex-direction:column;align-items:center;gap:10px")}>
            <div style={css("width:182px;height:258px;background:#EEE9F8;border-radius:16px;display:flex;align-items:flex-end;justify-content:center;overflow:hidden")}>
              <div style={css(charBox(character, 210))} />
            </div>
            <div>
              <div style={css("font-size:18px;font-weight:700;color:#181d27")}>{name}</div>
              <div style={css("font-size:13px;color:#606b79")}>{s.wPosition}</div>
            </div>
          </div>
          <div>
            <div style={css("font-family:'Poetsen One',sans-serif;font-size:32px;color:#181d27;line-height:1.25")}>Your agent {name} is now live!</div>
            <div style={css("font-size:16px;color:#606b79;margin-top:12px;max-width:520px")}>They&rsquo;re ready to receive conversations and start helping customers.</div>
          </div>
          <div style={css("display:flex;gap:10px;margin-top:8px")}>
            <Btn onClick={() => { router.push("/agents"); reset(); }} style="background:#F4F4F5;color:#3F3F46;border:none;border-radius:100px;height:48px;padding:0 24px;font-size:14px;font-weight:600;cursor:pointer" styleHover="background:#E4E4E7">Back to agents</Btn>
            <Btn onClick={() => { const id = s.wCreatedId; router.push(id ? "/agents/" + id : "/agents"); reset(); }} style="background:#5122c1;color:#fff;border:none;border-radius:100px;height:48px;padding:0 28px;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(81,34,193,.3)" styleHover="background:#42199E">View agent →</Btn>
          </div>
        </div>
      </div>
    );
  }

  /* ---------- footer (Back / Continue) ---------- */
  const footer = (
    <div style={css("display:flex;align-items:center;justify-content:" + (step === 0 ? "flex-end" : "space-between") + ";width:100%")}>
      {step > 0 && (
        <Btn onClick={back} style="background:#EEE9F8;color:#5122c1;border:none;border-radius:100px;padding:12px 24px;font-size:16px;font-weight:600;cursor:pointer;letter-spacing:-.15px;display:flex;align-items:center;gap:8px" styleHover="background:#E3DBF9"><Chevron dir="left" />Back</Btn>
      )}
      <Btn
        onClick={step === 4 ? createAgent : next}
        style="background:#5122c1;color:#fff;border:none;border-radius:100px;padding:12px 24px;font-size:16px;font-weight:600;cursor:pointer;letter-spacing:-.15px;display:flex;align-items:center;gap:8px"
        styleHover="background:#42199E"
      >
        {step === 4 ? "Create agent" : "Continue"}<Chevron dir="right" />
      </Btn>
    </div>
  );

  return (
    <div style={css("position:fixed;inset:0;background:#fafafa;z-index:40;display:flex;flex-direction:column;animation:fadeUp .3s ease")}>
      <Header onClose={() => { router.push("/agents"); reset(); }} />
      <div style={css("flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;gap:32px;padding:32px 120px;overflow-y:auto")}>
        <Stepper step={step} />

        <div style={css("background:#fff;border-radius:20px;box-shadow:0 1px 4px rgba(12,12,13,.05);padding:" + (step === 0 ? "40px" : "32px 40px") + ";display:flex;flex-direction:column;gap:32px;width:" + (step === 1 ? "100%" : step === 2 ? "800px" : step === 3 ? "708px" : "673px") + ";max-width:100%" + (step === 1 ? ";flex:1;min-height:0" : ""))}>

          {/* ===== Step 1 — Identity ===== */}
          {step === 0 && (
            <>
              <div style={css("display:flex;flex-direction:column;gap:8px")}>
                <div style={css(titleStyle)}>Name your agent</div>
                <div style={css(subtitleStyle)}>Give your AI employee a name your team will recognize.</div>
              </div>
              <input aria-label="Agent name" value={s.wName} onChange={(e) => set({ wName: e.target.value })} placeholder="Enter name" style={css(inputStyle)} />
            </>
          )}

          {/* ===== Step 2 — Appearance ===== */}
          {step === 1 && (
            <>
              <div style={css("display:flex;flex-direction:column;gap:8px")}>
                <div style={css(titleStyle)}>How should your agent look?</div>
                <div style={css(subtitleStyle)}>Choose your agent&rsquo;s appearance.</div>
              </div>
              <div style={css("flex:1;min-height:0;display:flex;gap:80px;align-items:center")}>
                <div style={css("flex:none;display:flex;align-items:flex-end;justify-content:center")}>
                  <div style={css(charBox(character, 380))} />
                </div>
                <div style={css("flex:1;min-width:0;display:grid;grid-template-columns:repeat(4,1fr);gap:16px")}>
                  {PICKS.map((idx, i) => {
                    const on = character === idx;
                    return (
                      <Box key={idx} onClick={() => set({ wCharacter: idx })} aria-label={"Character option " + (i + 1)} style={"height:194px;border-radius:12px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .12s;" + (on ? "background:#EEE9F8;border:2px solid #5122c1" : "background:#ECECF1;border:2px solid transparent")} styleHover="border-color:#C9B8F5">
                        <div style={css(charBox(idx, 150))} />
                      </Box>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {/* ===== Step 3 — Position ===== */}
          {step === 2 && (
            <>
              <div style={css("display:flex;flex-direction:column;gap:8px")}>
                <div style={css(titleStyle)}>What will they do?</div>
                <div style={css(subtitleStyle)}>Pick a position — or describe your own and spark will generate its capabilities.</div>
              </div>
              <div style={css("display:grid;grid-template-columns:repeat(3,1fr);gap:12px")}>
                {POSITIONS.map((p) => {
                  const on = s.wPosition === p[0];
                  return (
                    <Box key={p[0]} onClick={() => set({ wPosition: p[0], wPosInput: "" })} style={"border-radius:12px;padding:14px 16px;cursor:pointer;transition:all .12s;border:2px solid " + (on ? "#5122c1;background:#F8F5FE" : "#ECECF1;background:#fff")} styleHover="border-color:#C9B8F5">
                      <div style={css("font-size:14px;font-weight:700;color:#181d27")}>{p[0]}</div>
                      <div style={css("font-size:12px;color:#606b79;margin-top:4px;line-height:1.4")}>{p[1]}</div>
                    </Box>
                  );
                })}
              </div>
              <div style={css("display:flex;flex-direction:column;gap:12px")}>
                <div style={css("display:flex;gap:8px;flex-wrap:wrap")}>
                  {POSITION_SUGGESTIONS.map((q) => (
                    <Box key={q} onClick={() => set({ wPosInput: q })} style="font-size:12px;font-weight:600;color:#465668;background:#F4F4F5;border-radius:99px;padding:6px 14px;cursor:pointer" styleHover="background:#ECECF1">{q}</Box>
                  ))}
                </div>
                <div style={css("display:flex;gap:8px;align-items:center;background:#FAFAFB;border:1px solid #E4E4E7;border-radius:99px;padding:6px 6px 6px 18px")}>
                  <input aria-label="Describe a position" value={s.wPosInput} onChange={(e) => set({ wPosInput: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") submitPos(); }} placeholder="Describe a position — e.g. Partnerships Manager for EU agencies" style={css("flex:1;border:none;outline:none;background:transparent;font-size:13px;color:#181d27;min-width:0")} />
                  <Btn onClick={submitPos} aria-label="Generate role" style="background:#5122c1;color:#fff;border:none;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;flex:none" styleHover="background:#42199E">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
                  </Btn>
                </div>
                <div style={css("display:flex;gap:10px;align-items:center;background:#F6F3FE;border:1px solid #E9E3FA;border-radius:14px;padding:12px 16px")}>
                  <div style={css("width:30px;height:30px;border-radius:10px;background:#5122c1;color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;flex:none")}>✦</div>
                  <div><div style={css("font-size:13px;font-weight:700;color:#181d27")}>{s.wPosition}</div><div style={css("font-size:11.5px;color:#606b79;margin-top:1px")}>{knownPos ? knownPos[1] : "Custom position — spark will generate this role’s capabilities."}</div></div>
                </div>
              </div>
            </>
          )}

          {/* ===== Step 4 — Prospect ===== */}
          {step === 3 && (
            <>
              <div style={css("display:flex;flex-direction:column;gap:8px")}>
                <div style={css(titleStyle)}>Prospect targets</div>
                <div style={css(subtitleStyle)}>Tell your agent who to go after.</div>
              </div>
              <div style={css("display:flex;flex-direction:column;gap:20px")}>
                <div>
                  <div style={css("font-size:14px;font-weight:500;color:#414651;margin-bottom:8px")}>Target industry</div>
                  <div style={css("display:flex;gap:8px;flex-wrap:wrap")}>{INDUSTRIES.map((io) => <Box key={io} onClick={() => set({ wIndustry: io })} style={pill(s.wIndustry === io)} styleHover="border-color:#C9B8F5">{io}</Box>)}</div>
                </div>
                <div>
                  <div style={css("font-size:14px;font-weight:500;color:#414651;margin-bottom:8px")}>Company size</div>
                  <div style={css("display:flex;gap:8px;flex-wrap:wrap")}>{SIZES.map((so) => <Box key={so} onClick={() => set({ wSize: so })} style={pill(s.wSize === so)} styleHover="border-color:#C9B8F5">{so}</Box>)}</div>
                </div>
                <div>
                  <div style={css("font-size:14px;font-weight:500;color:#414651;margin-bottom:8px")}>Job titles</div>
                  <input aria-label="Job titles" value={s.wTitles} onChange={(e) => set({ wTitles: e.target.value })} placeholder="e.g. CEO, CTO, CFO, Sales Manager" style={css("width:100%;border:1px solid #E4E4E7;background:#fff;border-radius:12px;padding:12px 16px;font-size:14px;color:#181d27;outline:none")} />
                </div>
                <div>
                  <div style={css("font-size:14px;font-weight:500;color:#414651;margin-bottom:8px")}>Geography</div>
                  <input aria-label="Geography" value={s.wGeo} onChange={(e) => set({ wGeo: e.target.value })} placeholder="e.g. North America, Philippines" style={css("width:100%;border:1px solid #E4E4E7;background:#fff;border-radius:12px;padding:12px 16px;font-size:14px;color:#181d27;outline:none")} />
                </div>
              </div>
            </>
          )}

          {/* ===== Step 5 — Goal ===== */}
          {step === 4 && (
            <>
              <div style={css("display:flex;flex-direction:column;gap:8px")}>
                <div style={css(titleStyle)}>What does success look like?</div>
                <div style={css(subtitleStyle)}>Describe your agent&rsquo;s goals — plain language works.</div>
              </div>
              <textarea aria-label="Agent goals" value={s.wGoals} onChange={(e) => set({ wGoals: e.target.value })} placeholder="Book 30 meetings every month. Target CTOs. Prioritize companies using AWS. Always personalize outreach. Avoid duplicate contacts." style={css("width:100%;min-height:200px;border:0.5px solid #f2f2f2;background:#f2f2f2;border-radius:12px;padding:24px;font-size:14px;line-height:1.6;color:#181d27;outline:none;resize:vertical")} />
            </>
          )}

          {footer}
        </div>
      </div>
    </div>
  );
}

/* Full-screen wizard header: wordmark, centered title, close button. */
function Header({ onClose }: { onClose: () => void }) {
  return (
    <div style={css("position:relative;display:flex;align-items:center;justify-content:space-between;background:#fff;border-bottom:1px solid #e9eaeb;padding:16px 24px;flex:none")}>
      <div style={css("font-family:'JetBrains Mono',ui-monospace,monospace;font-size:18px;font-weight:700;letter-spacing:-.02em;line-height:1.1;color:#181d27")}>
        <span style={{ color: "#5122C1" }}>agent</span>ic salesforce
      </div>
      <div style={css("position:absolute;left:50%;transform:translateX(-50%);font-size:24px;font-weight:600;color:#000;letter-spacing:-.24px")}>Add new agent</div>
      <Box onClick={onClose} aria-label="Close" style="width:24px;height:24px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#606b79;font-size:20px" styleHover="color:#181d27">✕</Box>
    </div>
  );
}
