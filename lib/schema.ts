import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
	rank: text("rank").notNull(),
	state: jsonb("state").notNull(),
	stateVersion: integer("state_version").notNull(),
});
