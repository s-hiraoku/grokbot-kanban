"use client";

import { useSyncExternalStore } from "react";
import { THEME_KEY, type ThemeChoice } from "@/lib/theme-script";

export type { ThemeChoice };
const DARK = "(prefers-color-scheme: dark)";

function read(): ThemeChoice {
	try {
		const saved = localStorage.getItem(THEME_KEY);
		return saved === "light" || saved === "dark" ? saved : "system";
	} catch {
		return "system";
	}
}

const listeners = new Set<() => void>();

export function setTheme(choice: ThemeChoice) {
	try {
		if (choice === "system") localStorage.removeItem(THEME_KEY);
		else localStorage.setItem(THEME_KEY, choice);
	} catch {
		// Private windows can refuse storage; the choice still applies until the page reloads.
	}
	const dark = choice === "dark" || (choice === "system" && matchMedia(DARK).matches);
	document.documentElement.classList.toggle("dark", dark);
	document.documentElement.style.colorScheme = dark ? "dark" : "light";
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	const media = matchMedia(DARK);
	// Another tab changed the choice, or the OS switched while on System.
	const onStorage = (event: StorageEvent) => {
		if (event.key === THEME_KEY) setTheme(read());
	};
	media.addEventListener("change", listener);
	window.addEventListener("storage", onStorage);
	return () => {
		listeners.delete(listener);
		media.removeEventListener("change", listener);
		window.removeEventListener("storage", onStorage);
	};
}

/** The saved choice, and whether the board is dark right now. On the server, before hydration, it is System. */
export function useTheme(): { choice: ThemeChoice; dark: boolean } {
	const choice = useSyncExternalStore(subscribe, read, () => "system" as const);
	const dark = useSyncExternalStore(
		subscribe,
		() => document.documentElement.classList.contains("dark"),
		() => true,
	);
	return { choice, dark };
}
