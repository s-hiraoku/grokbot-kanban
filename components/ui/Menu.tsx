"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { ReactElement, ReactNode } from "react";

/**
 * Every menu on the board. Radix renders the list in a portal above everything else, flips it when there
 * is no room below, keeps it inside the window, and handles focus, arrow keys, and Escape.
 */
export function Menu({
	trigger,
	align = "end",
	className,
	children,
}: {
	/** The button that opens the menu. */
	trigger: ReactElement;
	align?: "start" | "end";
	className?: string;
	children: ReactNode;
}) {
	return (
		<DropdownMenu.Root modal={false}>
			<DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
			<DropdownMenu.Portal>
				<DropdownMenu.Content
					className={`menu${className ? ` ${className}` : ""}`}
					align={align}
					sideOffset={4}
					collisionPadding={8}
					// A menu inside a card must not start a drag or open the card.
					data-no-dnd
					onClick={(event) => event.stopPropagation()}
				>
					{children}
				</DropdownMenu.Content>
			</DropdownMenu.Portal>
		</DropdownMenu.Root>
	);
}

export function MenuItem({
	onSelect,
	danger,
	current,
	children,
}: {
	onSelect: () => void;
	danger?: boolean;
	current?: boolean;
	children: ReactNode;
}) {
	return (
		<DropdownMenu.Item asChild onSelect={onSelect}>
			<button type="button" className={[danger ? "danger-item" : "", current ? "current" : ""].filter(Boolean).join(" ") || undefined}>
				{children}
			</button>
		</DropdownMenu.Item>
	);
}

export function MenuTitle({ children }: { children: ReactNode }) {
	return <DropdownMenu.Label className="menu-title">{children}</DropdownMenu.Label>;
}

export function MenuNote({ children }: { children: ReactNode }) {
	return <p className="menu-note">{children}</p>;
}

const claimed = new WeakSet<KeyboardEvent>();

// Radix closes a popup on Escape in its own capture listener and marks the key as handled even for a popup
// that is only fading out. This listener is added first, so it sees which popup was open when the key came.
if (typeof document !== "undefined") {
	document.addEventListener(
		"keydown",
		(event) => {
			if (event.key === "Escape" && document.querySelector('[data-radix-popper-content-wrapper] > [data-state="open"]')) claimed.add(event);
		},
		true,
	);
}

/** True when this Escape closed an open menu or popover, so the drawer around it should stay open. */
export function escapeClaimed(event: KeyboardEvent): boolean {
	return claimed.has(event);
}
