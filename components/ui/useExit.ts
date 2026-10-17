"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** How long a closing panel plays its exit animation; matches the `-out` keyframes in globals.css. */
export const EXIT_MS = 140;

/**
 * Holds what a panel shows while it is open and for one exit animation after it closes, so the drawer,
 * dialog, and Bots panel slide out instead of vanishing. Opening again during the exit cancels it.
 */
export function useExit<T>() {
	const [value, setValue] = useState<T | null>(null);
	const [closing, setClosing] = useState(false);
	const timer = useRef<number | undefined>(undefined);

	useEffect(() => () => window.clearTimeout(timer.current), []);

	const open = useCallback((next: T) => {
		window.clearTimeout(timer.current);
		setClosing(false);
		setValue(next);
	}, []);

	const close = useCallback(() => {
		window.clearTimeout(timer.current);
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
			setValue(null);
			return;
		}
		setClosing(true);
		timer.current = window.setTimeout(() => {
			setValue(null);
			setClosing(false);
		}, EXIT_MS);
	}, []);

	return { value, closing, open, close };
}
