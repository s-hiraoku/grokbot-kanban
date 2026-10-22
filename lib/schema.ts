import { bigint, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const cards = pgTable("cards", {
	id: uuid("id").primaryKey(),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
	externalId: text("external_id"),
	title: text("title").notNull(),
	body: text("body").notNull(),
	notes: text("notes").notNull(),
	repo: jsonb("repo"),
	source: text("source"),
	originalLink: text("original_link"),
	priority: text("priority").notNull(),
	kind: jsonb("kind").notNull(),
	screening: jsonb("screening"),
	assignees: jsonb("assignees").notNull(),
	createdBy: text("created_by"),
	rank: text("rank").notNull(),
	state: jsonb("state").notNull(),
	stateVersion: integer("state_version").notNull(),
});

export const bots = pgTable("bots", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	role: text("role").notNull(),
	avatar: text("avatar"),
	color: text("color").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
	lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
});

export const users = pgTable("users", {
	id: uuid("id").primaryKey(),
	githubId: bigint("github_id", { mode: "number" }).notNull(),
	login: text("login").notNull(),
	name: text("name"),
	avatarUrl: text("avatar_url"),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
	lastSignInAt: timestamp("last_sign_in_at", { withTimezone: true }).notNull(),
});

export const sessions = pgTable("sessions", {
	tokenHash: text("token_hash").primaryKey(),
	userId: uuid("user_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
