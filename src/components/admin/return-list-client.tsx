"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DataTable } from "./data-table";
import { formatWib } from "./format";
import { SegmentedControl } from "./form";
import { REASON, RESOLUTION, RETURN_STATUS, RETURN_TABS, type ReturnCase, type ReturnTab } from "./return-model";
import { StatusBadge } from "./status";
import { useKeysetList } from "./use-keyset-list";
import { adminPath } from "@/modules/access/admin-paths";

const PAGE_SIZE = 20;
const EMPTY: Record<ReturnTab, string> = {
	decide: "Tidak ada klaim yang menunggu keputusan.",
	goods: "Tidak ada barang retur yang ditunggu atau diperiksa.",
	progress: "Tidak ada refund atau penggantian yang berjalan.",
	done: "Belum ada retur yang selesai atau ditolak.",
	all: "Belum ada pengajuan retur.",
};

const reasons = (row: ReturnCase) => {
	const unique = [...new Set(row.items.map((item) => REASON[item.reason] ?? item.reason))];
	return unique.length > 1 ? `${unique[0]} +${unique.length - 1}` : unique[0];
};
const warehouses = (row: ReturnCase) => [...new Set(row.items.map((item) => item.warehouse_name))].join(", ");

export function ReturnListClient({ initialTab }: { initialTab: ReturnTab }) {
	const router = useRouter();
	const [tab, setTab] = useState<ReturnTab>(initialTab);
	const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
	if (tab !== "all") params.set("state", tab);
	const list = useKeysetList<ReturnCase>(`/api/v1/admin/returns?${params}`, (row) => row.id);
	const change = (next: ReturnTab) => {
		setTab(next);
		// The tab survives Back and reload; it carries no private data.
		router.replace(`/admin/returns?tahap=${next}`, { scroll: false });
	};
	return (
		<div className="flex flex-col gap-4">
			<SegmentedControl
				legend="Tahap retur"
				value={tab}
				options={RETURN_TABS}
				onChange={change}
				testId={(key) => `returns-tab-${key}`}
			/>
			<DataTable
				testId="returns-table"
				caption="Daftar retur"
				rows={list.rows}
				rowKey={(row) => row.id}
				rowTestId={(row) => `return-row-${row.order_number}`}
				status={list.status}
				loadingLabel="Memuat retur…"
				empty={EMPTY[tab]}
				emptyTestId="returns-empty"
				stack
				paging={{ ...list.paging, testId: "returns-more", summary: `${list.rows.length} retur ditampilkan` }}
				columns={[
					{
						id: "case",
						header: "Pesanan",
						stack: "title",
						cell: (row) => (
							<span className="flex flex-col">
								<Link
									href={adminPath("return", row.admin_no)}
									className="font-mono font-medium break-all text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center"
									aria-label={`Buka retur pesanan ${row.order_number}`}
								>
									{row.order_number}
								</Link>
								<span className="text-xs font-normal text-muted-foreground">
									{RESOLUTION[row.requested_resolution]} · {row.items.length} barang
								</span>
							</span>
						),
					},
					{
						id: "status",
						header: "Status",
						stack: "aside",
						cell: (row) => {
							const [label, tone] = RETURN_STATUS[row.status];
							return <StatusBadge tone={tone} data-status={row.status}>{label}</StatusBadge>;
						},
					},
					{
						id: "created",
						header: "Diajukan",
						stack: "meta",
						className: "whitespace-nowrap tabular-nums",
						cell: (row) => formatWib(row.created_at),
					},
					{ id: "reason", header: "Alasan", className: "md:max-lg:hidden", cell: reasons },
					{ id: "warehouse", header: "Gudang", className: "md:max-xl:hidden", cell: warehouses },
					{
						id: "actions",
						header: <span className="sr-only">Tindakan</span>,
						className: "text-right",
						cell: (row) => (
							<Button asChild size="sm" variant="outline">
								<Link href={adminPath("return", row.admin_no)}>Buka retur</Link>
							</Button>
						),
					},
				]}
			/>
		</div>
	);
}
