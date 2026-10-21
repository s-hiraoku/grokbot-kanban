"use client";

import { ChevronDownIcon, ExternalLinkIcon, PlayIcon, SquareTerminalIcon, XIcon } from "lucide-react";
import { type ReactElement, useState } from "react";
import { Menu, MenuItem, MenuNote } from "@/components/ActionMenu";
import { MemberAvatar } from "@/components/Avatar";
import type { Command } from "@/components/Board";
import { MemberRow, NoMatch, PickerContent, PickerSearch } from "@/components/MemberSearch";
import { Command as CommandRoot, CommandGroup, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { RUNNABLE, runnerOf } from "@/lib/domain";
import { fold, searchMembers } from "@/lib/search";
import { cn } from "@/lib/utils";
import type { CardView, MemberView } from "@/lib/view";

type Size = "card" | "drawer";

const SHAPE: Record<Size, string> = {
	card: "h-6 gap-1 px-2 text-xs [&_svg]:size-3",
	drawer: "h-8 gap-2 px-2.5 text-[13px] [&_svg]:size-3.5",
};
const TEAL = "border-teal-line bg-transparent text-teal-text hover:bg-teal-soft data-[state=open]:bg-teal-soft";
const AMBER = "border-amber-line bg-amber-soft text-primary hover:border-primary data-[state=open]:border-primary";

/**
 * Run on a card, in the board and in the drawer. With a Bot among the assignees, Run starts it straight
 * away and the arrow beside it picks another Bot or a Cursor agent; with none, Run opens that list, which
 * searches the Bots by name or role. While
 * a run is waiting or working, the badge opens a menu to follow or cancel it.
 */
export function RunControl({
	card,
	bots,
	cursorEnabled,
	size,
	send,
}: {
	card: CardView;
	bots: readonly MemberView[];
	cursorEnabled: boolean;
	size: Size;
	send: (command: Command) => Promise<boolean>;
}) {
	const [busy, setBusy] = useState(false);
	// One request at a time, so a double click does not start two runs.
	const act = async (command: Command) => {
		if (busy) return;
		setBusy(true);
		await send(command);
		setBusy(false);
	};
	const pill = cn("inline-flex flex-none items-center rounded-md border font-semibold whitespace-nowrap transition-colors disabled:opacity-60", SHAPE[size]);
	const stop = (
		<MenuItem danger onSelect={() => void act({ type: "stop", cardId: card.id })}>
			<XIcon />
			Cancel run
		</MenuItem>
	);

	if (card.cursor) {
		const cursor = card.cursor;
		const launching = cursor.status === "launching";
		const since = cursor.since === "just now" ? "just now" : `${cursor.since} ago`;
		return (
			<span data-no-dnd>
				<Menu
					align="start"
					trigger={
						<button type="button" className={cn(pill, launching ? AMBER : TEAL)} disabled={busy} aria-label={launching ? "Starting a Cursor agent" : "A Cursor agent is working on this card"}>
							{busy || launching ? <Spinner /> : <span className="size-[7px] animate-pulse-dot rounded-full bg-teal" aria-hidden="true" />}
							<span data-slot="run-status">{launching ? "Starting Cursor" : "Cursor working"}</span>
							{size === "drawer" ? <ChevronDownIcon /> : null}
						</button>
					}
				>
					<MenuNote>
						{launching ? `Handed to Cursor ${since} by ${cursor.by.name}. Waiting for Cursor to confirm.` : `Cursor agent, started ${since} by ${cursor.by.name}. It opens a pull request, and the card moves to In Review.`}
					</MenuNote>
					{cursor.agentUrl ? (
						<MenuItem asChild>
							<a href={cursor.agentUrl} target="_blank" rel="noreferrer" className="no-underline">
								<ExternalLinkIcon />
								Open in Cursor
							</a>
						</MenuItem>
					) : null}
					{stop}
				</Menu>
			</span>
		);
	}

	const run = card.run;
	if (run) {
		return (
			<span data-no-dnd>
				<Menu
					align="start"
					trigger={
						<button
							type="button"
							className={cn(pill, "pl-1", run.status === "working" ? TEAL : AMBER)}
							disabled={busy}
							aria-label={run.status === "working" ? `${run.bot.name} is running this card` : `Waiting for ${run.bot.name}`}
							title={`${run.status === "working" ? `${run.bot.name} working` : `Waiting for ${run.bot.name}`}, ${run.since === "just now" ? "just now" : `${run.since} ago`}`}
						>
							{busy ? <Spinner /> : run.status === "working" ? <span className="size-[7px] animate-pulse-dot rounded-full bg-teal" aria-hidden="true" /> : null}
							<MemberAvatar member={run.bot} size={size === "card" ? 14 : 18} />
							<span data-slot="run-status" lang="ja">
								{run.status === "working" ? "Running" : "Run requested"}
							</span>
							{size === "drawer" ? <ChevronDownIcon /> : null}
						</button>
					}
				>
					<MenuNote>
						{run.status === "working"
							? `${run.bot.name} is on it.`
							: run.passedOn
								? `${run.passedOn.by.name} passed it on to ${run.bot.name} ${run.passedOn.since === "just now" ? "just now" : `${run.passedOn.since} ago`}. Waiting for ${run.bot.name} to start.`
								: `${run.bot.name} has not picked it up yet.`}
					</MenuNote>
					{stop}
				</Menu>
			</span>
		);
	}

	if (!RUNNABLE.includes(card.column)) return null;
	const verb = card.column === "inProgress" ? "Re-run" : "Run";
	const runner = runnerOf(
		card.assignees.map((member) => member.id),
		bots,
	);
	const play = busy ? <Spinner /> : <PlayIcon className="fill-current" />;
	const picker = (trigger: ReactElement) => (
		<RunPicker
			trigger={trigger}
			verb={verb}
			bots={bots}
			runner={runner}
			size={size}
			cursor={{ enabled: cursorEnabled, repo: Boolean(card.repo), repoLabel: card.repoLabel }}
			onRun={(bot) => void act({ type: "run", cardId: card.id, bot })}
			onCursor={() => void act({ type: "cursor", cardId: card.id })}
		/>
	);

	if (runner) {
		// A split button: Run goes straight to the assigned Bot; the arrow picks someone else.
		return (
			<span className={cn("inline-flex flex-none rounded-md border", TEAL.split(" ")[0])} data-no-dnd>
				<button
					type="button"
					className={cn(pill, TEAL, "rounded-r-none border-0 pr-2")}
					title={`${verb} with ${runner.name}`}
					disabled={busy}
					onClick={() => void act({ type: "run", cardId: card.id, bot: runner.id })}
				>
					{play}
					{verb}
				</button>
				{picker(
					<button type="button" className={cn(pill, TEAL, "rounded-l-none border-0 border-l border-l-teal-line px-1.5")} disabled={busy} aria-label={`${verb} with another Bot or Cursor`}>
						<ChevronDownIcon />
					</button>,
				)}
			</span>
		);
	}
	return (
		<span data-no-dnd>
			{picker(
				<button type="button" className={cn(pill, TEAL)} disabled={busy} aria-label={`${verb} with a Grok Bot or Cursor`} title={`${verb} with a Grok Bot or Cursor`}>
					{play}
					{verb}
					<ChevronDownIcon />
				</button>,
			)}
		</span>
	);
}

/**
 * Run's list: the Bots, searchable by name or role, then a Cursor agent. Enter runs the best match. While
 * a search is typed, Cursor stays out of the list unless the search names it, so Enter on a name that
 * fits no Bot does nothing rather than handing the card to Cursor.
 */
function RunPicker({
	trigger,
	verb,
	bots,
	runner,
	size,
	cursor,
	onRun,
	onCursor,
}: {
	trigger: ReactElement;
	verb: string;
	bots: readonly MemberView[];
	runner: MemberView | null;
	size: Size;
	cursor: { enabled: boolean; repo: boolean; repoLabel: string | null };
	onRun: (bot: string) => void;
	onCursor: () => void;
}) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const searching = Boolean(query.trim());
	const shown = searchMembers(bots, query);
	const showCursor = !searching || fold(query).split(" ").every((word) => ["cursor", "agent"].some((part) => part.startsWith(word)));
	const pick = (run: () => void) => {
		setOpen(false);
		setQuery("");
		run();
	};

	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) setQuery("");
			}}
		>
			<PopoverTrigger asChild>{trigger}</PopoverTrigger>
			<PickerContent align="start" data-slot="run-picker">
				<CommandRoot shouldFilter={false} className="min-h-0 flex-1">
					{bots.length ? <PickerSearch value={query} onValueChange={setQuery} label="Search bots" /> : null}
					<CommandList className="max-h-80">
						<CommandGroup heading={`${verb} with`}>
							{bots.length === 0 ? <MenuNote>No bots yet. Connect one under Bots & MCP.</MenuNote> : shown.length === 0 ? <NoMatch query={query} what="bot" /> : null}
							{shown.map((bot) => (
								<CommandItem key={bot.id} value={bot.id} onSelect={() => pick(() => onRun(bot.id))}>
									<MemberRow member={bot} size={size === "card" ? 18 : 20}>
										{bot.id === runner?.id ? <span className="text-xs text-muted-foreground">assigned</span> : null}
									</MemberRow>
								</CommandItem>
							))}
						</CommandGroup>
						{showCursor ? (
							<>
								<CommandSeparator />
								<CommandGroup heading="Write code">
									<CommandItem value="__cursor" disabled={!cursor.enabled || !cursor.repo} onSelect={() => pick(onCursor)}>
										<SquareTerminalIcon />
										<span className="grid">
											<span>Cursor agent</span>
											<span className="text-xs font-normal text-muted-foreground">{cursor.repoLabel ? `Opens a pull request on ${cursor.repoLabel}` : "Opens a pull request"}</span>
										</span>
									</CommandItem>
									{!cursor.enabled ? (
										<MenuNote>Add CURSOR_API_KEY to the deployment to turn this on.</MenuNote>
									) : !cursor.repo ? (
										<MenuNote>Set the card&apos;s repo under More fields first.</MenuNote>
									) : null}
								</CommandGroup>
							</>
						) : null}
					</CommandList>
				</CommandRoot>
			</PickerContent>
		</Popover>
	);
}
