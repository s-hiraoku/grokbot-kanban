"use client";

import * as Popover from "@radix-ui/react-popover";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { MemberAvatar } from "@/components/Avatar";
import type { MemberView } from "@/lib/view";

/**
 * GitHub-style assignees: the field lists only who holds the card, and Edit opens a searchable list
 * where each click toggles one member. The list is a Radix popover, so it floats above the drawer, flips
 * to fit the window, and stays open so several can be picked in a row.
 */
export default function AssigneePicker({
	members,
	selected,
	onChange,
}: {
	members: readonly MemberView[];
	selected: readonly string[];
	onChange: (next: string[]) => void;
}) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [cursor, setCursor] = useState(0);
	const box = useRef<HTMLDivElement>(null);
	const search = useRef<HTMLInputElement>(null);
	const listId = useId();

	const chosen = selected.map((id) => members.find((member) => member.id === id)).filter((member): member is MemberView => Boolean(member));
	// Selected members first, in assignment order, then everyone else in roster order, as GitHub does.
	const options = useMemo(() => {
		const needle = query.trim().toLowerCase();
		const matches = members.filter((member) => !needle || member.name.toLowerCase().includes(needle));
		return [...matches.filter((member) => selected.includes(member.id)), ...matches.filter((member) => !selected.includes(member.id))];
		// The order is fixed when the menu opens or the query changes, so a toggle does not move rows under the pointer.
	}, [members, query, open]);

	useEffect(() => setCursor(0), [query]);

	const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
	const openChange = (next: boolean) => {
		if (next) {
			setQuery("");
			setCursor(0);
		}
		setOpen(next);
	};

	return (
		<Popover.Root open={open} onOpenChange={openChange}>
			<div className="assignees" ref={box}>
				<div className="assignees-head">
					<span className="assignees-label" id={`${listId}-label`}>
						Assignees
					</span>
					<Popover.Trigger asChild>
						<button type="button" className="ghost small assignees-edit" aria-haspopup="listbox">
							{open ? "Done" : "Edit"}
						</button>
					</Popover.Trigger>
				</div>

				{chosen.length ? (
					<ul className="assignees-list" aria-labelledby={`${listId}-label`}>
						{chosen.map((member) => (
							<li key={member.id}>
								<MemberAvatar member={member} size={22} />
								<span lang="ja">{member.name}</span>
							</li>
						))}
					</ul>
				) : (
					<p className="assignees-none">
						No one.{" "}
						{members.some((member) => member.kind === "owner") ? (
							<button type="button" className="link" onClick={() => onChange(["owner"])}>
								Assign yourself
							</button>
						) : null}
					</p>
				)}

				<Popover.Portal>
					<Popover.Content
						className="assignees-menu"
						align="end"
						side="bottom"
						sideOffset={6}
						collisionPadding={8}
						onOpenAutoFocus={(event) => {
							event.preventDefault();
							search.current?.focus();
						}}
					>
						<p className="assignees-menu-title">Assign members</p>
						<input
							ref={search}
							type="search"
							className="assignees-search"
							placeholder="Filter members"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							aria-label="Filter members"
							aria-controls={listId}
							aria-activedescendant={options[cursor] ? `${listId}-${options[cursor].id}` : undefined}
							lang="ja"
							onKeyDown={(event) => {
								if (event.key === "ArrowDown") {
									event.preventDefault();
									setCursor((value) => Math.min(value + 1, options.length - 1));
								} else if (event.key === "ArrowUp") {
									event.preventDefault();
									setCursor((value) => Math.max(value - 1, 0));
								} else if (event.key === "Enter") {
									// Enter picks the highlighted member instead of saving the whole form.
									event.preventDefault();
									const member = options[cursor];
									if (member) toggle(member.id);
								}
							}}
						/>
						<ul className="assignees-options" role="listbox" id={listId} aria-multiselectable="true" aria-label="Members">
							{options.map((member, index) => {
								const on = selected.includes(member.id);
								return (
									<li
										key={member.id}
										id={`${listId}-${member.id}`}
										role="option"
										aria-selected={on}
										className={`${on ? "on" : ""}${index === cursor ? " cursor" : ""}`}
										onPointerEnter={() => setCursor(index)}
										// Keep focus in the filter, so typing and Escape still reach the menu after a click.
										onMouseDown={(event) => event.preventDefault()}
										onClick={() => toggle(member.id)}
									>
										<span className="check" aria-hidden="true">
											{on ? "✓" : ""}
										</span>
										<MemberAvatar member={member} size={22} />
										<span className="name" lang="ja">
											{member.name}
										</span>
										{member.kind === "owner" ? <span className="muted small">owner</span> : null}
									</li>
								);
							})}
							{options.length === 0 ? <li className="assignees-empty">No member matches “{query}”.</li> : null}
						</ul>
						{selected.length ? (
							<button type="button" className="assignees-clear" onClick={() => onChange([])}>
								Clear assignees
							</button>
						) : null}
					</Popover.Content>
				</Popover.Portal>
			</div>
		</Popover.Root>
	);
}
