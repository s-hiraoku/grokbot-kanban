/** Neon scale-to-zero suspends after 5 idle minutes, so a shorter gap keeps the compute up the whole time the tab is visible. */
export const IDLE_POLL_MS = 10 * 60 * 1000;

/** A Cursor run is the only case that needs a fresh board within a minute. The compute stays up for that run. */
export const ACTIVE_POLL_MS = 60 * 1000;

export function pollWait(visible: boolean, cursorRunning: boolean): number | null {
	if (!visible) return null;
	return cursorRunning ? ACTIVE_POLL_MS : IDLE_POLL_MS;
}
