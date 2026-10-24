"use client";

import { cn } from "cn";
import { Fragment, type ReactNode } from "react";
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

export type DataTableColumn<T> = {
	id: string;
	header: ReactNode;
	cell: (row: T) => ReactNode;
	/** Applied to the header and every cell: alignment and responsive hiding. */
	className?: string;
	cellClassName?: string;
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
	/** A full-width row under `row` (inline forms); null renders nothing. */
	expanded?: (row: T) => ReactNode;
	/** Mobile card: when set the table shows from `md` and these cards below it. */
	card?: (row: T) => ReactNode;
	cardTestId?: (row: T) => string;
	selection?: DataTableSelection<T>;
	paging?: DataTablePaging;
	/** Below the rows (page navigation, notes); shown only with rows. */
	footer?: ReactNode;
};

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
	expanded,
	card,
	cardTestId,
	selection,
	paging,
	footer,
}: DataTableProps<T>) {
	if (status.kind === "loading") return <LoadingState label={loadingLabel} />;
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
				className={cn(
					"overflow-x-auto rounded-md border",
					card && "hidden md:block",
				)}
			>
				<Table data-testid={testId}>
					{caption && <caption className="sr-only">{caption}</caption>}
					<TableHeader>
						<TableRow>
							{selection && (
								<TableHead scope="col" className="w-12">
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
								<TableHead key={c.id} scope="col" className={c.className}>
									{c.header}
								</TableHead>
							))}
						</TableRow>
					</TableHeader>
					<TableBody data-testid={bodyTestId}>
						{rows.map((row) => {
							const id = rowKey(row);
							const detail = expanded?.(row);
							return (
								<Fragment key={id}>
									<TableRow
										data-testid={rowTestId?.(row)}
										data-state={selected.has(id) ? "selected" : undefined}
										className={rowClassName}
									>
										{selection && <TableCell>{checkbox(row, "")}</TableCell>}
										{columns.map((c) => (
											<TableCell
												key={c.id}
												className={cn(c.className, c.cellClassName)}
											>
												{c.cell(row)}
											</TableCell>
										))}
									</TableRow>
									{detail && (
										<TableRow className="bg-muted/50 hover:bg-muted/50">
											<TableCell colSpan={span}>{detail}</TableCell>
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
								className="flex items-start gap-2 p-3"
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
