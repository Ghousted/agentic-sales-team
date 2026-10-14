// Copy and demo data for the marketing landing, ported from the "Agentic
// Salesforce - Updated" Claude Design file. Gmail/connector-specific items from
// the design are swapped for equivalents, since the app has no mailbox
// integrations.

export type AgentId = "theo" | "priya" | "maya" | "sam";

// [image, accent colour, display name]. "priya" is the design's id for Pat.
export const AG: Record<AgentId, { img: string; fg: string; name: string; tint: string; role: string }> = {
  theo: { img: "/agents/theo.jpg", fg: "#9a5800", name: "Theo", tint: "#fff3e3", role: "Lead research" },
  priya: { img: "/agents/pat.jpg", fg: "#0f7b3f", name: "Pat", tint: "#e7f5ec", role: "Lead qualification" },
  maya: { img: "/agents/maya.jpg", fg: "#0b57d0", name: "Maya", tint: "#eaf2ff", role: "Sales development" },
  sam: { img: "/agents/sam.jpg", fg: "#7b1fa2", name: "Sam", tint: "#f4e9fa", role: "Follow-ups" },
};
export const avBg = (id: AgentId) => "url('" + AG[id].img + "') center/cover no-repeat #ffffff";

export const TEAM: { id: AgentId; does: string; icon: string; chat: string }[] = [
  { id: "theo", does: "Researches each lead: the right contact, company details, recent news and a working email.", icon: "icon-search", chat: "Research updates" },
  { id: "priya", does: "Decides which researched leads fit your ideal customer, and asks you about the close calls.", icon: "icon-list-checks", chat: "Lead reviews" },
  { id: "maya", does: "Writes personal first emails and handles replies, using only facts from your approved sources.", icon: "icon-pen-line", chat: "Approvals and replies" },
  { id: "sam", does: "Follows up when there’s no reply and stops the moment someone writes back.", icon: "icon-repeat", chat: "Follow-up approvals" },
];

type Row = [string, string, string, string]; // name, detail, status, colour
export const STEPS: { title: string; id: AgentId; body: string; msg: string; rows: Row[]; btn: string }[] = [
  {
    title: "Research", id: "theo", body: "Theo researches each lead: the right contact, company details, recent news and a working email.",
    msg: "I researched 25 leads from your import. 22 are ready, and 3 had no public information.",
    rows: [["Dana Whitfield", "VP Finance · Brightloop", "Researched", "#0b57d0"], ["Hana Sato", "Finance Lead · Glasshouse AI", "Researched", "#0b57d0"], ["Owen Pryce", "Head of FP&A · Tidewater Labs", "No public info", "#8a94a3"]],
    btn: "",
  },
  {
    title: "Qualify", id: "priya", body: "Pat decides which researched leads fit your ideal customer, and asks you about the close calls.",
    msg: "Most leads are a clear yes or no. These 3 landed in between, so I’d like your call.",
    rows: [["Leah Kim", "Head of Finance · Cobalt Freight", "Score 67", "#d98e00"], ["Nora Lindqvist", "Controller · Brightpath Dental", "Score 64", "#d98e00"], ["Ana Ruiz", "Accounting Lead · Fieldnote", "Score 61", "#d98e00"]],
    btn: "Send to Maya",
  },
  {
    title: "Write", id: "maya", body: "Maya drafts a personal first email for each lead, using only facts from the product info you’ve given her.",
    msg: "I drafted 3 first emails. Nothing sends until you approve it.",
    rows: [["Dana Whitfield", "Closing the books faster at Brightloop", "Ready", "#0f7b3f"], ["Hana Sato", "NetSuite and month-end at Glasshouse", "Ready", "#0f7b3f"], ["Leah Kim", "A quick idea for Cobalt’s finance team", "Claim flagged", "#b42318"]],
    btn: "Approve 2 ready",
  },
  {
    title: "Follow up", id: "sam", body: "Sam follows up when there’s no reply and stops the moment someone writes back.",
    msg: "No reply from these 3 after 3 days. Each follow-up is short and comes to you first.",
    rows: [["Marco Bell", "Follow-up 1 of 2", "Due today", "#0b57d0"], ["Ivy Chen", "Follow-up 1 of 2", "Due today", "#0b57d0"], ["Dana Whitfield", "Stopped, she replied", "Stopped", "#8a94a3"]],
    btn: "Approve all",
  },
];

// "Your agents message you" tabs: [icon, label, agent, title, message, card, actionA, actionB]
export const KINDS: { icon: string; label: string; id: AgentId; title: string; msg: string; card: string; a: string; b: string }[] = [
  { icon: "icon-circle-check", label: "Approvals", id: "maya", title: "Approve 5 first emails", msg: "Nothing sends until you approve it. I flagged one claim I couldn’t find in your sources.", card: "To Dana Whitfield · “Closing the books faster at Brightloop”", a: "Approve", b: "Edit" },
  { icon: "icon-reply", label: "Replies", id: "maya", title: "Dana Whitfield replied", msg: "Dana is interested and wants pricing and a few times next week. I stopped her scheduled follow-ups.", card: "“This looks relevant for our Q4 close. Can you send pricing and a few times next week?”", a: "Review reply", b: "Mark qualified" },
  { icon: "icon-users-round", label: "Lead reviews", id: "priya", title: "5 borderline leads", msg: "These scored between 50 and 70, so I’d like your call before passing them on.", card: "Leah Kim · Head of Finance, Cobalt Freight · Score 67", a: "Send to Maya", b: "Skip" },
  { icon: "icon-mail-warning", label: "Problems", id: "sam", title: "2 emails bounced", msg: "Two addresses came back as undeliverable, so I paused follow-ups to them. Nothing else was affected.", card: "marco@northwindhealth.com · Address not found", a: "Find new contacts", b: "Remove them" },
];
// [mine A, reply A, mine B, reply B]
export const KREPLY: [string, string, string, string][] = [
  ["Approve", "Done. 4 emails go out tomorrow at 9:00 AM. I held back the one with the flagged claim.", "Let me edit first", "Sure. The drafts are open for you, and nothing sends until you approve."],
  ["Show me the reply", "Here’s a draft with pricing and three times next week. Want me to send it?", "Mark her qualified", "Done. Dana is marked qualified and I’ll draft a reply with pricing next."],
  ["Send Leah to Maya", "Sent. Maya will draft a first email to Leah for your approval.", "Skip her", "Skipped. I won’t bring Leah up again."],
  ["Find new contacts", "On it. Theo is looking for working addresses, and follow-ups stay paused until he finds them.", "Remove them", "Removed. Neither lead will get any more follow-ups."],
];

// Rules per agent: [key, icon, label, sub, kind]. kind: a = asks first, g = guardrail, s = always-on safety.
export type Rule = [string, string, string, string, "a" | "g" | "s"];
export const RULES: Record<AgentId, Rule[]> = {
  theo: [["verify", "icon-mail-check", "Verify every email address", "Bounced emails hurt your sender score", "g"], ["icp", "icon-list-checks", "Stay inside your ideal customer profile", "No leads outside the industries and sizes you set", "g"], ["public", "icon-search", "Use only public sources", "Company sites, news and LinkedIn pages", "s"], ["limit", "icon-chart-column", "Research at most 100 leads a day", "Keeps your usage predictable", "a"]],
  priya: [["close", "icon-users-round", "Ask me about close calls", "Leads scoring 50 to 70 come to you first", "a"], ["explain", "icon-book-open-check", "Explain every decision", "A one-line reason with each score", "g"], ["skip", "icon-x", "Never bring back skipped leads", "Once you say no, it stays no", "s"]],
  maya: [["approve", "icon-circle-check", "Approve first emails", "Maya waits for your yes before sending", "a"], ["sources", "icon-book-open-check", "Only use approved sources", "Unverified claims are flagged, not sent", "s"], ["sensitive", "icon-shield-check", "Hand sensitive questions to me", "Privacy and pricing questions come to you", "g"], ["limit", "icon-mail", "Send at most 40 emails a day", "Protects your sender reputation", "g"]],
  sam: [["approve", "icon-circle-check", "Approve each follow-up", "Sam waits for your yes before sending", "a"], ["stop", "icon-reply", "Stop when someone replies", "Follow-ups end the moment a prospect writes back", "s"], ["cap", "icon-repeat", "At most 3 follow-ups per lead", "Then Sam lets the lead rest", "g"], ["bounce", "icon-mail-warning", "Pause when an email bounces", "No more follow-ups to an address that failed", "s"]],
};
export const RPREV: Record<AgentId, [string, string]> = {
  theo: ["I researched 25 leads and verified every email address.", "I researched 25 leads. 3 email addresses are unverified, so check before sending."],
  priya: ["5 leads are close calls, so I’d like your decision before passing them on.", "I made the call on 5 close leads and passed 3 of them to Maya."],
  maya: ["I drafted 5 first emails. Nothing sends until you approve.", "I sent 5 first emails within your daily limit. Each one is logged here."],
  sam: ["3 follow-ups are ready. I’ll send them when you approve.", "I sent 3 follow-ups and stopped 1 sequence because Dana replied."],
};

export const PROMISES: [string, string, string][] = [
  ["icon-shield-check", "Approval before anything sends", "Every first email and reply waits for your yes until you change it."],
  ["icon-book-open-check", "Only facts you’ve approved", "Agents flag any claim that isn’t in your approved sources."],
  ["icon-history", "A clear record of every action", "See who did what and when, in the chat where it happened."],
];

export const TRUST: { kind: "lock" | "perms"; t: string; d: string }[] = [
  { kind: "lock", t: "Private by default", d: "Your leads and messages are never used to train shared models." },
  { kind: "perms", t: "Permissions per agent", d: "Each agent can only do what you’ve allowed it to do." },
];

export const PLANS: { name: string; for: string; items: string[]; cta: string; hi: boolean }[] = [
  { name: "Starter", for: "For founders sending their first outbound.", items: ["1 agent of your choice", "Approval on every email", "Chat support"], cta: "Start free", hi: false },
  { name: "Growth", for: "For small teams that want the full crew.", items: ["All 4 agents working together", "Team handoffs and rules", "Priority support"], cta: "Get started", hi: true },
  { name: "Enterprise", for: "For larger sales teams with custom needs.", items: ["Unlimited agents", "Custom permissions and review flows", "SSO and audit export", "A dedicated contact"], cta: "Talk to us", hi: false },
];

export const FOOT: { h: string; links: string[] }[] = [
  { h: "Product", links: ["Agents", "How it works", "Plans", "Log in"] },
  { h: "Company", links: ["About", "Careers", "Contact"] },
  { h: "Legal", links: ["Privacy", "Terms", "Security"] },
];
