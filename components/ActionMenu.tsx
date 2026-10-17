"use client";

import type { ComponentProps, ReactElement, ReactNode } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * Every menu on the board, built on the shadcn/ui dropdown menu. It renders above everything else in a
 * portal, flips when there is no room below, keeps inside the window, and handles focus, arrow keys, and
 * Escape. It is not modal, so the board keeps scrolling while a menu is open.
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
		<DropdownMenu modal={false}>
			<DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
			<DropdownMenuContent
				align={align}
				sideOffset={4}
				collisionPadding={8}
				className={cn("min-w-44 max-w-[min(17.5rem,calc(100vw-1rem))]", className)}
				// A menu inside a card must not start a drag or open the card; React carries portal events up the tree.
				data-no-dnd
				onClick={(event) => event.stopPropagation()}
				onPointerDown={(event) => event.stopPropagation()}
			>
				{children}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export function MenuItem({ danger, current, className, ...props }: ComponentProps<typeof DropdownMenuItem> & { danger?: boolean; current?: boolean }) {
	return <DropdownMenuItem variant={danger ? "destructive" : "default"} className={cn(current && "font-bold", className)} {...props} />;
}

export function MenuTitle({ children }: { children: ReactNode }) {
	return <DropdownMenuLabel className="pt-1 pb-1 text-xs font-semibold text-muted-foreground">{children}</DropdownMenuLabel>;
}

export function MenuSeparator() {
	return <DropdownMenuSeparator />;
}

export function MenuNote({ children }: { children: ReactNode }) {
	return <p className="max-w-60 px-2 pt-1 pb-1.5 text-xs text-muted-foreground">{children}</p>;
}
