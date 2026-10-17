import { Skeleton } from "@/components/ui/skeleton";

/** The board's outline while the first load is on its way. */
export default function Loading() {
	return (
		<div className="grid min-h-dvh grid-rows-[auto_minmax(0,1fr)]" aria-busy="true" aria-label="Loading the board">
			<div className="flex items-center gap-3.5 border-b bg-deck-2 px-[18px] py-3">
				<Skeleton className="h-6 w-24" />
				<Skeleton className="h-9 max-w-[420px] flex-1" />
				<Skeleton className="ml-auto h-9 w-28" />
			</div>
			<div className="flex gap-3 overflow-hidden p-[18px]">
				{Array.from({ length: 5 }, (_, column) => (
					<div key={column} className="grid min-w-[232px] flex-1 content-start gap-2 rounded-[14px] border bg-deck p-2.5">
						<Skeleton className="mb-1 h-5 w-24" />
						{Array.from({ length: 3 - (column % 2) }, (_, card) => (
							<Skeleton key={card} className="h-24 rounded-xl" />
						))}
					</div>
				))}
			</div>
		</div>
	);
}
