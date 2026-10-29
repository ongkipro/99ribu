"use client";

import { cn } from "cn";
import { createContext, Fragment, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { stickyBarClass } from "./page-blocks";
import { DeniedState, EmptyState, ErrorState, LoadingState } from "./states";

// S113: the one list surface of the admin console (shadcn Table). Every list screen passes its
// columns, its load state (states.tsx) and, when it has them, keyset paging, row selection and a
// mobile card. Detail pages use it too (order items, stock per warehouse, cost history).
// Below md a list either renders its own `card`, or (the default, S-V1 tokophi ResponsiveTable)
// `stack`s the same row and cells as a labelled card (one DOM, so row/cell locators and accessible
// names hold at every width). From md the table scrolls: the first column stays pinned (a 1px line
// once columns pass under it) and a fade marks the right edge while more columns follow. Nothing is
// pinned on the right: the old sticky action column covered data (2026-10-28 P2). The "actions" column scrolls with
// its row (admin review 2026-10-28, finding 2): a pinned right column covered dates and labels at
// 768-1440, so low-priority columns give way first (`hideBelow`) and the rest stay readable.
// Admin mobile pass: a stacked row and a custom card share one anatomy (`stack` roles and the
// Card* helpers below): title line (identifier link left, amount right), meta line, status
// badges, labelled values, then the actions as a full-width bottom row.

export type DataTableColumn<T> = {
	id: string;
	header: ReactNode;
	cell: (row: T) => ReactNode;
	/** Applied to the header and every cell: alignment and responsive hiding. */
	className?: string;
	cellClassName?: string;
	/**
	 * Place in the stacked card (`stack`): "title" (identifier, top left), "aside" (amount, top
	 * right), "meta" (small muted line), "status" (badges), "label" (header beside the value, the
	 * default) or "plain" (value only, full width). A column with id "actions" is the bottom row.
	 */
	stack?: "title" | "aside" | "meta" | "status" | "label" | "plain";
	/**
	 * Low-priority column: from md, hidden while the table frame (not the viewport, so the sidebar
	 * state counts) is narrower than 64rem ("5xl"), 72rem ("6xl") or 80rem ("7xl"), so the columns
	 * that stay keep their width instead of sliding under the pinned edges. The stacked phone card
	 * still shows it; keep the value on the detail page too.
	 */
	hideBelow?: keyof typeof hideBelowClass;
	/**
	 * "datetime": a WIB date and time ("28 Okt 2026, 10.46 WIB") that never wraps or clips: nowrap,
	 * tabular digits and a 10rem minimum from md (the stacked phone card keeps its own layout).
	 */
	kind?: "datetime";
};

// Literal classes (Tailwind only sees whole class names); the frame is the `@container`.
const hideBelowClass = {
	"5xl": "md:@max-5xl:hidden",
	"6xl": "md:@max-6xl:hidden",
	"7xl": "md:@max-7xl:hidden",
};
const datetimeClass = "whitespace-nowrap tabular-nums md:min-w-40";

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
	/**
	 * Below md every row becomes a card of its own cells, each labelled with its header. Default on
	 * unless `card` is set (S-V1, tokophi ResponsiveTable): no list scrolls sideways on a phone.
	 */
	stack?: boolean;
	/**
	 * Group label of a row (rows arrive in group order, e.g. by deadline); a label row with the
	 * group's loaded count opens each group. null: no grouping for this row.
	 */
	group?: (row: T) => string | null;
	selection?: DataTableSelection<T>;
	paging?: DataTablePaging;
	/** Below the rows (page navigation, notes); shown only with rows. */
	footer?: ReactNode;
};

// A selected/active row paints bg-muted, which swallows tinted badges: outline them in their own
// text colour (outline badges also get the card fill).
const selectedBadge =
	"[&[data-state=selected]_[data-slot=badge]]:border-current/40 [&[data-state=selected]_[data-slot=badge][data-variant=outline]]:bg-card";

// While rows are selected the bulk bar is the only action surface: row actions are inert.
const SelectingContext = createContext(false);

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
	stack: stackProp,
	group,
	selection,
	paging,
	footer,
}: DataTableProps<T>) {
	const stack = stackProp ?? !card;
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
	const selecting = selected.size > 0;
	// "Lewat batas · 3" before the first row of each group (counts cover the loaded rows).
	const labels = group ? rows.map(group) : [];
	const groupStart = (index: number) => {
		const label = labels[index];
		if (!label || labels[index - 1] === label) return null;
		return `${label} · ${labels.filter((l) => l === label).length}`;
	};
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
	// The pinned first column needs an opaque background, so every cell paints the same one (row
	// hover and selection included) and no column bands; while columns pass under it it draws a 1px
	// line in the 3:1 input tone (an inset shadow: collapsed table borders stay in the grid and do
	// not follow a sticky cell). Action links and buttons never wrap. Literal classes per mode
	// (Tailwind only sees whole class names).
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
				? stack
					? "md:[&_a]:whitespace-nowrap md:[&_button]:whitespace-nowrap"
					: "[&_a]:whitespace-nowrap [&_button]:whitespace-nowrap"
				: undefined;
	const stackCell = (c: DataTableColumn<T>) =>
		stack &&
		cn(
			"max-md:flex max-md:min-h-8 max-md:min-w-0 max-md:items-center max-md:gap-3 max-md:px-0 max-md:py-1 max-md:whitespace-normal",
			// Catalogue order: title + aside, meta, status badges, labelled values, actions.
			c.id === "actions"
				? "max-md:order-4 max-md:col-span-2 max-md:justify-stretch max-md:pt-2 max-md:[&_a]:flex-1 max-md:[&_button]:flex-1"
				: c.stack === "title"
					? "max-md:col-start-1 max-md:row-start-1 max-md:flex-col max-md:items-start max-md:justify-center max-md:gap-0.5 max-md:text-left max-md:font-medium"
					: c.stack === "aside"
						? "max-md:col-start-2 max-md:row-start-1 max-md:items-center max-md:justify-end max-md:self-start max-md:text-right max-md:font-semibold pointer-coarse:max-md:min-h-11"
						: c.stack === "meta"
							? "max-md:order-1 max-md:col-span-2 max-md:min-h-0 max-md:justify-start max-md:py-0 max-md:text-left max-md:text-xs max-md:text-muted-foreground"
							: c.stack === "status"
								? "max-md:order-2 max-md:col-span-2 max-md:justify-start max-md:text-left"
								: c.stack === "plain"
									? "max-md:order-3 max-md:col-span-2 max-md:block max-md:text-left"
									: "max-md:order-3 max-md:col-span-2 max-md:justify-between max-md:text-right",
		);
	// Only "label" columns (the default) show their header inside the stacked card.
	const stackLabel = (c: DataTableColumn<T>) => stack && (c.stack ?? "label") === "label" && c.id !== "actions";

	return (
		<>
			{selection && selected.size > 0 && (
				// Phones: a sticky bottom bar (safe-area inset; admin.css pads the page and the scroll area).
				<div
					data-testid={selection.barTestId}
					data-sticky-bar=""
					className={cn(
						"flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/30 bg-secondary px-3 py-2",
						stickyBarClass,
					)}
				>
					<span className="text-sm font-medium tabular-nums">
						{selection.summary?.(selected.size) ?? `${selected.size} baris dipilih`}
					</span>
					<div className="flex flex-wrap gap-2 max-md:w-full max-md:*:flex-1">
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
					columns.some((c) => c.hideBelow) && "@container",
					card && "hidden md:block",
				)}
			>
				{edges.end && (
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
									className={cn(c.className, c.hideBelow && hideBelowClass[c.hideBelow], c.kind === "datetime" && datetimeClass, headBg, pin(c.id))}
								>
									{c.header}
								</TableHead>
							))}
						</TableRow>
					</TableHeader>
					<TableBody
						data-testid={bodyTestId}
						{...role("rowgroup")}
						className={cn(stack && "max-md:block")}
					>
						{rows.map((row, index) => {
							const id = rowKey(row);
							const detail = expanded?.(row);
							const label = groupStart(index);
							return (
								<Fragment key={id}>
									{label && (
										<TableRow {...role("row")} className={cn("hover:bg-transparent", stack && "max-md:block")}>
											<TableCell
												{...role("cell")}
												colSpan={span}
												className={cn("bg-muted py-1.5 text-xs font-semibold text-muted-foreground", stack && "max-md:block max-md:px-3")}
											>
												{label}
											</TableCell>
										</TableRow>
									)}
									<TableRow
										data-testid={rowTestId?.(row)}
										data-state={selected.has(id) || id === activeKey ? "selected" : undefined}
										{...role("row")}
										className={cn(
											// Spec 10: 48px minimum row (a table row's height acts as its minimum) so 44px actions never overlap.
											"group/row h-12",
											selectedBadge,
											rowClassName,
											stack &&
												"max-md:grid max-md:h-auto max-md:grid-cols-[minmax(0,1fr)_auto] max-md:gap-x-3 max-md:p-3 max-md:data-[state=selected]:bg-muted",
										)}
									>
										{selection && (
											<TableCell
												{...role("cell")}
												className={cn(cellBg, pinCheckbox, stack && "max-md:col-span-2 max-md:px-0")}
											>
												{checkbox(row, "")}
											</TableCell>
										)}
										{columns.map((c) => (
											<TableCell
												key={c.id}
												{...role("cell")}
												inert={c.id === "actions" && selecting ? true : undefined}
												className={cn(
													c.className,
													c.hideBelow && hideBelowClass[c.hideBelow],
													c.kind === "datetime" && datetimeClass,
													cellBg,
													pin(c.id),
													stackCell(c),
													c.cellClassName,
													c.id === "actions" && selecting && "opacity-50",
												)}
											>
												{stackLabel(c) && typeof c.header === "string" && (
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
								ref={(el) => {
									if (el) el.indeterminate = someSelected;
								}}
								onChange={toggleAll}
							/>
							{selection.allLabel}
						</label>
					)}
					<ul className="flex flex-col divide-y rounded-md border text-sm">
						<SelectingContext value={selecting}>
							{rows.map((row, index) => {
								const label = groupStart(index);
								return (
									<Fragment key={rowKey(row)}>
										{label && <li className="bg-muted px-3 py-1.5 text-xs font-semibold text-muted-foreground">{label}</li>}
										<li
											data-testid={cardTestId?.(row)}
											data-state={selected.has(rowKey(row)) || rowKey(row) === activeKey ? "selected" : undefined}
											className={cn("flex items-start gap-2 p-3 data-[state=selected]:bg-muted", selectedBadge)}
										>
											{checkbox(row, "card-")}
											<div className="flex min-w-0 flex-1 flex-col gap-2">{card(row)}</div>
										</li>
									</Fragment>
								);
							})}
						</SelectingContext>
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

/**
 * Card mode (`card`): the title line, identifier left; right the amount, or the status badge
 * when the row has no amount (same slots as the stacked row's "title" and "aside").
 */
export function CardTitle({ title, aside }: { title: ReactNode; aside?: ReactNode }) {
	return (
		<div className="flex items-start justify-between gap-3">
			<div className="flex min-w-0 flex-col font-medium">{title}</div>
			{aside && (
				// Level with the first line of the title (a 44px link on touch).
				<div className="flex shrink-0 flex-wrap items-center justify-end gap-1 text-right font-semibold tabular-nums pointer-coarse:min-h-11">
					{aside}
				</div>
			)}
		</div>
	);
}
/** Card mode: one small muted line (time, warehouse, counts). */
export function CardMeta({ children }: { children: ReactNode }) {
	return <p className="text-xs text-muted-foreground tabular-nums">{children}</p>;
}
/** Card mode: status badges. */
export function CardStatus({ children }: { children: ReactNode }) {
	return <div className="flex flex-wrap items-center gap-1">{children}</div>;
}
/** Card mode: the actions as a full-width bottom row (inert while rows are selected). */
export function CardActions({ children }: { children: ReactNode }) {
	const selecting = useContext(SelectingContext);
	return (
		<div
			inert={selecting || undefined}
			className={cn(
				"flex flex-wrap gap-2 pt-1 *:flex-1 [&_a]:whitespace-nowrap [&_button]:whitespace-nowrap",
				selecting && "opacity-50",
			)}
		>
			{children}
		</div>
	);
}
