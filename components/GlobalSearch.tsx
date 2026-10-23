"use client";
// Top-bar global search: live results across agents, teams, leads and products.
// Agents and teams are filtered client-side; leads and products come from a
// capped server search, debounced so typing doesn't fire a query per key.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/store";
import { searchRecords } from "@/lib/search/actions";
import type { SearchResults } from "@/lib/search/store";
import { av } from "@/lib/visuals";
import { css, Box } from "./primitives";

interface Result {
  key: string;
  type: "Agent" | "Team" | "Lead" | "Product";
  title: string;
  subtitle: string;
  avatar: string; // inline style for the leading swatch/avatar
  initials?: string;
  go: () => void;
}

const TILE = "width:28px;height:28px;border-radius:8px;flex:none;display:flex;align-items:center;justify-content:center;";
// True when focus is moving to another element inside the search container.
export function focusStaysIn(container: { contains(n: Node | null): boolean }, next: EventTarget | null): boolean {
  return next !== null && container.contains(next as Node);
}

const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");

export default function GlobalSearch({ compact = false, autoFocus = false }: { compact?: boolean; autoFocus?: boolean }) {
  const { s, set, agents, teams } = useApp();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (autoFocus) inputRef.current?.focus(); }, [autoFocus]);
  const q = s.search.trim().toLowerCase();
  const [remote, setRemote] = useState<{ q: string; r: SearchResults } | null>(null);

  useEffect(() => {
    if (q.length < 2) return;
    let live = true;
    const t = setTimeout(() => {
      searchRecords(q)
        .catch((e): SearchResults => { console.error("[search] failed:", e); return { leads: [], products: [] }; })
        .then((r) => { if (live) setRemote({ q, r }); });
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [q]);

  const results: Result[] = [];
  if (q) {
    const has = (...xs: (string | undefined)[]) => xs.some((x) => x?.toLowerCase().includes(q));
    for (const a of agents.filter((a) => has(a.name, a.role, a.task, a.goal)).slice(0, 5)) {
      results.push({ key: "a:" + a.id, type: "Agent", title: a.name, subtitle: a.role + " · " + a.task, avatar: av(a, 28), initials: a.initials, go: () => router.push("/agents/" + a.id) });
    }
    for (const t of teams.filter((t) => has(t.name, t.desc, t.goal)).slice(0, 4)) {
      results.push({ key: "t:" + t.id, type: "Team", title: t.name, subtitle: t.desc, avatar: "width:28px;height:28px;border-radius:8px;flex:none;display:flex;align-items:center;justify-content:center;font-size:15px;background:" + t.iconBg, initials: t.icon, go: () => router.push("/teams/" + t.id) });
    }
    // Only show server hits for the current query, never a previous one.
    if (remote?.q === q) {
      for (const l of remote.r.leads) {
        results.push({ key: "l:" + l.id, type: "Lead", title: l.title, subtitle: l.subtitle, avatar: TILE + "background:#EAF2FF;color:#006AFF;font-size:11px;font-weight:700", initials: initialsOf(l.title), go: () => router.push("/leads") });
      }
      for (const p of remote.r.products) {
        results.push({ key: "p:" + p.id, type: "Product", title: p.title, subtitle: p.subtitle, avatar: TILE + "background:#F4F4F5;color:#3F3F46;font-size:11px;font-weight:700", initials: initialsOf(p.title), go: () => router.push("/products") });
      }
    }
  }

  const showDropdown = open && q.length > 0;
  const listRef = useRef<HTMLDivElement>(null);

  return (
    <div
      // Close when focus leaves the whole search (input + results), not on input blur,
      // so Tab and clicks can reach a result.
      onBlur={(e) => { if (!focusStaysIn(e.currentTarget, e.relatedTarget)) setOpen(false); }}
      onKeyDown={(e) => { if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); inputRef.current?.focus(); } }}
      style={css(compact ? "position:relative;width:100%" : "margin-left:auto;position:relative;width:380px")}
    >
      <div style={css(compact ? "height:40px;display:flex;align-items:center;gap:12px;background:transparent;border-radius:10px;padding:0 12px;min-width:0" : "height:45px;display:flex;align-items:center;gap:8px;background:#F4F4F5;border-radius:99px;padding:0 18px;min-width:0")}>
        {compact ? <i className="icon-search" aria-hidden="true" style={{ fontSize: 17, color: "#4a5565" }} /> : <span aria-hidden="true" style={{ fontSize: "16px", color: "var(--text-muted)" }}>⌕</span>}
        <input
          ref={inputRef}
          aria-label="Search agents, teams, leads and products"
          value={s.search}
          onChange={(e) => { set({ search: e.target.value }); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && showDropdown) {
              e.preventDefault();
              listRef.current?.querySelector<HTMLElement>("[role=button]")?.focus();
            }
          }}
          placeholder={compact ? "Search" : "Search agents, teams, leads…"}
          style={css("flex:1;border:none;outline:none;background:transparent;font-size:" + (compact ? "14px" : "13px") + ";color:#18181B;min-width:0")}
        />
      </div>

      {showDropdown && (
        // preventDefault on mousedown keeps focus in the input while a result is clicked
        // (Safari doesn't move focus on click), so the container never sees focus leave.
        <div ref={listRef} id="global-search-results" aria-label="Search results" onMouseDown={(e) => e.preventDefault()} style={css("position:absolute;top:" + (compact ? "42px;width:300px" : "52px;right:0") + ";left:0;background:#fff;border:1px solid #ECECF1;border-radius:14px;box-shadow:0 12px 32px rgba(24,24,27,.12);padding:6px;z-index:40;max-height:60vh;overflow-y:auto")}>
          {results.length === 0 ? (
            <div style={css("padding:14px 12px;font-size:12.5px;color:var(--text-muted)")}>{q.length >= 2 && remote?.q !== q ? "Searching…" : <>No matches for “{s.search.trim()}”</>}</div>
          ) : (
            results.map((r) => (
              <Box
                key={r.key}
                onClick={() => { r.go(); set({ search: "" }); setOpen(false); }}
                style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;cursor:pointer"
                styleHover="background:#F5F8FE"
              >
                <div style={css(r.avatar)}>{r.initials}</div>
                <div style={css("min-width:0;flex:1")}>
                  <div style={css("font-size:12.5px;font-weight:600;color:#18181B")}>{r.title}</div>
                  <div style={css("font-size:11px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{r.subtitle}</div>
                </div>
                <span style={css("font-size:10px;font-weight:600;color:#006AFF;background:#EAF2FF;border-radius:99px;padding:2px 8px;flex:none")}>{r.type}</span>
              </Box>
            ))
          )}
        </div>
      )}
    </div>
  );
}
