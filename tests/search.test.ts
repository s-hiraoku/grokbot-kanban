import { describe, expect, it } from "vitest";
import { fold, searchMembers } from "@/lib/search";
import type { MemberView } from "@/lib/view";

const bot = (name: string, role = ""): MemberView & { role: string } => ({ id: name.toLowerCase(), name, kind: "bot", avatar: null, color: "#000", initials: name.slice(0, 2), role });
const roster = [bot("Scout", "情報収集"), bot("Ops", "インフラ運用"), bot("Code Reviewer", "PR をレビューする"), bot("Postman", "通知"), bot("レビュー係", "コード確認")];
const names = (query: string) => searchMembers(roster, query).map((member) => member.name);

describe("searchMembers", () => {
	it("lists everyone, in roster order, when nothing is typed", () => {
		expect(names("")).toEqual(roster.map((member) => member.name));
		expect(names("   ")).toEqual(roster.map((member) => member.name));
	});
	it("matches parts of a name, not letters scattered through it", () => {
		expect(names("ops")).toEqual(["Ops"]);
		expect(names("st")).toEqual(["Postman"]);
		// S-c-o-u-T has c and t in order, which a fuzzy match would offer; nobody has "ct" in their name.
		expect(names("ct")).toEqual([]);
		expect(names("xyz")).toEqual([]);
	});
	it("ranks a name that starts with the query above one that only contains it", () => {
		expect(names("o")).toEqual(["Ops", "Scout", "Code Reviewer", "Postman"]);
		expect(names("rev")).toEqual(["Code Reviewer"]);
	});
	it("finds a Bot by its role, below Bots whose name matches", () => {
		expect(names("インフラ")).toEqual(["Ops"]);
		expect(names("レビュー")).toEqual(["レビュー係", "Code Reviewer"]);
	});
	it("needs every word, wherever each one is", () => {
		expect(names("code pr")).toEqual(["Code Reviewer"]);
		expect(names("code 通知")).toEqual([]);
	});
	it("ignores case, full-width letters, and hiragana against katakana", () => {
		expect(names("ＯＰＳ")).toEqual(["Ops"]);
		expect(names("れびゅー")).toEqual(["レビュー係", "Code Reviewer"]);
		expect(fold("  Ｃｏｄｅ　レビュー ")).toBe("code れびゅー");
	});
});
