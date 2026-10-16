import { createHash } from "node:crypto";
import type { Instant } from "./domain";

export type BotProfile = {
	id: string;
	name: string;
	role: string;
	/** An https image URL, or one short emoji or symbol. Null draws initials. */
	avatar: string | null;
	color: string;
	createdAt: Instant;
	lastSeenAt: Instant | null;
};

export type BotProfilePatch = Partial<Pick<BotProfile, "name" | "role" | "avatar" | "color">>;

export const BOT_COLORS = [
	"#7aa2ff",
	"#3dd68c",
	"#e2b340",
	"#e06c75",
	"#c678dd",
	"#56b6c2",
	"#f0883e",
	"#a3be8c",
] as const;

export function botIdFor(name: string): string {
	const slug = name
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 32);
	// "owner" is the human owner's own id, so a bot named Owner gets another one.
	if (slug === "owner") return "bot-owner";
	if (slug.length >= 2) return slug;
	return `bot-${createHash("sha256").update(name.normalize("NFKC").trim()).digest("hex").slice(0, 8)}`;
}

export function colorFor(name: string): string {
	const digest = createHash("sha256").update(name).digest();
	return BOT_COLORS[(digest[0] ?? 0) % BOT_COLORS.length] ?? BOT_COLORS[0];
}

export function cleanBotName(name: string): string {
	return name.normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, 40);
}
