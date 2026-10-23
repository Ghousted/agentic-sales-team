"use client";
// Results card under a scrape agent's "I found N new leads" message (the ⟦leads:…⟧
// marker). Lists the leads; clicking one opens an overview where the user can open
// the source, accept or dismiss it, or jump to the Leads page.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { css, Box, Btn } from "@/components/primitives";
import Modal from "@/components/Modal";
import { chip } from "@/lib/visuals";
import { safeHttpUrl, openExternal } from "@/lib/url/safeUrl";
import { listLeadsByIds, acceptLeads, dismissLeads } from "@/lib/leads/actions";
import type { LeadDTO } from "@/lib/leads/types";
import { FitReason } from "@/components/LeadBits";

const SHOWN = 5;
const SEC = "font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px";

const REVIEW: Record<string, [string, string, string]> = {
  pending: ["#FEF3E7", "#B7791F", "To review"],
  accepted: ["#E7F7EC", "#1B7A3D", "Accepted"],
  dismissed: ["#F4F4F5", "#71717A", "Dismissed"],
};
const reviewChip = (r: string) => REVIEW[r] ?? REVIEW.pending;
const isProfile = (url: string | null) => !!url && /linkedin\.com\/(in|company)\//i.test(url);

export default function ScrapeResults({ ids }: { ids: string[] }) {
  const [leads, setLeads] = useState<LeadDTO[] | null>(null);
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<LeadDTO | null>(null);
  const key = ids.join(",");

  useEffect(() => {
    let alive = true;
    listLeadsByIds(key.split(",")).then((ls) => { if (alive) setLeads(ls); }).catch(() => { if (alive) setLeads([]); });
    return () => { alive = false; };
  }, [key]);

  // Accept/Dismiss here, or the Assessor, changes a lead's review. Keep the card in step.
  const update = (id: string, review: string) => {
    setLeads((ls) => ls?.map((l) => (l.id === id ? { ...l, review } : l)) ?? ls);
    setOpen((o) => (o && o.id === id ? { ...o, review } : o));
  };
  const openLead = async (l: LeadDTO) => {
    setOpen(l);
    const [fresh] = await listLeadsByIds([l.id]).catch(() => []);
    if (fresh) { setOpen((o) => (o?.id === fresh.id ? fresh : o)); setLeads((ls) => ls?.map((x) => (x.id === fresh.id ? fresh : x)) ?? ls); }
  };

  if (leads === null) {
    return <div style={css("align-self:flex-start;font-size:12.5px;color:#8a94a3;padding:4px 2px")}>Loading the leads…</div>;
  }
  if (leads.length === 0) return null; // deleted since, or not this user's

  const shown = all ? leads : leads.slice(0, SHOWN);
  return (
    <>
      <div style={css("align-self:flex-start;width:100%;max-width:560px;background:#fff;border:1px solid #e3e7ed;border-radius:16px;overflow:hidden;box-shadow:0 6px 24px -14px rgba(16,20,24,.18);animation:cUp .25s ease-out backwards")}>
        <div style={css("display:flex;align-items:center;gap:8px;padding:11px 16px;border-bottom:1px solid #f0f2f5")}>
          <i className="icon-users-round" style={{ fontSize: 15, color: "#006aff" }} />
          <div style={css("font-size:13.5px;font-weight:600;color:#101418")}>{leads.length} new lead{leads.length === 1 ? "" : "s"}</div>
          <div style={css("margin-left:auto;font-size:11.5px;color:#8a94a3")}>Click one for details</div>
        </div>
        {shown.map((l) => {
          const [bg, fg, label] = reviewChip(l.review);
          return (
            <Box key={l.id} onClick={() => openLead(l)} aria-label={`Open ${l.name}`} style="display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid #f6f7f9;cursor:pointer" styleHover="background:#f8fafc">
              <div style={css("width:30px;height:30px;border-radius:50%;background:#eaf2ff;color:#006aff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;flex:none")}>{(l.company || l.name).trim()[0]?.toUpperCase() ?? "?"}</div>
              <div style={css("flex:1;min-width:0")}>
                <div style={css("font-size:13.5px;font-weight:500;color:#101418;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{l.name}{l.company && l.company !== l.name ? <span style={css("color:#8a94a3;font-weight:400")}> · {l.company}</span> : null}</div>
                <div style={css("font-size:12.5px;color:#6b7686;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{l.title || "-"}</div>
                {l.fitReason && <div style={css("font-size:12px;color:#1B7A3D;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px")}>{l.review === "dismissed" ? "Not a fit: " : "Why: "}{l.fitReason}</div>}
              </div>
              {l.platform && <span style={css(chip("#EAF2FF", "#006AFF") + ";flex:none")}>{l.platform}</span>}
              <span style={css(chip(bg, fg) + ";flex:none")}>{label}</span>
            </Box>
          );
        })}
        {leads.length > SHOWN && (
          <Box onClick={() => setAll((a) => !a)} style="padding:9px 16px;font-size:12.5px;font-weight:500;color:#006aff;cursor:pointer;text-align:center" styleHover="background:#f8fafc">
            {all ? "Show fewer" : `Show all ${leads.length}`}
          </Box>
        )}
      </div>
      {open && <LeadOverview lead={open} onClose={() => setOpen(null)} onReview={update} />}
    </>
  );
}

function LeadOverview({ lead: l, onClose, onReview }: { lead: LeadDTO; onClose: () => void; onReview: (id: string, review: string) => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [bg, fg, label] = reviewChip(l.review);
  const url = safeHttpUrl(l.profileUrl);
  const rb = l.research;

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);

  const review = async (to: "accepted" | "dismissed") => {
    if (busy) return;
    setBusy(true);
    try {
      await (to === "accepted" ? acceptLeads([l.id]) : dismissLeads([l.id]));
      onReview(l.id, to);
    } finally { setBusy(false); }
  };

  return (
    <Modal onClose={onClose} label={l.name} focusField={false} overlayStyle="position:fixed;inset:0;background:rgba(24,24,27,.45);z-index:60;display:flex;align-items:center;justify-content:center;padding:16px;animation:fadeUp .2s ease" style="background:#fff;border-radius:18px;width:100%;max-width:520px;max-height:86vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 60px rgba(24,24,27,.28)">
        <div style={css("padding:18px 20px;border-bottom:1px solid #F0F0F3;display:flex;align-items:flex-start;gap:10px")}>
          <div style={css("flex:1;min-width:0")}>
            <div style={css("font-size:16px;font-weight:700;overflow-wrap:anywhere")}>{l.name}</div>
            <div style={css("font-size:12px;color:#71717A;margin-top:6px;display:flex;flex-wrap:wrap;gap:6px;align-items:center")}>
              <span style={css(chip(bg, fg))}>{label}</span>
              {l.platform && <span style={css(chip("#EAF2FF", "#006AFF"))}>{l.platform}</span>}
              {l.company && l.company !== l.name && <span>{l.company}</span>}
            </div>
          </div>
          <Box onClick={onClose} aria-label="Close" style="font-size:18px;color:var(--text-muted);cursor:pointer;line-height:1;padding:2px 4px;flex:none" styleHover="color:#3F3F46">✕</Box>
        </div>
        <div style={css("padding:18px 20px;overflow-y:auto;display:flex;flex-direction:column;gap:16px")}>
          <div>
            <div style={css(SEC)}>{isProfile(l.profileUrl) ? "Role" : "What they want"}</div>
            <div style={css("font-size:14px;color:#27272A;line-height:1.55")}>{l.title || "Not stated."}</div>
          </div>
          <FitReason lead={l} />
          <div>
            <div style={css(SEC)}>Contact</div>
            <div style={css("display:flex;flex-direction:column;gap:6px;font-size:13px")}>
              {l.email ? <a href={"mailto:" + l.email} style={css("color:#006AFF;text-decoration:none;font-weight:500")}>{l.email}</a> : <span style={css("color:#71717A")}>No email. Reach them through the {isProfile(l.profileUrl) ? "profile" : "post"}.</span>}
              {url && <Box onClick={() => openExternal(l.profileUrl)} style="color:#006AFF;cursor:pointer;font-weight:500;overflow-wrap:anywhere" styleHover="text-decoration:underline">{isProfile(l.profileUrl) ? "Open profile" : "Open post"} ↗</Box>}
            </div>
          </div>
          {rb && (
            <div>
              <div style={css(SEC)}>Research</div>
              {rb.summary && <div style={css("font-size:13px;color:#3F3F46;line-height:1.55")}>{rb.summary}</div>}
              {rb.angle && <div style={css("font-size:12.5px;color:#52525B;margin-top:6px")}><b>Angle:</b> {rb.angle}</div>}
            </div>
          )}
          <div style={css("font-size:11.5px;color:var(--text-muted)")}>Found {new Date(l.createdAt).toLocaleString()}</div>
        </div>
        <div style={css("padding:12px 20px;border-top:1px solid #F0F0F3;display:flex;gap:8px;align-items:center;flex-wrap:wrap")}>
          {l.review !== "accepted" && (
            <Btn onClick={() => review("accepted")} style={"height:34px;padding:0 16px;border:0;border-radius:999px;background:#101418;color:#fff;font-size:13.5px;font-weight:500;cursor:pointer;display:flex;align-items:center;gap:6px;" + (busy ? "opacity:.6" : "")} styleHover="background:#2a313b"><i className="icon-check" style={{ fontSize: 14 }} />Accept</Btn>
          )}
          {l.review !== "dismissed" && (
            <Btn onClick={() => review("dismissed")} style={"height:34px;padding:0 14px;border:0;border-radius:999px;background:#F4F4F5;color:#3F3F46;font-size:13.5px;cursor:pointer;" + (busy ? "opacity:.6" : "")} styleHover="background:#FEECF2;color:#F43F7E">Dismiss</Btn>
          )}
          <Btn onClick={() => router.push("/leads")} style="margin-left:auto;height:34px;padding:0 12px;border:0;border-radius:999px;background:transparent;color:#006aff;font-size:13.5px;cursor:pointer" styleHover="background:#eaf2ff">Open in Leads →</Btn>
        </div>
    </Modal>
  );
}
