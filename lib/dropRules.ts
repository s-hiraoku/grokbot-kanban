import type { Column } from "./domain";
import type { CardView } from "./view";

type DropCard = Pick<CardView, "column" | "moveTargets" | "action" | "repo" | "pill">;

/** Columns a dragged card may land in. A running card can only be reordered where it is. */
export function dropTargets(card: DropCard): Set<Column> {
	const targets = new Set<Column>(card.moveTargets);
	targets.add(card.column);
	// A queued card stays queued: In Progress would only be reached by the agent taking a slot.
	if (card.pill?.label === "queued") targets.delete("inProgress");
	return targets;
}

/** Whether dropping on this column starts a Cursor agent, as the Run button does. */
export function dropRuns(card: DropCard, column: Column): boolean {
	return (column === "todo" || column === "inProgress") && column !== card.column && card.action.command === "run" && card.action.enabled && card.repo !== null;
}

/** The line shown under a column header while a card is dragged over the board. */
export function dropHint(card: DropCard | null, column: Column): string | null {
	if (!card || column === card.column) return null;
	if (!dropTargets(card).has(column)) return card.pill?.label === "queued" ? "Waiting for a slot" : "Stop the agent first";
	if (dropRuns(card, column)) return "Drop to run the agent";
	if (column === "todo" || column === "inProgress") return "Drop to move, no agent";
	return null;
}

/** Why a drop was refused, for the toast. */
export function dropRefusal(card: DropCard, column: Column): string {
	if (card.moveTargets.length === 0) return "Stop the agent before moving this card.";
	if (card.pill?.label === "queued" && column === "inProgress") return "This card is already waiting for an agent slot.";
	return "That column does not take this card.";
}

/** Why a card action cannot be taken right now, or null when it can. Every refused click shows this in a toast. */
export function actionBlocked(card: DropCard, action: "run" | "stop" | "delete" | "move"): string | null {
	if (action === "delete") return card.pill ? "Stop the agent before deleting this card." : null;
	if (action === "move") return card.moveTargets.length === 0 ? "Stop the agent before moving this card." : null;
	if (card.action.enabled) return null;
	return "The agent is starting or stopping. Try again in a moment.";
}
