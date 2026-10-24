import { RefreshCw, ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";

// S113: the four shared states of every admin section (lists, detail panels, dashboard cards).
// Loading announces itself politely, errors offer a retry, denied explains the missing grant and
// empty says what would appear. Page-level refusals keep AccessDenied (access-denied.tsx).

export function LoadingState({
	label,
	lines = 3,
	className = "h-12 w-full",
	columns,
}: {
	label: string;
	lines?: number;
	className?: string;
	/** Table-shaped placeholder (DataTable): a header row and `lines` rows of this many cells. */
	columns?: number;
}) {
	const placeholders = (n: number) => Array.from({ length: n }, (_, i) => i);
	return (
		<div className="flex flex-col gap-2" aria-busy="true" aria-live="polite">
			<p className="text-sm text-muted-foreground">{label}</p>
			{columns ? (
				<div aria-hidden="true" className="rounded-md border">
					{placeholders(lines + 1).map((row) => (
						<div key={row} className="flex h-10 items-center gap-4 border-b px-2 last:border-b-0">
							{placeholders(columns).map((cell) => (
								<Skeleton key={cell} className={row === 0 ? "h-3 flex-1" : "h-4 flex-1"} />
							))}
						</div>
					))}
				</div>
			) : (
				placeholders(lines).map((i) => <Skeleton key={i} className={className} />)
			)}
		</div>
	);
}

export function ErrorState({
	message,
	onRetry,
}: {
	message: string;
	onRetry?: () => void;
}) {
	return (
		<Alert
			variant="destructive"
			className="flex flex-wrap items-center justify-between gap-3 border-destructive/40 bg-destructive-surface"
		>
			<AlertDescription className="text-foreground">{message}</AlertDescription>
			{onRetry && (
				<Button type="button" variant="outline" size="sm" onClick={onRetry}>
					<RefreshCw data-icon="inline-start" aria-hidden="true" />
					Coba lagi
				</Button>
			)}
		</Alert>
	);
}

export function DeniedState({ children }: { children: ReactNode }) {
	return (
		<div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-surface px-4 py-3 text-sm">
			<ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
			<p>{children}</p>
		</div>
	);
}

export function EmptyState({
	title,
	children,
	testId,
}: {
	title?: string;
	children: ReactNode;
	testId?: string;
}) {
	return (
		<Empty data-testid={testId} className="gap-2 rounded-md border px-4 py-8">
			{title && <EmptyTitle className="text-base">{title}</EmptyTitle>}
			<EmptyDescription>{children}</EmptyDescription>
		</Empty>
	);
}
