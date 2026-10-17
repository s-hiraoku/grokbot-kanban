"use client";

import { cn } from "@/lib/utils";
import type { MemberView } from "@/lib/view";

export function MemberAvatar({ member, size = 22, ring = false, className }: { member: MemberView; size?: number; ring?: boolean; className?: string }) {
	const isImage = member.avatar ? /^(https:\/\/|\/api\/avatar\/|data:image\/)/.test(member.avatar) : false;
	const glyph = member.avatar && !isImage ? member.avatar : member.initials;
	const style = {
		width: size,
		height: size,
		fontSize: member.kind === "owner" && !isImage ? 9 : member.avatar && !isImage ? Math.round(size * 0.62) : Math.max(9, Math.round(size * 0.42)),
		background: isImage ? "transparent" : member.kind === "owner" ? "var(--amber-soft)" : member.color,
	};
	return (
		<span
			className={cn(
				"relative inline-grid flex-none place-items-center rounded-full leading-none font-bold text-avatar-text select-none",
				member.kind === "owner" && !isImage && "border-[1.5px] border-primary tracking-tight text-primary",
				ring && "shadow-[0_0_0_2px_var(--surface)]",
				className,
			)}
			style={style}
			title={member.kind === "bot" ? `${member.name} (bot)` : member.name}
		>
			{isImage ? <img src={member.avatar ?? ""} alt="" width={size} height={size} className="size-full rounded-full object-cover" referrerPolicy="no-referrer" /> : glyph}
			{member.kind === "bot" && size >= 20 && !ring ? (
				<span aria-hidden="true" className="absolute -right-0.5 -bottom-0.5 size-[34%] min-h-[7px] min-w-[7px] rounded-full border-2 border-(--surface) bg-teal" />
			) : null}
		</span>
	);
}

export function UnknownAvatar({ size = 18 }: { size?: number }) {
	return (
		<span className="inline-grid flex-none place-items-center rounded-full bg-secondary text-[10px] text-muted-foreground" style={{ width: size, height: size }}>
			?
		</span>
	);
}

export function AvatarStack({ members, size = 20, max = 4 }: { members: readonly MemberView[]; size?: number; max?: number }) {
	const shown = members.slice(0, max);
	const extra = members.length - shown.length;
	return (
		<span className="inline-flex items-center">
			{shown.map((member, index) => (
				<MemberAvatar key={member.id} member={member} size={size} ring className={index > 0 ? "-ml-[7px]" : undefined} />
			))}
			{extra > 0 ? <span className="ml-1 text-[11px] text-muted-foreground">+{extra}</span> : null}
		</span>
	);
}
