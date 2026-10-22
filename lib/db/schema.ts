// Drizzle schema for the app's Postgres (Neon) database.
import { pgTable, uuid, text, integer, boolean, jsonb, timestamp, primaryKey, serial, vector } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  workspaceName: text("workspace_name").notNull().default("My Workspace"),
  notifications: jsonb("notifications").$type<Record<string, boolean>>().notNull().default({}),
  // Stamped into every session token; bumping it (logout, password reset) revokes
  // all of the user's existing sessions.
  sessionVersion: integer("session_version").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Agents CREATED by a user (via the onboarding wizard). The 8 seed agents remain
// static template data; only a user's own additions are persisted here.
export const agents = pgTable(
  "agents",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    id: text("id").notNull(), // app-level agent code, unique per user
    name: text("name").notNull(),
    initials: text("initials").notNull(),
    role: text("role").notNull(),
    color: text("color").notNull(),
    status: text("status").notNull(),
    task: text("task").notNull(),
    score: integer("score").notNull(),
    goal: text("goal").notNull(),
    char: integer("char"),
    type: text("type").notNull().default("custom"),
    capabilities: jsonb("capabilities").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.id] }) })
);

// Teams CREATED by a user (via the New Team modal).
export const teams = pgTable(
  "teams",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    name: text("name").notNull(),
    icon: text("icon").notNull(),
    iconBg: text("icon_bg").notNull(),
    description: text("description").notNull(),
    goal: text("goal").notNull(),
    members: jsonb("members").$type<string[]>().notNull().default([]),
    activity: jsonb("activity").$type<string[]>().notNull().default([]),
    meetings: integer("meetings").notNull().default(0),
    pipeline: text("pipeline").notNull().default("—"),
    leads: integer("leads").notNull().default(0),
    template: text("template").notNull().default("custom"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.id] }) })
);

// Per-user config overrides for any agent (seed or created). Only edited fields
// are stored; they take precedence over the base/seed values on load.
export const agentConfig = pgTable(
  "agent_config",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull(),
    role: text("role"),
    goal: text("goal"),
    permissions: jsonb("permissions").$type<Record<string, boolean>>(),
    settings: jsonb("settings").$type<Record<string, Record<string, unknown>>>(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.agentId] }) })
);

// Per-user membership override for any team (seed or created). When present it
// replaces the team's base member list — lets users add agents to seed teams.
export const teamMembers = pgTable(
  "team_members",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    teamId: text("team_id").notNull(),
    members: jsonb("members").$type<string[]>().notNull().default([]),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.teamId] }) })
);

// Password-reset tokens. A request creates one (1-hour expiry); using it to set
// a new password consumes it. No email infra — the link is surfaced on-screen.
export const passwordResetTokens = pgTable("password_reset_tokens", {
  token: text("token").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Per-user flags on any agent (seed or created): soft-delete and pause.
export const agentStates = pgTable(
  "agent_states",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull(),
    removed: boolean("removed").notNull().default(false),
    paused: boolean("paused").notNull().default(false),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.agentId] }) })
);

// Chat messages between a user and an agent. The serial id preserves order
// within each conversation. Seed opener messages stay static (not stored here).
export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull(),
  who: text("who").notNull(), // 'ai' | 'me'
  text: text("text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Agent execution (Milestone 1: outreach engine) ──────────────────────────

// Real prospects an agent works. `source` is 'manual' now, 'scrape' in milestone 2.
export const leads = pgTable("leads", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull(),
  name: text("name").notNull(),
  title: text("title").notNull().default(""),
  company: text("company").notNull().default(""),
  email: text("email").notNull(),
  status: text("status").notNull().default("new"), // new|contacted|engaged|replied|meeting
  score: integer("score").notNull().default(0),
  source: text("source").notNull().default("manual"),
  review: text("review").notNull().default("accepted"),
  profileUrl: text("profile_url"),
  platform: text("platform"),
  research: jsonb("research").$type<{ summary: string; priorities: string[]; hooks: string[]; angle: string }>(),
  // Set by the qualify stage. Separate from `score`, which assess and outreach also write.
  qualifiedAt: timestamp("qualified_at", { withTimezone: true }),
  // Set when the matchmaker has run on the lead, whether or not anything fit.
  matchedAt: timestamp("matched_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Agent-written outreach emails.
export const outreachDrafts = pgTable("outreach_drafts", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull(),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  rationale: text("rationale").notNull().default(""),
  status: text("status").notNull().default("draft"), // draft|sent
  // Hidden from the top-bar Email-drafts inbox (Discard / Clear sent). Soft-hide
  // only — analytics counts still read every row, so this never rewinds a total.
  dismissed: boolean("dismissed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
});

// Agent-written proposals (products/services bundled for a lead).
export const proposals = pgTable("proposals", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull(),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  body: text("body").notNull(),
  products: jsonb("products").$type<string[]>().notNull().default([]),
  status: text("status").notNull().default("draft"), // draft|sent
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
});

// Meetings booked by a Meeting agent — the only source for the calendar view.
export const meetings = pgTable("meetings", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull(),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("Meeting"),
  whenAt: timestamp("when_at", { withTimezone: true }).notNull(),
  whenLabel: text("when_label").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Matchmaker output: one row per lead↔listing pair the Matchmaker judged a fit.
export const matches = pgTable("matches", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull(),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  score: integer("score").notNull().default(0), // 0..100 fit
  reason: text("reason").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type ProposalRow = typeof proposals.$inferSelect;

// Real event log (feeds notifications + dashboard/analytics in a later milestone).
export const activity = pgTable("activity", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull(),
  type: text("type").notNull(), // lead_added|lead_qualified|email_drafted|email_sent
  leadId: uuid("lead_id"),
  text: text("text").notNull(),
  // Cleared from the Notifications bell only. The dashboard/analytics/calendar
  // read the raw log via listActivity (unfiltered), so clearing never drops a
  // metric or a calendar entry — only listNotifications honors this flag.
  dismissed: boolean("dismissed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Run queue. `kind` is 'outreach' now, 'scrape' in milestone 2.
export const jobs = pgTable("jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull(),
  kind: text("kind").notNull(),
  status: text("status").notNull().default("queued"), // queued|running|done|failed
  params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
  result: jsonb("result").$type<Record<string, unknown>>(),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

// Per-step trace of a scrape run (Milestone 2): one row + one screenshot per
// browser-use action, so the run can be watched/replayed. Written by the worker.
export const jobSteps = pgTable("job_steps", {
  id: uuid("id").defaultRandom().primaryKey(),
  jobId: uuid("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  idx: integer("idx").notNull(),
  caption: text("caption").notNull().default(""),
  url: text("url").notNull().default(""),
  screenshotPath: text("screenshot_path").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Folders group the products catalog (e.g. "Subscriptions", "Services").
export const productFolders = pgTable("product_folders", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type ProductFolderRow = typeof productFolders.$inferSelect;

// Products & Services catalog, embedded for RAG-based retrieval during outreach.
export const products = pgTable("products", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  folderId: uuid("folder_id").references(() => productFolders.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  price: text("price").notNull().default(""),
  category: text("category").notNull().default(""),
  // Vertical-agnostic extra fields (e.g. real-estate: location/features; SaaS:
  // plan/seats). Any non-standard CSV column lands here as key→value.
  attributes: jsonb("attributes").$type<Record<string, string>>().notNull().default({}),
  embedding: vector("embedding", { dimensions: 768 }), // hnsw cosine index lives only in the raw migration (0012) — drizzle doesn't manage vector indexes
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type ProductRow = typeof products.$inferSelect;

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type AgentRow = typeof agents.$inferSelect;
export type TeamRow = typeof teams.$inferSelect;
