"use client";

import { useEffect } from "react";
import { TOAST_MS, type ToastMessage } from "@/lib/notify";

export type ShownToast = ToastMessage & { id: number };

const ICON: Record<ShownToast["tone"], string> = { success: "✓", info: "i", warning: "!", error: "×" };
const LABEL: Record<ShownToast["tone"], string> = { success: "Done", info: "Note", warning: "Warning", error: "Error" };

export default function Toasts({ toasts, onDismiss }: { toasts: readonly ShownToast[]; onDismiss: (id: number) => void }) {
	return (
		<div className="toasts" aria-live="polite">
			{toasts.map((toast) => (
				<ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
			))}
		</div>
	);
}

function ToastItem({ toast, onDismiss }: { toast: ShownToast; onDismiss: (id: number) => void }) {
	useEffect(() => {
		const timer = window.setTimeout(() => onDismiss(toast.id), TOAST_MS[toast.tone]);
		return () => window.clearTimeout(timer);
	}, [toast.id, toast.tone, onDismiss]);
	const urgent = toast.tone === "error" || toast.tone === "warning";
	return (
		<div className={`toast ${toast.tone}`} role={urgent ? "alert" : "status"}>
			<span className="toast-icon" aria-hidden="true">
				{ICON[toast.tone]}
			</span>
			<span className="visually-hidden">{LABEL[toast.tone]}: </span>
			<span className="toast-text" lang="ja">
				{toast.text}
			</span>
			<button type="button" className="toast-close" aria-label="Dismiss" onClick={() => onDismiss(toast.id)}>
				×
			</button>
		</div>
	);
}
