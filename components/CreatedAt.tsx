"use client";

import { useSyncExternalStore } from "react";

const exact = new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

const DATED_AFTER_MS = 48 * 60 * 60 * 1000;

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
	const inBrowser = useSyncExternalStore(
		noSubscribe,
		() => true,
		() => false,
	);
	const dated = inBrowser && Date.now() - Date.parse(iso) >= DATED_AFTER_MS;
	const label = dated ? shortDate(iso) : phrase && age !== "just now" ? `${age} ago` : age;
	return (
		<time dateTime={iso} title={inBrowser ? exactTime(iso) : undefined} className="whitespace-nowrap">
			{label}
		</time>
	);
}

const noSubscribe = () => () => {};
