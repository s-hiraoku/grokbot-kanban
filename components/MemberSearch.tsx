"use client";

import type { ComponentProps, ReactNode } from "react";
import { MemberAvatar } from "@/components/Avatar";
import { CommandInput } from "@/components/ui/command";
import { PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { MemberView } from "@/lib/view";

/**
 * The floating list behind every Bot picker: the assignees list and Run's list of Bots. It draws above the
 * board and the drawer in a portal, flips to fit the window, and scrolls inside when the roster is long.
 */
export function PickerContent({ className, children, ...props }: ComponentProps<typeof PopoverContent>) {
	return (
		<PopoverContent
			sideOffset={6}
			collisionPadding={8}
			className={cn("flex max-h-(--radix-popover-content-available-height) w-[min(300px,calc(100vw-1rem))] flex-col overflow-hidden p-0", className)}
			// A picker on a card must not start a drag or open the card; React carries portal events up the tree.
			data-no-dnd
			onClick={(event) => event.stopPropagation()}
			onPointerDown={(event) => event.stopPropagation()}
			onOpenAutoFocus={(event) => {
				// The search field takes the focus for typing at once, except on a touch screen, where the
				// keyboard would cover the list before anyone asked to search it.
				if (window.matchMedia("(pointer: coarse)").matches) event.preventDefault();
			}}
			{...props}
		>
			{children}
		</PopoverContent>
	);
}

/** The search field at the top of a picker. */
export function PickerSearch({ value, onValueChange, label }: { value: string; onValueChange: (value: string) => void; label: string }) {
	return <CommandInput value={value} onValueChange={onValueChange} placeholder={label} aria-label={label} lang="ja" autoComplete="off" />;
}

/** One person in a picker: face, name, and a Bot's role under it, so a Bot can be told apart by what it does. */
export function MemberRow({ member, size, bold, children }: { member: MemberView & { role?: string }; size: number; bold?: boolean; children?: ReactNode }) {
	return (
		<>
			<MemberAvatar member={member} size={size} />
			<span className="grid min-w-0 flex-1" lang="ja">
				<span className={cn("truncate text-[13px]", bold && "font-bold")}>{member.name}</span>
				{member.role ? <span className="truncate text-xs font-normal text-muted-foreground">{member.role}</span> : null}
			</span>
			{children}
		</>
	);
}

/** Said in place of the list when nobody fits the search. */
export function NoMatch({ query, what }: { query: string; what: string }) {
	return (
		<p className="px-2 py-4 text-center text-xs text-muted-foreground" role="status" lang="ja">
			No {what} matches “{query.trim()}”.
		</p>
	);
}
