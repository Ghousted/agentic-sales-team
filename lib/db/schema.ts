// Drizzle schema for the app's Postgres (Neon) database.
import { pgTable, uuid, text, integer, boolean, jsonb, timestamp, primaryKey, serial } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  workspaceName: text("workspace_name").notNull().default("My Workspace"),
  notifications: jsonb("notifications").$type<Record<string, boolean>>().notNull().default({}),
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
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.agentId] }) })
);

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

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type AgentRow = typeof agents.$inferSelect;
export type TeamRow = typeof teams.$inferSelect;
