"use client";

import { useEffect, useState } from "react";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export type ConfirmRequest = {
	title: string;
	description: string;
	/** The confirm button's label, such as "Delete card". */
	action: string;
	/** Destructive actions get a red confirm button. */
	danger?: boolean;
	/** Runs the action; the dialog stays open, with a spinner, until it resolves. */
	onConfirm: () => Promise<unknown> | void;
};

/** Asks before something that cannot be undone. The board shows one at a time. */
export function ConfirmDialog({ request, onDone }: { request: ConfirmRequest | null; onDone: () => void }) {
	// Keep the last request on screen while the dialog animates out.
	const [shown, setShown] = useState(request);
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		if (request) setShown(request);
	}, [request]);

	return (
		<AlertDialog open={request !== null} onOpenChange={(open) => !open && !busy && onDone()}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle lang="ja">{shown?.title}</AlertDialogTitle>
					<AlertDialogDescription lang="ja">{shown?.description}</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
					<Button
						variant={shown?.danger ? "destructive" : "default"}
						disabled={busy}
						autoFocus
						onClick={async () => {
							if (!shown) return;
							setBusy(true);
							await shown.onConfirm();
							setBusy(false);
							onDone();
						}}
					>
						{busy ? <Spinner /> : null}
						{shown?.action}
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
