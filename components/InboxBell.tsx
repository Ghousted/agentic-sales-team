"use client";
// Global email-drafts inbox: a top-bar dropdown of every outreach draft across
// all agents, with one-click mail routing (mailto pre-filled) so the user never
// has to open each agent to send.
import { useEffect, useRef, useState } from "react";
import { useApp } from "@/lib/store";
import { listAllDrafts, markDraftSent, discardDraft, clearSentDrafts, clearAllDrafts } from "@/lib/leads/actions";
import type { DraftDTO } from "@/lib/leads/types";
import { av, chip } from "@/lib/visuals";
import { css, Box, Btn } from "./primitives";

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "now"; if (m < 60) return m + "m"; const h = Math.round(m / 60);
  if (h < 24) return h + "h"; return Math.round(h / 24) + "d";
}

export default function InboxBell() {
  const { byId, showToast } = useApp();
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<DraftDTO[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  const refetch = () => { listAllDrafts().then(setDrafts).catch(() => {}); };
  useEffect(() => { refetch(); }, []);

  // Close on click outside the icon + panel.
  useEffect(() => {
    if (!open) return;
    const onClickAway = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", onClickAway);
    return () => document.removeEventListener("click", onClickAway);
  }, [open]);

  const unsent = drafts.filter((d) => d.status !== "sent").length;
  const sentCount = drafts.filter((d) => d.status === "sent").length;

  const openInMail = (d: DraftDTO) => {
    // Recipient stays literal (RFC 6068 addr-spec); only the query params are encoded.
    const url = "mailto:" + d.leadEmail + "?subject=" + encodeURIComponent(d.subject) + "&body=" + encodeURIComponent(d.body);
    window.open(url, "_blank");
  };
  const copyMessage = (d: DraftDTO) => {
    navigator.clipboard?.writeText(d.body).then(() => showToast("Message copied"), () => showToast("Copy failed"));
  };
  const markSent = async (d: DraftDTO) => {
    setDrafts((prev) => prev.map((x) => (x.id === d.id ? { ...x, status: "sent" } : x)));
    await markDraftSent(d.id);
  };
  // Discard/Clear-sent soft-hide the draft from this inbox; the row stays in the
  // table so the analytics drafted/sent counts never move.
  const discard = async (d: DraftDTO) => {
    setDrafts((prev) => prev.filter((x) => x.id !== d.id));
    await discardDraft(d.id);
    showToast("Draft discarded");
  };
  const clearSent = async () => {
    setDrafts((prev) => prev.filter((x) => x.status !== "sent"));
    const n = await clearSentDrafts();
    if (n > 0) showToast(`Cleared ${n} sent draft${n === 1 ? "" : "s"}`);
  };
  const clearAll = async () => {
    setDrafts([]);
    const n = await clearAllDrafts();
    if (n > 0) showToast(`Cleared ${n} draft${n === 1 ? "" : "s"}`);
  };

  return (
    <div ref={ref} style={css("position:relative;flex:none")}>
      <Box
        onClick={() => { setOpen((o) => !o); if (!open) refetch(); }}
        aria-label={unsent > 0 ? unsent + " email drafts to send" : "Email drafts"}
        style="position:relative;width:40px;height:40px;border-radius:50%;background:#F2F4F7;display:flex;align-items:center;justify-content:center;color:#006AFF;cursor:pointer"
        styleHover="background:#D6E6FF"
      >
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="m3.5 6.5 8.5 6 8.5-6" />
        </svg>
        {unsent > 0 && <span style={css("position:absolute;top:5px;right:5px;min-width:17px;height:17px;padding:0 4px;border-radius:99px;background:#F43F7E;color:#fff;font-size:10px;font-weight:700;line-height:1;display:flex;align-items:center;justify-content:center;border:2px solid #F2F4F7")}>{unsent}</span>}
      </Box>

      {open && (
        <div style={css("position:absolute;top:48px;right:0;width:400px;background:#fff;border:1px solid #ECECF1;border-radius:14px;box-shadow:0 12px 32px rgba(24,24,27,.14);z-index:40;overflow:hidden")}>
          <div style={css("display:flex;align-items:center;gap:8px;padding:14px 16px;border-bottom:1px solid #F0F0F3")}>
            <div style={css("font-size:13.5px;font-weight:700")}>Email drafts</div>
            <div style={css("flex:1")} />
            {sentCount > 0 && (
              <Btn onClick={clearSent} style="background:transparent;border:none;color:#71717A;font-size:11px;font-weight:600;cursor:pointer;padding:2px 4px" styleHover="color:#F43F7E">Clear sent</Btn>
            )}
            {drafts.length > 0 && (
              <Btn onClick={clearAll} style="background:transparent;border:none;color:#71717A;font-size:11px;font-weight:600;cursor:pointer;padding:2px 4px" styleHover="color:#F43F7E">Clear all</Btn>
            )}
            <div style={css("font-size:11px;font-weight:600;color:#006AFF;background:#EAF2FF;border-radius:99px;padding:2px 9px")}>{unsent} to send</div>
          </div>
          <div style={css("max-height:70vh;overflow-y:auto")}>
            {drafts.length === 0 ? (
              <div style={css("padding:16px;font-size:12.5px;color:#A1A1AA")}>No drafts yet. Ask an agent to draft outreach and it lands here.</div>
            ) : (
              drafts.map((d) => {
                const a = byId(d.agentId);
                const preview = d.body.length > 160 ? d.body.slice(0, 160) + "…" : d.body;
                return (
                  <div key={d.id} style={css("padding:12px 16px;border-bottom:1px solid #F4F4F6")}>
                    <div style={css("display:flex;align-items:center;gap:8px")}>
                      {a && <div style={css(av(a, 22))}>{a.initials}</div>}
                      <span style={css("font-size:12px;font-weight:600;color:#18181B")}>{a ? a.name.split(" ")[0] : "Agent"}</span>
                      <span style={css(chip(d.status === "sent" ? "#E7F7EC" : "#EAF2FF", d.status === "sent" ? "#1B7A3D" : "#006AFF"))}>{d.status === "sent" ? "Sent" : "Draft"}</span>
                      <span style={css("margin-left:auto;font-size:10.5px;color:#A1A1AA")}>{relTime(d.createdAt)}</span>
                    </div>
                    <div style={css("font-size:11px;color:#A1A1AA;margin-top:5px")}>to {d.leadName}{d.leadCompany ? " · " + d.leadCompany : ""} · {d.leadEmail || (d.leadPlatform ? d.leadPlatform + " DM" : "no email")}</div>
                    <div style={css("font-size:12.5px;font-weight:700;color:#18181B;margin-top:5px")}>{d.subject}</div>
                    <div style={css("font-size:11.5px;color:#52525B;line-height:1.55;margin-top:3px;white-space:pre-wrap")}>{preview}</div>
                    <div style={css("display:flex;gap:6px;margin-top:9px;flex-wrap:wrap")}>
                      {d.leadEmail ? (
                        <Btn onClick={() => openInMail(d)} style="background:#E6F0FF;color:#006AFF;border:none;border-radius:99px;padding:5px 13px;font-size:11.5px;font-weight:600;cursor:pointer" styleHover="background:#D6E6FF">Open in mail</Btn>
                      ) : (<>
                        <Btn onClick={() => copyMessage(d)} style="background:#E6F0FF;color:#006AFF;border:none;border-radius:99px;padding:5px 13px;font-size:11.5px;font-weight:600;cursor:pointer" styleHover="background:#D6E6FF">Copy message</Btn>
                        {d.leadProfileUrl && <Btn onClick={() => window.open(d.leadProfileUrl!, "_blank")} style="background:#F4F4F5;color:#3F3F46;border:none;border-radius:99px;padding:5px 13px;font-size:11.5px;font-weight:600;cursor:pointer" styleHover="background:#E4E4E7">Open profile</Btn>}
                      </>)}
                      {d.status !== "sent" && <Btn onClick={() => markSent(d)} style="background:#F4F4F5;color:#3F3F46;border:none;border-radius:99px;padding:5px 13px;font-size:11.5px;font-weight:600;cursor:pointer" styleHover="background:#E4E4E7">Mark sent</Btn>}
                      {d.status !== "sent" && <Btn onClick={() => discard(d)} style="background:transparent;color:#A1A1AA;border:none;border-radius:99px;padding:5px 11px;font-size:11.5px;font-weight:600;cursor:pointer" styleHover="background:#FEECF2;color:#F43F7E">Discard</Btn>}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
