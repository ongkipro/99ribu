"use client";

import { AlarmClock, ChevronRight, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatWait } from "./format";
import { type NeedsActionMetric, needsActionRows } from "./needs-action-model";

export type { NeedsActionMetric } from "./needs-action-model";

// "Perlu tindakan" (spec 17 W4-2, DEC-027 (3)): the work that waits, in order of deadline risk. Every
// row is the dashboard's own metric: it opens that metric's drilldown queue and its number is that
// queue's row count (the same data source as the cards below). Overdue and older-than-24-hour
// markers are text plus an icon, never colour alone.

const STALE_SECONDS = 24 * 3600;

export function NeedsAction<T extends NeedsActionMetric>({
	metrics,
	activeKey,
	onOpen,
}: {
	metrics: T[];
	activeKey: string | null;
	onOpen: (metric: T) => void;
}) {
	const rows = needsActionRows(metrics);
	return (
		<section aria-labelledby="needs-action-heading" data-testid="needs-action" className="flex flex-col gap-2">
			<h2 id="needs-action-heading" className="text-base font-semibold">
				Perlu tindakan
			</h2>
			{rows.length === 0 ? (
				<p data-testid="needs-action-empty" className="text-sm text-muted-foreground">
					Tidak ada pekerjaan yang menunggu di cakupan ini.
				</p>
			) : (
				<ol className="flex flex-col gap-2">
					{rows.map(({ item, m, count, overdue, age }) => {
						const waited = age?.age_seconds ?? null;
						return (
							<li key={item.key} data-testid={`needs-action-${item.key}`} className="flex flex-wrap items-stretch gap-2">
								{/* A list row that opens its queue: styled as a row, not as a button (admin size contract). */}
								<button
									type="button"
									aria-pressed={activeKey === item.key}
									data-testid={`needs-action-open-${item.key}`}
									className={`${"flex min-h-11 min-w-0 cursor-pointer items-center rounded-lg border bg-card px-4 py-2 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring aria-pressed:border-primary aria-pressed:bg-secondary"} flex-1 basis-60 justify-between gap-3`}
									onClick={() => onOpen(m)}
								>
									<span className="flex min-w-0 flex-col items-start gap-1">
										<span className="text-sm font-medium">{item.label}</span>
										{waited !== null && (
											<span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
												<Clock aria-hidden="true" className="size-3.5" />
												Terlama menunggu {formatWait(waited)}
												{waited > STALE_SECONDS && <span className="font-medium text-warning"> · lebih dari 24 jam</span>}
											</span>
										)}
										{Number(m.stale_count) > 0 && (
											<Badge variant="warning" data-testid={`needs-action-stale-${item.key}`}>
												<Clock aria-hidden="true" />
												{m.stale_count} lebih dari 24 jam
											</Badge>
										)}
									</span>
									<span className="flex shrink-0 items-center gap-1 text-xl font-semibold tabular-nums">
										{count}
										<span className="text-xs font-normal text-muted-foreground">{item.unit}{m.basis === "event_period" ? " · dalam periode terpilih" : ""}</span>
										<ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
									</span>
								</button>
								{overdue && (
									<button
										type="button"
										aria-pressed={activeKey === overdue.key}
										data-testid={`needs-action-overdue-${item.key}`}
										className={`${"flex min-h-11 min-w-0 cursor-pointer items-center rounded-lg border bg-card px-4 py-2 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring aria-pressed:border-primary aria-pressed:bg-secondary"} gap-1.5 text-sm font-medium`}
										onClick={() => onOpen(overdue)}
									>
										<AlarmClock aria-hidden="true" className="size-4 shrink-0 text-destructive" />
										{overdue.count} lewat batas
									</button>
								)}
							</li>
						);
					})}
				</ol>
			)}
		</section>
	);
}
