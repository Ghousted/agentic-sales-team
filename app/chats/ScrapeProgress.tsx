"use client";
// Live timeline of a scrape under the agent's "I am starting the search" message
// (the ⟦run:…⟧ marker): plan, sources found, seller check, leads picked, saved.
// Polls the job while it runs, then folds into a one-line summary.
import { useEffect, useState } from "react";
import { css, Box } from "@/components/primitives";
import { getScrapeProgress } from "@/lib/jobs/actions";
import { openExternal, safeHttpUrl } from "@/lib/url/safeUrl";
import { stepSummary, type ScrapeStep } from "@/lib/scrape/steps";

const POLL_MS = 1200;
/** Stop polling a job that never finishes (the runner was killed). */
const MAX_POLL_MS = 3 * 60_000;

export default function ScrapeProgress({ jobId }: { jobId: string }) {
  const [steps, setSteps] = useState<ScrapeStep[]>([]);
  const [status, setStatus] = useState<string>("queued");
  const [open, setOpen] = useState<boolean | null>(null); // null: follow the status

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    const tick = async () => {
      const p = await getScrapeProgress(jobId).catch(() => null);
      if (!alive) return;
      if (p) { setSteps(p.steps); setStatus(p.status); }
      const live = !p || p.status === "queued" || p.status === "running";
      if (live && Date.now() - started < MAX_POLL_MS) timer = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [jobId]);

  const running = status === "queued" || status === "running";
  const failed = status === "failed";
  const expanded = open ?? running;
  const current = [...steps].reverse().find((s) => s.status === "active");
  const head = failed ? "The search stopped" : running ? `${current?.label ?? "Starting the search"}…` : stepSummary(steps) || "Search finished";

  return (
    <div style={css("align-self:stretch;max-width:620px;display:flex;flex-direction:column;gap:10px;animation:cUp .25s ease-out backwards")}>
      <Box
        onClick={() => setOpen(!expanded)}
        aria-expanded={expanded}
        aria-label={expanded ? "Hide the search steps" : "Show the search steps"}
        style="display:flex;align-items:center;gap:8px;cursor:pointer;color:#6b7686;font-size:14px;align-self:flex-start"
        styleHover="color:#101418"
      >
        <i className={failed ? "icon-ban" : "icon-sparkle"} style={{ fontSize: 15, color: failed ? "#C0362C" : "#006aff" }} />
        <span style={css(running ? "background:linear-gradient(90deg,#6b7686 30%,#c7ced8 50%,#6b7686 70%);background-size:200% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:cShim 1.6s linear infinite" : "")}>{head}</span>
        <i className={expanded ? "icon-chevron-up" : "icon-chevron-down"} style={{ fontSize: 14 }} />
      </Box>

      {expanded && steps.length > 0 && (
        <div style={css("display:flex;flex-direction:column;position:relative;padding-left:4px")}>
          {steps.map((s, i) => {
            const active = s.status === "active" && running;
            const last = i === steps.length - 1;
            return (
              <div key={s.id} style={css("display:flex;gap:14px;position:relative;padding-bottom:" + (last ? "0" : "16px"))}>
                {/* the rail between dots */}
                {!last && <span style={css("position:absolute;left:5px;top:16px;bottom:0;width:1.5px;background:#e3e7ed")} />}
                <span style={css("flex:none;width:12px;height:12px;border-radius:50%;margin-top:5px;position:relative;z-index:1;" + (active ? "background:#006aff;box-shadow:0 0 0 4px #d6e6ff;animation:pulse 1.4s ease-in-out infinite" : "background:#c7ced8"))} />
                <div style={css("flex:1;min-width:0;display:flex;flex-direction:column;gap:4px")}>
                  <div style={css("font-size:14.5px;color:" + (active ? "#101418" : "#3f4652") + ";font-weight:" + (active ? "500" : "400"))}>{s.label}</div>
                  {s.detail && <div style={css("font-size:13.5px;color:#8a94a3;line-height:1.5;overflow-wrap:anywhere")}>{s.detail}</div>}
                  {!!s.items?.length && (
                    <div style={css("margin-top:6px;border:1px solid #e3e7ed;border-radius:14px;overflow:hidden;background:#fff")}>
                      {s.items.map((it, j) => (
                        <Box
                          key={j}
                          onClick={() => { if (safeHttpUrl(it.url ?? null)) openExternal(it.url ?? null); }}
                          style={"display:flex;align-items:center;gap:12px;padding:10px 14px;border-top:" + (j ? "1px solid #f3f4f6" : "0") + ";cursor:" + (it.url ? "pointer" : "default")}
                          styleHover={it.url ? "background:#f8fafc" : undefined}
                        >
                          <i className={it.kind === "dropped" ? "icon-ban" : "icon-globe"} style={{ fontSize: 16, color: it.kind === "dropped" ? "#C0362C" : "#6b7686", flex: "none" }} />
                          <span style={css("flex:1;min-width:0;font-size:13.5px;color:" + (it.kind === "dropped" ? "#8a94a3;text-decoration:line-through" : "#101418") + ";white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{it.title}</span>
                          <span style={css("flex:none;font-size:12.5px;color:#8a94a3")}>{it.meta}</span>
                        </Box>
                      ))}
                      {!!s.more && <div style={css("padding:8px 14px;border-top:1px solid #f3f4f6;font-size:12.5px;color:#8a94a3")}>and {s.more} more</div>}
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
