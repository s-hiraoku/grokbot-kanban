"use client";

import type { MemberView } from "@/lib/view";

export function MemberAvatar({ member, size = 22, ring = false }: { member: MemberView; size?: number; ring?: boolean }) {
	const isImage = member.avatar?.startsWith("https://") ?? false;
	const glyph = member.avatar && !isImage ? member.avatar : member.initials;
	const className = `avatar ${member.kind}${ring ? " ring" : ""}`;
	const style = {
		width: size,
		height: size,
		fontSize: member.avatar && !isImage ? Math.round(size * 0.62) : Math.max(9, Math.round(size * 0.42)),
		background: isImage ? "transparent" : member.kind === "owner" ? "#3b2f12" : `${member.color}`,
	};
	return (
		<span className={className} style={style} title={member.kind === "bot" ? `${member.name} (bot)` : member.name}>
			{isImage ? <img src={member.avatar ?? ""} alt="" width={size} height={size} referrerPolicy="no-referrer" /> : glyph}
			{member.kind === "bot" && size >= 20 ? <span className="bot-mark" aria-hidden="true" /> : null}
		</span>
	);
}

export function AvatarStack({ members, size = 20, max = 4 }: { members: readonly MemberView[]; size?: number; max?: number }) {
	const shown = members.slice(0, max);
	const extra = members.length - shown.length;
	return (
		<span className="stack">
			{shown.map((member) => (
				<MemberAvatar key={member.id} member={member} size={size} ring />
			))}
			{extra > 0 ? <span className="stack-more">+{extra}</span> : null}
		</span>
	);
}
