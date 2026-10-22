"use client";
// Question card under a scrape agent's "Before I start…" message: one row per
// missing detail, with quick picks and a "Type something" box. Send posts the
// answers as one chat reply (readable text + a hidden ⟦answer:…⟧ marker).
import { useState } from "react";
import { css, Box, Btn } from "@/components/primitives";
import { BRIEF_LABEL, BRIEF_OPTIONS, scrapeAnswerText, type BriefField } from "@/lib/chat/clarify";

const PLACEHOLDER: Record<BriefField, string> = {
  what: "For example: HR managers at hospitals",
  where: "Type something… (a city, country or region)",
  count: "Type a number… (up to 25)",
};

export default function ScrapeQuestions({ fields, options = BRIEF_OPTIONS, onSend }: { fields: BriefField[]; options?: Record<BriefField, string[]>; onSend: (text: string) => void }) {
  // Per field: the picked option, or the typed text (typing clears the pick).
  const [picked, setPicked] = useState<Partial<Record<BriefField, string>>>({});
  const [typed, setTyped] = useState<Partial<Record<BriefField, string>>>({});
  const value = (f: BriefField) => (typed[f]?.trim() || picked[f] || "").trim();
  const countOk = (v: string) => /^\d{1,3}$/.test(v) && Number(v) > 0;
  const ready = fields.every((f) => (f === "count" ? countOk(value(f)) : !!value(f)));
  const send = () => {
    if (!ready) return;
    onSend(scrapeAnswerText(Object.fromEntries(fields.map((f) => [f, value(f)]))));
  };

  return (
    <div style={css("align-self:flex-start;width:100%;max-width:520px;background:#fff;border:1px solid #e3e7ed;border-radius:16px;padding:14px 16px;display:flex;flex-direction:column;gap:14px;box-shadow:0 6px 24px -14px rgba(16,20,24,.18);animation:cUp .25s ease-out backwards")}>
      {fields.map((f) => (
        <div key={f} style={css("display:flex;flex-direction:column;gap:8px")}>
          <div style={css("font-size:13.5px;font-weight:600;color:#101418")}>{BRIEF_LABEL[f]}</div>
          {options[f].length > 0 && (
            <div role="radiogroup" aria-label={BRIEF_LABEL[f]} style={css("display:flex;flex-wrap:wrap;gap:6px")}>
              {options[f].map((o) => {
                const on = !typed[f]?.trim() && picked[f] === o;
                return (
                  <Box
                    key={o}
                    role="radio"
                    aria-checked={on}
                    onClick={() => { setPicked((p) => ({ ...p, [f]: o })); setTyped((t) => ({ ...t, [f]: "" })); }}
                    title={o}
                    style={"max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:6px 13px;border-radius:999px;font-size:13px;cursor:pointer;transition:background .12s,border-color .12s;border:1px solid " + (on ? "#006aff;background:#eaf2ff;color:#006aff;font-weight:500" : "#e3e7ed;background:#fff;color:#3f3f46")}
                    styleHover={on ? undefined : "background:#f6f7f9"}
                  >
                    {f === "count" ? `${o} leads` : o}
                  </Box>
                );
              })}
            </div>
          )}
          <input
            aria-label={`${BRIEF_LABEL[f]} Type an answer`}
            value={typed[f] ?? ""}
            inputMode={f === "count" ? "numeric" : undefined}
            onChange={(e) => setTyped((t) => ({ ...t, [f]: e.target.value }))}
            onKeyDown={(e) => { if (e.key === "Enter") send(); }}
            placeholder={PLACEHOLDER[f]}
            style={css("width:100%;border:1px solid " + (typed[f]?.trim() ? "#006aff" : "#e3e7ed") + ";border-radius:10px;padding:8px 12px;font-size:13.5px;color:#101418;outline:none;background:#fff")}
          />
        </div>
      ))}
      <div style={css("display:flex;justify-content:flex-end")}>
        <Btn
          onClick={send}
          disabled={!ready}
          style={"height:34px;padding:0 16px;border:0;border-radius:999px;font-size:14px;font-weight:500;display:flex;align-items:center;gap:6px;cursor:" + (ready ? "pointer;background:#101418;color:#fff" : "default;background:#e3e7ed;color:#8a94a3")}
          styleHover={ready ? "background:#2a313b" : undefined}
        >
          Send<i className="icon-arrow-up" style={{ fontSize: 15 }} />
        </Btn>
      </div>
    </div>
  );
}
