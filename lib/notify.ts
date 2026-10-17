export type ToastTone = "success" | "info" | "warning" | "error";
export type ToastMessage = { text: string; tone: ToastTone };

/** How long a toast stays up. Problems stay longer so they can be read. */
export const TOAST_MS: Record<ToastTone, number> = { success: 3500, info: 4500, warning: 6500, error: 8000 };

/** At most this many toasts show at once; the oldest goes first. */
export const TOAST_LIMIT = 3;

/** The toast for an owner command's response. Every failure gets one, even when the server sent no text. */
export function commandToast(status: number, payload: { notice?: string | null }): ToastMessage | null {
	const notice = payload.notice?.trim() || null;
	if (status >= 200 && status < 300) {
		if (!notice) return null;
		return { text: notice, tone: "success" };
	}
	return { text: notice ?? fallbackFor(status), tone: "error" };
}

function fallbackFor(status: number): string {
	if (status === 400) return "The board could not accept that. Check the fields and try again.";
	if (status === 403) return "This request came from another site, so it was blocked. Reload the board.";
	if (status === 404) return "That card or bot no longer exists. The board was refreshed.";
	if (status === 503) return "The board is busy. Try again.";
	return `Something went wrong on the board (${status}). Try again.`;
}

export const OFFLINE_TOAST: ToastMessage = { text: "Lost connection to the board. Retrying in the background.", tone: "warning" };
export const ONLINE_TOAST: ToastMessage = { text: "Connected again. The board is up to date.", tone: "info" };
export const UNREACHABLE_TOAST: ToastMessage = { text: "Could not reach the board. Check your connection and try again.", tone: "error" };
