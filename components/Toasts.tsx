"use client";

import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { TOAST_LIMIT, TOAST_MS, type ToastMessage } from "@/lib/notify";

/** Shows a toast. The same text again replaces the one showing instead of stacking a copy. */
export function showToast(message: ToastMessage) {
	toast[message.tone](message.text, { id: message.text, duration: TOAST_MS[message.tone] });
}

/** Errors red, warnings amber, everything else in the deck's own colors; each can be closed with ×. */
export default function Toasts() {
	return (
		<Toaster
			position="bottom-center"
			visibleToasts={TOAST_LIMIT}
			closeButton
			toastOptions={{
				classNames: {
					toast: "!items-start !border-l-4 !font-sans !text-[13px] !leading-snug",
					title: "break-words",
					success: "!border-l-teal [&_[data-icon]]:!text-teal",
					info: "!border-l-muted-foreground",
					warning: "!border-[#7a5d1f] !border-l-primary !bg-amber-soft !text-[#ffe7b3] [&_[data-icon]]:!text-primary",
					error: "!border-[#6e3340] !border-l-destructive !bg-danger-soft !text-[#ffd8d1] [&_[data-icon]]:!text-destructive",
					closeButton: "!left-auto !right-0 !top-0 !translate-x-1/3 !-translate-y-1/3 !border-line !bg-popover !text-foreground",
				},
			}}
		/>
	);
}
