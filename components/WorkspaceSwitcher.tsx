"use client";
// The sidebar's workspace row: opens a menu to switch between the account's
// workspaces (one per business) or make a new one. A switch reloads the app, so
// every page, agent, team and chat comes from the new workspace.
import { useEffect, useRef, useState } from "react";
import { css, Btn } from "./primitives";
import { listWorkspaces, createWorkspace, switchWorkspace, type WorkspaceDTO } from "@/lib/workspaces/actions";

const initial = (name: string) => (name.trim()[0] || "W").toUpperCase();
const ROW = "width:100%;display:flex;align-items:center;gap:10px;height:40px;padding:0 10px;border:0;border-radius:9px;background:transparent;font-size:14px;text-align:left;cursor:pointer";

export default function WorkspaceSwitcher({ name, onSettings }: { name: string; onSettings: () => void }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<WorkspaceDTO[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    listWorkspaces().then(setList).catch(() => setList([]));
    // pointerdown, not click: "New workspace" swaps itself for the name field, so by
    // the time a click event reaches the document its target is no longer inside
    // the menu, and the menu would close on its own button.
    const away = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("pointerdown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const close = () => { setOpen(false); setAdding(false); setDraft(""); setError(""); };
  // A full reload, so the client store loads the new workspace's data from scratch.
  const reload = () => window.location.assign("/");
  const pick = async (w: WorkspaceDTO) => {
    if (w.active || busy) return close();
    setBusy(true);
    const r = await switchWorkspace(w.id);
    if ("error" in r) { setBusy(false); setError(r.error); return; }
    reload();
  };
  const create = async () => {
    if (!draft.trim() || busy) return;
    setBusy(true);
    const r = await createWorkspace(draft);
    if ("error" in r) { setBusy(false); setError(r.error); return; }
    reload();
  };

  return (
    <div ref={ref} style={css("position:relative")}>
      <Btn onClick={() => (open ? close() : setOpen(true))} aria-haspopup="menu" aria-expanded={open} aria-label={`Workspace: ${name}. Switch workspace`} style={"width:100%;height:44px;display:flex;align-items:center;gap:10px;padding:0 10px;border:0;border-radius:10px;background:" + (open ? "#eceef1" : "transparent") + ";text-align:left;cursor:pointer"} styleHover="background:#eceef1">
        <span style={css("width:28px;height:28px;flex:none;border-radius:8px;background:#101418;color:#ffffff;font-size:12px;font-weight:600;display:flex;align-items:center;justify-content:center")}>{initial(name)}</span>
        <span style={css("flex:1;min-width:0")}><span style={css("display:block;font-size:11.5px;color:#6b7686")}>Workspace</span><span style={css("display:block;font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{name}</span></span>
        <i className="icon-chevrons-up-down" style={{ fontSize: 15, color: "#8a94a3" }} />
      </Btn>
      {open && (
        <div role="menu" aria-label="Workspaces" style={css("position:absolute;left:0;right:0;bottom:calc(100% + 6px);z-index:61;padding:6px;background:#ffffff;border:1px solid rgba(16,20,24,.08);border-radius:14px;box-shadow:0 16px 40px rgba(16,20,24,.16);animation:cMenu .14s ease-out backwards;transform-origin:50% 100%")}>
          <div style={css("padding:6px 10px 4px;font-size:12px;font-weight:500;color:#6b7686")}>Workspaces</div>
          <div style={css("max-height:240px;overflow-y:auto")}>
            {list === null ? (
              <div style={css("padding:8px 10px;font-size:13px;color:#8a94a3")}>Loading…</div>
            ) : list.map((w) => (
              <Btn key={w.id} role="menuitemradio" aria-checked={w.active} onClick={() => pick(w)} style={ROW + (busy ? ";opacity:.6" : "")} styleHover="background:#f3f4f6">
                <span style={css("width:24px;height:24px;flex:none;border-radius:7px;background:" + (w.active ? "#101418" : "#eceef1") + ";color:" + (w.active ? "#fff" : "#4a5565") + ";font-size:11px;font-weight:600;display:flex;align-items:center;justify-content:center")}>{initial(w.name)}</span>
                <span style={css("flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:" + (w.active ? "500" : "400"))}>{w.name}</span>
                {w.active && <i className="icon-check" style={{ fontSize: 15, color: "#006aff" }} />}
              </Btn>
            ))}
          </div>
          <div style={css("height:1px;background:#eef1f5;margin:6px 4px")} />
          {adding ? (
            <div style={css("display:flex;flex-direction:column;gap:6px;padding:4px 6px 6px")}>
              <input
                autoFocus
                aria-label="New workspace name"
                value={draft}
                maxLength={80}
                onChange={(e) => { setDraft(e.target.value); setError(""); }}
                onKeyDown={(e) => { if (e.key === "Enter") create(); }}
                placeholder="Business name"
                style={css("width:100%;border:1px solid #e3e7ed;border-radius:9px;padding:8px 10px;font-size:13.5px;outline:none")}
              />
              <div style={css("display:flex;gap:6px;justify-content:flex-end")}>
                <Btn onClick={() => { setAdding(false); setDraft(""); setError(""); }} style="height:30px;padding:0 12px;border:0;border-radius:999px;background:transparent;color:#6b7686;font-size:13px;cursor:pointer" styleHover="background:#f3f4f6">Cancel</Btn>
                <Btn onClick={create} disabled={!draft.trim() || busy} style={"height:30px;padding:0 14px;border:0;border-radius:999px;font-size:13px;font-weight:500;cursor:" + (draft.trim() && !busy ? "pointer;background:#101418;color:#fff" : "default;background:#e3e7ed;color:#8a94a3")} styleHover={draft.trim() && !busy ? "background:#2a313b" : undefined}>{busy ? "Creating…" : "Create"}</Btn>
              </div>
            </div>
          ) : (
            <Btn role="menuitem" onClick={() => setAdding(true)} style={ROW} styleHover="background:#f3f4f6"><i className="icon-plus" style={{ fontSize: 16, color: "#4a5565" }} />New workspace</Btn>
          )}
          <Btn role="menuitem" onClick={() => { close(); onSettings(); }} style={ROW} styleHover="background:#f3f4f6"><i className="icon-pen-line" style={{ fontSize: 16, color: "#4a5565" }} />Workspace settings</Btn>
          {error && <div role="alert" style={css("padding:4px 10px 6px;font-size:12.5px;color:#C0362C")}>{error}</div>}
        </div>
      )}
    </div>
  );
}
