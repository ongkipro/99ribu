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
}: {
	label: string;
	lines?: number;
	className?: string;
}) {
	return (
		<div className="flex flex-col gap-2" aria-busy="true" aria-live="polite">
			<p className="text-sm text-muted-foreground">{label}</p>
			{Array.from({ length: lines }, (_, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: identical placeholders
				<Skeleton key={i} className={className} />
			))}
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
