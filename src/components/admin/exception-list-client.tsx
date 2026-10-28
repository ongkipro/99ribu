"use client";

import { ClipboardList } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { DataTable } from "./data-table";
import {
	type ExceptionRow,
	type ExceptionAccess,
	type ExceptionKind,
	type ExceptionStatus,
	KIND,
	KINDS,
	STATUS,
	STATUSES,
} from "./exception-model";
import { StockReportDialog } from "./exception-physical-dialogs";
import { formatWib } from "./format";
import { FilterSheet, FormField, nativeSelectClass } from "./form";
import { StatusBadge } from "./status";
import { useKeysetList } from "./use-keyset-list";
import { adminPath } from "@/modules/access/admin-paths";

// S133 Masalah Pengiriman: the scoped queue of commerce exceptions (GET /admin/commerce-exceptions).
// The API scopes rows to the viewer's warehouses and pages by keyset; filters are the API's own
// (status, kind) and survive Back and reload in the address. Reporting a stock count starts here
// for warehouse staff; everything else happens on the case.

const PAGE_SIZE = 20;
const ALL = "";

export function ExceptionListClient({
	access,
	initialStatus,
	initialKind,
}: {
	access: ExceptionAccess;
	initialStatus: ExceptionStatus | null;
	initialKind: ExceptionKind | null;
}) {
	const router = useRouter();
	const [status, setStatus] = useState<ExceptionStatus | typeof ALL>(initialStatus ?? ALL);
	const [kind, setKind] = useState<ExceptionKind | typeof ALL>(initialKind ?? ALL);
	const [report, setReport] = useState(false);
	const reportButton = useRef<HTMLButtonElement>(null);

	const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
	if (status) params.set("status", status);
	if (kind) params.set("kind", kind);
	const list = useKeysetList<ExceptionRow>(`/api/v1/admin/commerce-exceptions?${params}`, (row) => row.id);
	const filtered = status !== ALL || kind !== ALL;
	const remember = (nextStatus: string, nextKind: string) => {
		const query = new URLSearchParams();
		if (nextStatus) query.set("status", nextStatus);
		if (nextKind) query.set("jenis", nextKind);
		router.replace(`/admin/exceptions${query.size ? `?${query}` : ""}`, { scroll: false });
	};

	return (
		<div className="flex flex-col gap-4" data-testid="exceptions-page">
			<div className="flex flex-wrap items-end justify-between gap-3 max-md:flex-col max-md:items-stretch">
				<div className="grid gap-3 md:grid-cols-[repeat(2,minmax(11rem,14rem))] md:items-end">
					<FilterSheet active={Number(status !== ALL) + Number(kind !== ALL)}>
						<FormField id="exception-filter-status" label="Status">
							<select
								id="exception-filter-status"
								className={`${nativeSelectClass} w-full`}
								value={status}
								onChange={(e) => {
									const next = e.target.value as ExceptionStatus | typeof ALL;
									setStatus(next);
									remember(next, kind);
								}}
							>
								<option value={ALL}>Semua status</option>
								{STATUSES.map((key) => (
									<option key={key} value={key}>
										{STATUS[key][0]}
									</option>
								))}
							</select>
						</FormField>
						<FormField id="exception-filter-kind" label="Jenis kasus">
							<select
								id="exception-filter-kind"
								className={`${nativeSelectClass} w-full`}
								value={kind}
								onChange={(e) => {
									const next = e.target.value as ExceptionKind | typeof ALL;
									setKind(next);
									remember(status, next);
								}}
							>
								<option value={ALL}>Semua jenis</option>
								{KINDS.map((key) => (
									<option key={key} value={key}>
										{KIND[key]}
									</option>
								))}
							</select>
						</FormField>
					</FilterSheet>
				</div>
				{access.warehouse && (
					<Button ref={reportButton} type="button" data-testid="exception-report" onClick={() => setReport(true)}>
						<ClipboardList data-icon="inline-start" aria-hidden="true" />
						Laporkan selisih stok
					</Button>
				)}
			</div>
			<DataTable
				testId="exceptions-table"
				caption="Daftar kasus pengiriman"
				rows={list.rows}
				rowKey={(row) => row.id}
				rowTestId={(row) => `exception-row-${row.id}`}
				status={list.status}
				loadingLabel="Memuat kasus…"
				empty={
					filtered
						? "Tidak ada kasus dengan filter ini. Ubah atau hapus filter untuk melihat kasus lain."
						: "Belum ada kasus. Kasus muncul dari hitungan stok, pembayaran terlambat, COD ditolak atau pengiriman gagal."
				}
				emptyTestId="exceptions-empty"
				stack
				paging={{ ...list.paging, testId: "exceptions-more", summary: `${list.rows.length} kasus ditampilkan` }}
				columns={[
					{
						id: "case",
						header: "Kasus",
						stack: "title",
						cell: (row) => (
							<span className="flex flex-col">
								<Link
									href={adminPath("exception", row.admin_no)}
									className="font-medium text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center"
									aria-label={`Buka kasus ${KIND[row.kind]}${row.order_number ? ` pesanan ${row.order_number}` : ""}`}
								>
									{KIND[row.kind]}
								</Link>
								{row.order_number && <span className="font-mono text-xs font-normal break-all text-muted-foreground">{row.order_number}</span>}
							</span>
						),
					},
					{
						id: "status",
						header: "Status",
						stack: "aside",
						cell: (row) => {
							const [label, tone] = STATUS[row.status];
							return (
								<StatusBadge tone={tone} data-status={row.status}>
									{label}
								</StatusBadge>
							);
						},
					},
					{
						id: "occurred",
						header: "Terjadi",
						stack: "meta",
						className: "whitespace-nowrap tabular-nums",
						cell: (row) => formatWib(row.occurred_at),
					},
					{
						id: "units",
						header: "Unit",
						className: "md:max-lg:hidden",
						cell: (row) =>
							row.units.length ? `${row.units.length} unit${row.units[0].product_name ? ` · ${row.units[0].product_name}` : ""}` : "Tanpa unit",
					},
					{
						id: "warehouse",
						header: "Gudang",
						className: "md:max-xl:hidden",
						cell: (row) => [...new Set(row.units.map((u) => u.warehouse_name).filter(Boolean))].join(", ") || "—",
					},
					{
						id: "actions",
						header: <span className="sr-only">Tindakan</span>,
						className: "text-right",
						cell: (row) => (
							<Button asChild size="sm" variant="outline">
								<Link href={adminPath("exception", row.admin_no)}>Buka kasus</Link>
							</Button>
						),
					},
				]}
			/>
			{report && (
				<StockReportDialog
					onClose={() => {
						setReport(false);
						reportButton.current?.focus();
					}}
					onUncertain={() => void list.reload()}
					onDone={(_text, saved) => {
						setReport(false);
						if (saved.admin_no != null) router.push(adminPath("exception", saved.admin_no));
						else void list.reload();
					}}
				/>
			)}
		</div>
	);
}
