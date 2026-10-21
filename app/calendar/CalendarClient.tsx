"use client";
import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/lib/store";
import { css, Box } from "@/components/primitives";
import { buildCalendarFromMeetings, buildMonthGrid } from "@/lib/calendar";
import type { MeetingDTO } from "@/lib/meetings/store";

export default function CalendarClient({ initialEvents }: { initialEvents: MeetingDTO[] }) {
  const { agents } = useApp();
  const events = initialEvents;
  const [view, setView] = useState<"week" | "month">("week");
  const [weekOffset, setWeekOffset] = useState(0);
  const [monthOffset, setMonthOffset] = useState(0);
  // Dates come from the browser clock after mount, never the server's timezone.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);
  const cal = useMemo(
    () => buildCalendarFromMeetings(events, agents, now ? { now, weekOffset } : undefined),
    [events, agents, now, weekOffset]
  );

  const monthYear = now ? new Date(now.getFullYear(), now.getMonth() + monthOffset, 1) : null;
  const y = monthYear?.getFullYear();
  const m = monthYear?.getMonth();
  const month = useMemo(
    () => (y === undefined || m === undefined ? { label: "", weeks: [] } : buildMonthGrid(cal.events, y, m)),
    [cal.events, y, m]
  );

  const isWeek = view === "week";
  const periodLabel = isWeek ? cal.weekLabel : month.label;
  const prev = () => (isWeek ? setWeekOffset((o) => o - 1) : setMonthOffset((o) => o - 1));
  const next = () => (isWeek ? setWeekOffset((o) => o + 1) : setMonthOffset((o) => o + 1));
  const reset = () => (isWeek ? setWeekOffset(0) : setMonthOffset(0));

  const segBtn = (active: boolean) =>
    "padding:6px 16px;font-size:12.5px;font-weight:600;border-radius:99px;cursor:pointer;transition:all .12s;" +
    (active ? "background:#fff;color:#18181B;box-shadow:0 1px 2px rgba(0,0,0,.08)" : "color:#71717A");
  const navBtn = "width:32px;height:32px;border-radius:8px;background:#F4F4F5;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:15px;color:#52525B";

  return (
    <div style={css("padding:24px 26px;display:flex;flex-direction:column;gap:18px;animation:fadeUp .3s ease")}>
      {/* summary cards */}
      <div style={css("display:grid;grid-template-columns:repeat(4,1fr);gap:14px")}>
        {cal.summary.map((cs) => (
          <div key={cs.label} style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:18px;display:flex;align-items:center;gap:14px")}>
            <div style={css("width:40px;height:40px;border-radius:12px;background:" + cs.bg + ";display:flex;align-items:center;justify-content:center;flex:none;font-size:19px")}>{cs.emoji}</div>
            <div><div style={css("font-size:22px;font-weight:700;color:#18181B;letter-spacing:-.02em")}>{cs.value}</div><div style={css("font-size:11.5px;color:#71717A;margin-top:2px")}>{cs.label}</div></div>
          </div>
        ))}
      </div>

      {/* schedule card */}
      <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:20px;overflow-x:auto")}>
        <div style={css("display:flex;align-items:center;gap:14px;margin-bottom:18px")}>
          <div style={css("font-family:'General Sans',Inter,sans-serif;font-size:18px;font-weight:400")}>Schedule</div>
          <div style={css("display:flex;background:#F4F4F5;border-radius:99px;padding:3px")}>
            <Box onClick={() => setView("week")} style={segBtn(isWeek)}>Week</Box>
            <Box onClick={() => setView("month")} style={segBtn(!isWeek)}>Month</Box>
          </div>
          <div style={css("margin-left:auto;display:flex;align-items:center;gap:10px")}>
            <Box onClick={prev} style={navBtn} styleHover="background:#E4E4E7">‹</Box>
            <Box onClick={reset} style="font-size:13px;font-weight:600;color:#18181B;background:#F4F4F5;border-radius:99px;padding:7px 16px;cursor:pointer" styleHover="background:#E4E4E7">{periodLabel}</Box>
            <Box onClick={next} style={navBtn} styleHover="background:#E4E4E7">›</Box>
          </div>
        </div>

        {isWeek ? (
          <div style={css("display:grid;grid-template-columns:64px repeat(7,minmax(90px,1fr));min-width:760px")}>
            <div />
            {cal.dayLabels.map((label, i) => (
              <div key={i} style={css("text-align:center;padding-bottom:10px;border-bottom:1px solid #F0F0F3")}>
                <div style={css("font-size:11px;color:#A1AEBE;font-weight:600")}>{label}</div>
                <div style={css("font-size:14px;font-weight:700;color:#18181B;margin-top:2px")}>{cal.dayNums[i]}</div>
              </div>
            ))}
            {cal.weekRows.map((row, ri) => (
              <div key={ri} style={css("display:contents")}>
                <div style={css("font-size:11px;color:#A1AEBE;padding:6px 8px 0 0;text-align:right;border-top:1px solid #F4F4F6")}>{row.hour}</div>
                {row.cells.map((cell, ci) => (
                  <div key={ci} style={css("border-top:1px solid #F4F4F6;border-left:1px solid #F4F4F6;min-height:52px;padding:3px")}>
                    {cell.map((ev, ei) => (
                      <div key={ei} title={ev.title} style={css("background:" + ev.colors[0] + ";border-radius:8px;padding:3px;display:flex;align-items:center;gap:4px;overflow:hidden;height:100%")}>
                        <div style={css(ev.avStyle)}>{ev.initials}</div>
                        <div style={css("font-size:10px;font-weight:600;color:#3F3F46;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0")}>{ev.title}</div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div style={css("min-width:640px")}>
            <div style={css("display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-bottom:8px")}>
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                <div key={d} style={css("text-align:center;font-size:11px;color:#A1AEBE;font-weight:600")}>{d}</div>
              ))}
            </div>
            <div style={css("display:flex;flex-direction:column;gap:6px")}>
              {month.weeks.map((week, wi) => (
                <div key={wi} style={css("display:grid;grid-template-columns:repeat(7,1fr);gap:6px")}>
                  {week.map((cell, di) => (
                    <div key={di} style={css("min-height:74px;border:1px solid #F0F0F3;border-radius:10px;padding:6px 7px;" + (cell.day ? "background:#fff" : "background:#FAFAFB"))}>
                      {cell.day && <div style={css("font-size:11.5px;font-weight:600;color:#52525B")}>{cell.day}</div>}
                      <div style={css("display:flex;flex-wrap:wrap;gap:3px;margin-top:5px")}>
                        {cell.events.slice(0, 4).map((ev, ei) => (
                          <div key={ei} title={ev.title} style={css("width:7px;height:7px;border-radius:50%;background:" + ev.colors[1])} />
                        ))}
                        {cell.events.length > 4 && <div style={css("font-size:9px;color:#A1AEBE;font-weight:600")}>+{cell.events.length - 4}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
