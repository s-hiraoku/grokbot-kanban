import type { MemberView } from "@/lib/view";

/**
 * Folds the differences a person does not mean when typing a name: case, full-width letters, and katakana
 * against hiragana, so 「ｏｐｓ」 finds Ops and 「れびゅー」 finds レビュー.
 */
export function fold(text: string): string {
	return text
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[ァ-ヶ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60))
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * How well a member fits what was typed: 0 is no match. A name that starts with it ranks first, then a name
 * with a word that starts with it, then one that has it anywhere, then a member whose role or id has it.
 * Every space-separated word must be found, in any of those places.
 */
export function memberScore(member: MemberView & { role?: string }, query: string): number {
	const words = fold(query).split(" ").filter(Boolean);
	if (!words.length) return 1;
	const name = fold(member.name);
	const other = fold(`${member.role ?? ""} ${member.id}`);
	let score = 0;
	for (const word of words) {
		const best = name.startsWith(word) ? 4 : name.split(/[\s\-_./]+/).some((part) => part.startsWith(word)) ? 3 : name.includes(word) ? 2 : other.includes(word) ? 1 : 0;
		if (!best) return 0;
		score += best;
	}
	return score / words.length;
}

/** The members that fit the query, best first, keeping their given order among equals. */
export function searchMembers<T extends MemberView & { role?: string }>(members: readonly T[], query: string): T[] {
	return members
		.map((member, index) => ({ member, index, score: memberScore(member, query) }))
		.filter((item) => item.score > 0)
		.sort((a, b) => b.score - a.score || a.index - b.index)
		.map((item) => item.member);
}
