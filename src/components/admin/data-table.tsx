"use client";

import { cn } from "cn";
import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { DeniedState, EmptyState, ErrorState, LoadingState } from "./states";

// S113: the one list surface of the admin console (shadcn Table). Every list screen passes its
// columns, its load state (states.tsx) and, when it has them, keyset paging, row selection and a
// mobile card. Detail pages use it too (order items, stock per warehouse, cost history).
// Below md a list either renders its own `card`, or with `stack` the same row and cells as a
// labelled card (one DOM, so row/cell locators and accessible names hold at every width).
// Otherwise the table scrolls: the first column and an "actions" column stay pinned and a fade
// marks the edge that has more columns.

export type DataTableColumn<T> = {
	id: string;
	header: ReactNode;
	cell: (row: T) => ReactNode;
	/** Applied to the header and every cell: alignment and responsive hiding. */
	className?: string;
	cellClassName?: string;
	/** Stacked card (`stack`): "label" shows the header beside the value, "plain" the value only. */
	stack?: "label" | "plain";
};

export type DataTableStatus =
	| { kind: "loading" }
	| { kind: "ready" }
	| { kind: "error"; message: string; onRetry?: () => void }
	/** The API refused this principal (403) or the list needs a staff session. */
	| { kind: "denied"; message: ReactNode };

export type DataTableSelection<T> = {
	selected: readonly string[];
	onChange: (ids: string[]) => void;
	/** Accessible name of one row's checkbox. */
	label: (row: T) => string;
	/** Accessible name of the select-all checkbox. */
	allLabel: string;
	/** Optional test id per checkbox; `prefix` is "" in the table and "card-" in the mobile card. */
	testId?: (row: T, prefix: "" | "card-") => string;
	/** Bulk actions shown in a bar while rows are selected. */
	actions?: ReactNode;
	/** Text of the bar, e.g. "3 baris dipilih di halaman ini". */
	summary?: (count: number) => string;
	barTestId?: string;
};

export type DataTablePaging = {
	hasMore: boolean;
	loading: boolean;
	onMore: () => void;
	/** Shown after a failed next page; the rows already shown stay. */
	error?: string | null;
	/** Live text next to the button, e.g. "40 paket ditampilkan". */
	summary?: ReactNode;
	testId?: string;
};

export type DataTableProps<T> = {
	rows: readonly T[];
	rowKey: (row: T) => string;
	columns: DataTableColumn<T>[];
	status: DataTableStatus;
	loadingLabel: string;
	empty: ReactNode;
	emptyTestId?: string;
	/** Screen-reader caption of the table. */
	caption?: string;
	testId?: string;
	bodyTestId?: string;
	rowTestId?: (row: T) => string;
	rowClassName?: string;
	/** Key of the row whose detail is open; it is highlighted like a selected row. */
	activeKey?: string | null;
	/** A full-width row under `row` (inline forms); null renders nothing. */
	expanded?: (row: T) => ReactNode;
	/** Mobile card: when set the table shows from `md` and these cards below it. */
	card?: (row: T) => ReactNode;
	cardTestId?: (row: T) => string;
	/** Below md every row becomes a card of its own cells, each labelled with its header. */
	stack?: boolean;
	selection?: DataTableSelection<T>;
	paging?: DataTablePaging;
	/** Below the rows (page navigation, notes); shown only with rows. */
	footer?: ReactNode;
};

// A selected/active row paints bg-muted, which swallows tinted badges: outline them in their own
// text colour (outline badges also get the card fill).
const selectedBadge =
	"[&[data-state=selected]_[data-slot=badge]]:border-current/40 [&[data-state=selected]_[data-slot=badge][data-variant=outline]]:bg-card";

const checkboxClass =
	"size-4 accent-primary align-middle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export function DataTable<T>({
	rows,
	rowKey,
	columns,
	status,
	loadingLabel,
	empty,
	emptyTestId,
	caption,
	testId,
	bodyTestId,
	rowTestId,
	rowClassName,
	activeKey,
	expanded,
	card,
	cardTestId,
	stack = false,
	selection,
	paging,
	footer,
}: DataTableProps<T>) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const [edges, setEdges] = useState({ start: false, end: false });
	const ready = status.kind === "ready" && rows.length > 0;
	useEffect(() => {
		const el = scrollRef.current?.querySelector<HTMLElement>('[data-slot="table-container"]');
		if (!ready || !el) return;
		const measure = () =>
			setEdges({
				start: el.scrollLeft > 1,
				end: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
			});
		measure();
		el.addEventListener("scroll", measure, { passive: true });
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => {
			el.removeEventListener("scroll", measure);
			observer.disconnect();
		};
	}, [ready]);
	if (status.kind === "loading")
		return <LoadingState label={loadingLabel} lines={5} columns={Math.min(columns.length + (selection ? 1 : 0), 5)} />;
	if (status.kind === "error")
		return <ErrorState message={status.message} onRetry={status.onRetry} />;
	if (status.kind === "denied") return <DeniedState>{status.message}</DeniedState>;
	if (rows.length === 0) return <EmptyState testId={emptyTestId}>{empty}</EmptyState>;

	const selected = new Set(selection?.selected ?? []);
	const allSelected = rows.length > 0 && rows.every((r) => selected.has(rowKey(r)));
	const someSelected = selected.size > 0 && !allSelected;
	const toggleAll = () =>
		selection?.onChange(allSelected ? [] : rows.map(rowKey));
	const toggle = (id: string) =>
		selection?.onChange(
			selected.has(id)
				? [...selected].filter((x) => x !== id)
				: [...selected, id],
		);
	const checkbox = (row: T, prefix: "" | "card-") =>
		selection && (
			<label className="-m-2 inline-flex size-11 shrink-0 cursor-pointer items-center justify-center">
				<input
					type="checkbox"
					aria-label={selection.label(row)}
					data-testid={selection.testId?.(row, prefix)}
					className={checkboxClass}
					checked={selected.has(rowKey(row))}
					onChange={() => toggle(rowKey(row))}
				/>
			</label>
		);
	const span = columns.length + (selection ? 1 : 0);
	// Explicit roles keep table semantics while the stacked card changes display below md.
	const role = (name: "table" | "rowgroup" | "row" | "columnheader" | "cell") =>
		stack ? { role: name } : {};
	const first = columns[0]?.id;
	const last = columns.at(-1)?.id === "actions" ? "actions" : null;
	// Pinned cells need an opaque background, so every cell paints the same one (row hover and
	// selection included) and no column bands; while columns hide behind a pinned edge it draws a
	// 1px line in the 3:1 input tone (an inset shadow: collapsed table borders stay in the grid and do
	// not follow a sticky cell), and action buttons never wrap. Literal classes per mode (Tailwind only sees whole
	// class names).
	const headBg = stack ? "md:bg-card" : "bg-card";
	const cellBg = stack
		? "md:bg-card md:group-hover/row:bg-muted md:group-has-aria-expanded/row:bg-muted md:group-data-[state=selected]/row:bg-muted"
		: "bg-card group-hover/row:bg-muted group-has-aria-expanded/row:bg-muted group-data-[state=selected]/row:bg-muted";
	const pinCheckbox = stack ? "md:sticky md:left-0 md:z-10" : "sticky left-0 z-10";
	const pin = (id: string | null) =>
		id === first
			? cn(
					stack ? "md:sticky md:z-10" : "sticky z-10",
					selection ? (stack ? "md:left-12" : "left-12") : stack ? "md:left-0" : "left-0",
					edges.start && (stack ? "md:shadow-[inset_-1px_0_0_var(--color-input)]" : "shadow-[inset_-1px_0_0_var(--color-input)]"),
				)
			: id === last
				? cn(
						stack
							? "md:sticky md:right-0 md:z-10 md:[&_a]:whitespace-nowrap md:[&_button]:whitespace-nowrap"
							: "sticky right-0 z-10 [&_a]:whitespace-nowrap [&_button]:whitespace-nowrap",
						edges.end && (stack ? "md:shadow-[inset_1px_0_0_var(--color-input)]" : "shadow-[inset_1px_0_0_var(--color-input)]"),
					)
				: undefined;
	const stackCell = (c: DataTableColumn<T>) =>
		stack &&
		cn(
			"max-md:flex max-md:min-h-8 max-md:items-center max-md:justify-between max-md:gap-3 max-md:px-0 max-md:py-1 max-md:text-right max-md:whitespace-normal",
			c.id === "actions" && "max-md:justify-stretch max-md:pt-2 max-md:[&_a]:flex-1 max-md:[&_button]:flex-1",
		);

	return (
		<>
			{selection && selected.size > 0 && (
				<div
					data-testid={selection.barTestId}
					className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/30 bg-secondary px-3 py-2"
				>
					<span className="text-sm font-medium tabular-nums">
						{selection.summary?.(selected.size) ?? `${selected.size} baris dipilih`}
					</span>
					<div className="flex flex-wrap gap-2">
						{selection.actions}
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={() => selection.onChange([])}
						>
							Batalkan pilihan
						</Button>
					</div>
				</div>
			)}
			<div
				ref={scrollRef}
				className={cn(
					"relative rounded-md border",
					card && "hidden md:block",
					stack && "max-md:border-0",
				)}
			>
				{!last && edges.end && (
					<div
						aria-hidden="true"
						className={cn(
							"pointer-events-none absolute inset-y-0 right-0 z-20 w-10 rounded-r-md bg-linear-to-l from-card to-transparent",
							stack && "max-md:hidden",
						)}
					/>
				)}
				<Table data-testid={testId} {...role("table")} className={cn(stack && "max-md:block")}>
					{caption && <caption className="sr-only">{caption}</caption>}
					<TableHeader {...role("rowgroup")} className={cn(stack && "max-md:sr-only")}>
						<TableRow {...role("row")}>
							{selection && (
								<TableHead
									scope="col"
									{...role("columnheader")}
									className={cn("w-12", headBg, pinCheckbox)}
								>
									<label className="-m-2 inline-flex size-11 cursor-pointer items-center justify-center">
										<input
											type="checkbox"
											aria-label={selection.allLabel}
											className={checkboxClass}
											checked={allSelected}
											ref={(el) => {
												if (el) el.indeterminate = someSelected;
											}}
											onChange={toggleAll}
										/>
									</label>
								</TableHead>
							)}
							{columns.map((c) => (
								<TableHead
									key={c.id}
									scope="col"
									{...role("columnheader")}
									className={cn(c.className, headBg, pin(c.id))}
								>
									{c.header}
								</TableHead>
							))}
						</TableRow>
					</TableHeader>
					<TableBody
						data-testid={bodyTestId}
						{...role("rowgroup")}
						className={cn(stack && "max-md:flex max-md:flex-col max-md:gap-2")}
					>
						{rows.map((row) => {
							const id = rowKey(row);
							const detail = expanded?.(row);
							return (
								<Fragment key={id}>
									<TableRow
										data-testid={rowTestId?.(row)}
										data-state={selected.has(id) || id === activeKey ? "selected" : undefined}
										{...role("row")}
										className={cn(
											"group/row",
											selectedBadge,
											rowClassName,
											stack &&
												"max-md:flex max-md:h-auto max-md:flex-col max-md:rounded-md max-md:border! max-md:px-3 max-md:py-2",
										)}
									>
										{selection && (
											<TableCell
												{...role("cell")}
												className={cn(cellBg, pinCheckbox)}
											>
												{checkbox(row, "")}
											</TableCell>
										)}
										{columns.map((c) => (
											<TableCell
												key={c.id}
												{...role("cell")}
												className={cn(c.className, cellBg, pin(c.id), stackCell(c), c.cellClassName)}
											>
												{stack && c.stack !== "plain" && typeof c.header === "string" && (
													<span
														aria-hidden="true"
														className="shrink-0 text-left text-xs text-muted-foreground md:hidden"
													>
														{c.header}
													</span>
												)}
												{c.cell(row)}
											</TableCell>
										))}
									</TableRow>
									{detail && (
										<TableRow {...role("row")} className="bg-muted/50 hover:bg-muted/50">
											<TableCell {...role("cell")} colSpan={span}>
												{detail}
											</TableCell>
										</TableRow>
									)}
								</Fragment>
							);
						})}
					</TableBody>
				</Table>
			</div>
			{card && (
				<div className="flex flex-col gap-2 md:hidden">
					{selection && (
						<label className="inline-flex min-h-11 items-center gap-2 self-start text-sm font-medium">
							<input
								type="checkbox"
								className={checkboxClass}
								checked={allSelected}
								onChange={toggleAll}
							/>
							{selection.allLabel}
						</label>
					)}
					<ul className="flex flex-col divide-y rounded-md border">
						{rows.map((row) => (
							<li
								key={rowKey(row)}
								data-testid={cardTestId?.(row)}
								data-state={rowKey(row) === activeKey ? "selected" : undefined}
								className={cn("flex items-start gap-2 p-3 data-[state=selected]:bg-muted", selectedBadge)}
							>
								{checkbox(row, "card-")}
								<div className="flex min-w-0 flex-1 flex-col gap-2">{card(row)}</div>
							</li>
						))}
					</ul>
				</div>
			)}
			{paging && (paging.hasMore || paging.summary || paging.error) && (
				<div className="flex flex-wrap items-center gap-3">
					{paging.summary && (
						<p className="text-sm text-muted-foreground" aria-live="polite">
							{paging.summary}
						</p>
					)}
					{paging.hasMore && (
						<Button
							type="button"
							variant="outline"
							data-testid={paging.testId}
							disabled={paging.loading}
							onClick={paging.onMore}
						>
							{paging.loading ? "Memuat…" : "Muat baris berikutnya"}
						</Button>
					)}
					{paging.error && (
						<p role="alert" className="text-sm text-destructive">
							{paging.error}
						</p>
					)}
				</div>
			)}
			{footer}
		</>
	);
}
