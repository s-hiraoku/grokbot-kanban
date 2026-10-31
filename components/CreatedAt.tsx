"use client";

import { useSyncExternalStore } from "react";
import { ageLabel } from "@/lib/view";

const exact = new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

const DATED_AFTER_MS = 48 * 60 * 60 * 1000;
const TICK_MS = 60_000;

const listeners = new Set<() => void>();
let clientNow = 0;
let timer = 0;

function emit() {
	clientNow = Date.now();
	for (const listener of listeners) listener();
}

function subscribe(onChange: () => void) {
	listeners.add(onChange);
	if (listeners.size === 1) {
		clientNow = Date.now();
		timer = window.setInterval(emit, TICK_MS);
	}
	return () => {
		listeners.delete(onChange);
		if (listeners.size === 0) {
			window.clearInterval(timer);
			clientNow = 0;
		}
	};
}

function clientSnapshot(): number {
	if (clientNow === 0) clientNow = Date.now();
	return clientNow;
}

export function useTickingNow(): number | null {
	return useSyncExternalStore(subscribe, clientSnapshot, () => null);
}

/** The exact time in the viewer's time zone, for the hover text: 2026/10/12 14:03. */
export function exactTime(iso: string): string {
	return exact.format(new Date(iso));
}

/** 10/12 this year, 2025/10/12 before it, in the viewer's time zone. */
export function shortDate(iso: string, now = new Date()): string {
	const date = new Date(iso);
	const day = `${date.getMonth() + 1}/${date.getDate()}`;
	return date.getFullYear() === now.getFullYear() ? day : `${date.getFullYear()}/${day}`;
}

/**
 * When a card was filed: how long ago while it is under 48 hours old (12m, 30h), then its date (10/12).
 * Hovering shows the exact time. Both need the viewer's clock and time zone, which the server cannot know,
 * so the server's render shows the age and the browser fills in the rest once it has hydrated.
 */
export function CreatedAt({ iso, age, phrase = false }: { iso: string; age: string; phrase?: boolean }) {
	const now = useTickingNow();
	const live = now === null ? age : ageLabel(Date.parse(iso), now);
	const dated = now !== null && now - Date.parse(iso) >= DATED_AFTER_MS;
	const label = dated ? shortDate(iso, new Date(now)) : phrase && live !== "just now" ? `${live} ago` : live;
	return (
		<time dateTime={iso} title={now === null ? undefined : exactTime(iso)} className="whitespace-nowrap">
			{label}
		</time>
	);
}
