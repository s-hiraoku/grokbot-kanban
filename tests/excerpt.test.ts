import { describe, expect, it } from "vitest";
import { excerpt } from "@/lib/view";

describe("excerpt", () => {
	it("drops markdown marks and blank lines so the preview starts with words", () => {
		expect(excerpt("\n\n## 提案\n\n- LaunchAgent の **plist** を削除する\n- 詳細は [issue](https://github.com/x/y/issues/1)")).toBe("提案 LaunchAgent の plist を削除する 詳細は issue");
	});
	it("keeps plain text as it is, and leaves nothing for a body of only code", () => {
		expect(excerpt("Mac 側に残っている設定を整理したい。")).toBe("Mac 側に残っている設定を整理したい。");
		expect(excerpt("```\nnpm test\n```")).toBe("");
	});
});
