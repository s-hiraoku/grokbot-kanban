"use client";

import { CheckIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { MemberAvatar } from "@/components/Avatar";
import { MemberRow, NoMatch, PickerContent, PickerSearch } from "@/components/MemberSearch";
import { Button } from "@/components/ui/button";
import { Command, CommandGroup, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { searchMembers } from "@/lib/search";
import { cn } from "@/lib/utils";
import type { MemberView } from "@/lib/view";

/**
 * GitHub-style assignees: the field lists only who holds the card, and Edit opens a list, searchable by
 * name or role, where each pick toggles one member. The list floats above the drawer, flips to fit the window, and stays
 * open so several can be picked in a row.
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
	const chosen = selected.map((id) => members.find((member) => member.id === id)).filter((member): member is MemberView => Boolean(member));
	// Selected members first, in assignment order, then everyone else in roster order, as GitHub does.
	const options = useMemo(
		() => [...members.filter((member) => selected.includes(member.id)), ...members.filter((member) => !selected.includes(member.id))],
		// The order is fixed when the list opens, so a pick does not move rows under the pointer.
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[members, open],
	);
	const shown = searchMembers(options, query);
	const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);

	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) setQuery("");
			}}
		>
			<div className="grid gap-1.5">
				<div className="flex items-center justify-between">
					<p className="text-xs font-bold text-muted-foreground" id="assignees-label">
						Assignees
					</p>
					<PopoverTrigger asChild>
						<Button type="button" variant="ghost" size="xs" className="data-[state=open]:text-primary">
							{open ? "Done" : "Edit"}
						</Button>
					</PopoverTrigger>
				</div>

				{chosen.length ? (
					<ul className="grid gap-1.5" aria-labelledby="assignees-label" data-slot="assignees">
						{chosen.map((member) => (
							<li key={member.id} className="flex min-w-0 items-center gap-2 text-[13px]">
								<MemberAvatar member={member} size={22} />
								<span className="truncate" lang="ja">
									{member.name}
								</span>
							</li>
						))}
					</ul>
				) : (
					<p className="text-[13px] text-muted-foreground" data-slot="assignees">
						No one.{" "}
						{members.some((member) => member.kind === "owner") ? (
							<button type="button" className="text-primary underline underline-offset-3" onClick={() => onChange(["owner"])}>
								Assign yourself
							</button>
						) : null}
					</p>
				)}
			</div>

			<PickerContent align="end" data-slot="assignee-menu">
				<p className="border-b px-3 py-2 text-xs font-bold">Assign members</p>
				<Command shouldFilter={false} className="min-h-0 flex-1">
					<PickerSearch value={query} onValueChange={setQuery} label="Search members" />
					<CommandList className="max-h-80">
						{shown.length ? (
							<CommandGroup>
								{shown.map((member) => {
									const on = selected.includes(member.id);
									return (
										<CommandItem key={member.id} value={member.id} onSelect={() => toggle(member.id)} data-checked={on}>
											<CheckIcon className={cn("text-primary", on ? "opacity-100" : "opacity-0")} aria-hidden="true" />
											<MemberRow member={member} size={22} bold={on}>
												{member.kind === "owner" ? <span className="text-xs text-muted-foreground">owner</span> : null}
											</MemberRow>
										</CommandItem>
									);
								})}
							</CommandGroup>
						) : (
							<NoMatch query={query} what="member" />
						)}
						{selected.length && !query.trim() ? (
							<>
								<CommandSeparator />
								<CommandGroup>
									<CommandItem value="__clear" onSelect={() => onChange([])} className="text-xs text-muted-foreground">
										Clear assignees
									</CommandItem>
								</CommandGroup>
							</>
						) : null}
					</CommandList>
				</Command>
			</PickerContent>
		</Popover>
	);
}
