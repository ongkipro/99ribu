"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type CanonicalWorkspace =
	| "owner"
	| "ecommerce_admin"
	| "warehouse"
	| "customer_service"
	| "finance";
type QueueKey =
	| "orders"
	| "fulfillments"
	| "delivery_exceptions"
	| "returns"
	| "inventory"
	| "support"
	| "reconciliation";

interface DashboardMetric {
	key: string;
	count: number | null;
	basis: "snapshot" | "event_period";
	complete: boolean;
	queue_key: QueueKey;
	kind: "count" | "money";
	amount: number | null;
	currency: "IDR" | null;
	financial_basis:
		| "actual"
		| "estimated"
		| "mixed"
		| "unknown"
		| "not_applicable";
	definition: string;
	as_of: string;
	queue_filter_token: string;
	filter_version: number;
	filter_expires_at: string;
}

interface DashboardSnapshot {
	workspace: CanonicalWorkspace;
	warehouse_ids: string[];
	from: string;
	to: string;
	timezone: string;
	as_of: string;
	metrics: DashboardMetric[];
}

interface WorkQueueItem {
	id: string;
	resource_kind: string;
	state: string;
	due_at: string | null;
	warehouse_id: string | null;
	version: number;
}

interface AdDestinationItem {
	id: string;
	version: number;
	revision: number;
	platform: "meta" | "google" | "tiktok";
	destination_version: string;
	public_identifier: string;
	external_destination_id: string;
	conversion_action_id: string;
	google_conversion_source?: string;
	paused: boolean;
	enabled: boolean;
	server_purchase_enabled: boolean;
	browser_purchase_enabled: boolean;
	credentials_configured: boolean;
	secret_redacted: boolean;
	updated_at: string;
	eligible: number;
	suppressed: number;
	queued: number;
	accepted: number;
	processed: number;
	attributed: number | null;
	purchase_collection_instances: number;
	unique_orders: number;
	reconciliation: {
		gross_merchandise_amount_idr: number;
		refunded_merchandise_amount_idr: number;
		net_merchandise_amount_idr: number;
		dispatched_purchase_signal_amount_idr: number;
		eligible_purchase_signal_amount_idr: number;
		suppressed_purchase_signal_amount_idr: number;
		net_signal_merchandise_amount_idr: number;
	};
	missing_identity: {
		orders_without_visitor_session: number;
		orders_without_consent: number;
		expired_outbox_events: number;
		total_suppressed_or_missing: number;
	};
}

const WORKSPACE_LABELS: Record<
	CanonicalWorkspace,
	{ title: string; subtitle: string }
> = {
	owner: {
		title: "Ruang Kerja Pemilik (Owner)",
		subtitle:
			"Ringkasan lintas fungsi, tata kelola akses, kontribusi finansial, dan diagnostik sinyal iklan.",
	},
	ecommerce_admin: {
		title: "Ruang Kerja Admin E-Commerce",
		subtitle:
			"Katalog harga tetap Rp99.000, kesiapan publikasi, saldo stok, dan promosi ongkir.",
	},
	warehouse: {
		title: "Ruang Kerja Staf Gudang",
		subtitle:
			"Pemenuhan pesanan gudang terpilih, serah terima kurir, inspeksi retur, dan peringatan stok tanpa data uang pesanan utuh.",
	},
	customer_service: {
		title: "Ruang Kerja Layanan Pelanggan (CS)",
		subtitle:
			"Penanganan kendala pengiriman, persetujuan pengajuan retur, dan antrean percakapan pelanggan.",
	},
	finance: {
		title: "Ruang Kerja Staf Keuangan",
		subtitle:
			"Rekonsiliasi mutasi pembayaran/COD, pencairan pengembalian dana, kewajiban komisi afiliasi, dan kontribusi biaya diketahui.",
	},
};

const METRIC_LABELS: Record<string, string> = {
	orders_pending: "Pesanan Menunggu Tindak Lanjut",
	fulfillments_due: "Pemenuhan Gudang Jatuh Tempo",
	delivery_exceptions: "Kendala Pengiriman Aktif",
	returns_pending: "Pengajuan Retur Menunggu",
	stock_alerts: "Peringatan Stok Gudang",
	support_unassigned: "Percakapan Belum Ditugaskan",
	finance_unmatched: "Mutasi Belum Direkonsiliasi",
	cod_receivable: "Piutang COD Berjalan",
	refund_liability: "Kewajiban Pengembalian Dana",
	affiliate_liability: "Kewajiban Komisi Afiliasi",
	estimated_contribution: "Estimasi Kontribusi Margin",
	realized_contribution: "Kontribusi Margin Terealisasi",
	net_merchandise_revenue: "Pendapatan Bersih Barang Dagangan",
};

const QUEUE_LABELS: Record<QueueKey, string> = {
	orders: "Antrean Pesanan",
	fulfillments: "Antrean Pemenuhan Gudang",
	delivery_exceptions: "Antrean Kendala Pengiriman",
	returns: "Antrean Retur & Penukaran",
	inventory: "Antrean Peringatan Stok",
	support: "Antrean Layanan Pelanggan",
	reconciliation: "Antrean Rekonsiliasi Keuangan",
};

const WORKSPACE_DEFAULT_QUEUE: Record<CanonicalWorkspace, QueueKey> = {
	owner: "orders",
	ecommerce_admin: "orders",
	warehouse: "fulfillments",
	customer_service: "support",
	finance: "reconciliation",
};

const WORKSPACE_ALLOWED_QUEUES: Record<CanonicalWorkspace, QueueKey[]> = {
	owner: [
		"orders",
		"fulfillments",
		"delivery_exceptions",
		"returns",
		"inventory",
		"support",
		"reconciliation",
	],
	ecommerce_admin: [
		"orders",
		"fulfillments",
		"delivery_exceptions",
		"returns",
		"inventory",
	],
	warehouse: ["fulfillments", "delivery_exceptions", "returns", "inventory"],
	customer_service: ["orders", "delivery_exceptions", "returns", "support"],
	finance: ["reconciliation", "orders", "returns"],
};

const QUEUE_EXPORT_CONFIG: Partial<
	Record<QueueKey, { resource: string; columnSet: string }>
> = {
	orders: { resource: "orders", columnSet: "order_service" },
	fulfillments: { resource: "fulfillments", columnSet: "warehouse_operations" },
	inventory: { resource: "inventory", columnSet: "inventory_operations" },
	returns: { resource: "returns", columnSet: "return_service" },
	reconciliation: {
		resource: "reconciliation",
		columnSet: "finance_reconciliation",
	},
};

function formatIdr(amount: number | null | undefined): string {
	if (amount === null || amount === undefined)
		return "Belum Lengkap (Sumber Biaya Tidak Diketahui)";
	return new Intl.NumberFormat("id-ID", {
		style: "currency",
		currency: "IDR",
		maximumFractionDigits: 0,
	}).format(amount);
}

function normalizeWorkspaceParam(
	raw: string | null,
): CanonicalWorkspace | null {
	if (!raw) return null;
	const map: Record<string, CanonicalWorkspace> = {
		owner: "owner",
		ecommerce_admin: "ecommerce_admin",
		warehouse: "warehouse",
		warehouse_staff: "warehouse",
		customer_service: "customer_service",
		cs_staff: "customer_service",
		finance: "finance",
		finance_staff: "finance",
	};
	return map[raw] ?? null;
}

export default function AdminWorkspacesPage() {
	const [grantedRoles, setGrantedRoles] = useState<CanonicalWorkspace[]>([
		"owner",
	]);
	const [activeWorkspace, setActiveWorkspace] =
		useState<CanonicalWorkspace>("owner");
	const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>("");
	const [windowRange, setWindowRange] = useState<string>("30d");
	const [dashboard, setDashboard] = useState<DashboardSnapshot | null>(null);
	const [activeQueue, setActiveQueue] = useState<QueueKey>("orders");
	const [activeFilterToken, setActiveFilterToken] = useState<string | null>(
		null,
	);
	const [activeMetricKey, setActiveMetricKey] = useState<string | null>(null);
	const [queueRows, setQueueRows] = useState<WorkQueueItem[]>([]);
	const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
	const [exportSnapshot, setExportSnapshot] = useState<{
		filter_token: string;
		filter_version: number;
		row_count: number;
		as_of: string;
	} | null>(null);
	const [exportReason, setExportReason] = useState<string>(
		"Rekap operasional harian terjadwal",
	);
	const [csvPreview, setCsvPreview] = useState<string | null>(null);
	const [destinations, setDestinations] = useState<AdDestinationItem[]>([]);
	const [replayEventId, setReplayEventId] = useState<string>("");
	const [statusBanner, setStatusBanner] = useState<{
		kind: "info" | "error";
		message: string;
	} | null>(null);
	const [loading, setLoading] = useState<boolean>(true);

	const loadWorkspaceData = useCallback(
		async (
			ws: CanonicalWorkspace,
			whId: string,
			win: string,
			queueOverride?: QueueKey,
			filterTokenOverride?: string | null,
		) => {
			setLoading(true);
			try {
				const dashParams = new URLSearchParams({ workspace: ws, window: win });
				if (whId) dashParams.set("warehouse_id", whId);
				const dashRes = await fetch(
					`/api/v1/admin/dashboard?${dashParams.toString()}`,
					{
						credentials: "include",
						cache: "no-store",
					},
				);
				if (dashRes.ok) {
					const dashData = (await dashRes.json()) as DashboardSnapshot;
					setDashboard(dashData);
				} else {
					setDashboard(null);
				}

				const targetQueue = queueOverride ?? WORKSPACE_DEFAULT_QUEUE[ws];
				const qParams = new URLSearchParams({
					workspace: ws,
					queue: targetQueue,
					window: win,
				});
				if (whId) qParams.set("warehouse_id", whId);
				if (filterTokenOverride)
					qParams.set("filter_token", filterTokenOverride);
				const qRes = await fetch(
					`/api/v1/admin/work-queues?${qParams.toString()}`,
					{
						credentials: "include",
						cache: "no-store",
					},
				);
				if (qRes.ok) {
					const qData = (await qRes.json()) as { data: WorkQueueItem[] };
					setQueueRows(qData.data ?? []);
				} else {
					setQueueRows([]);
				}

				if (ws === "owner") {
					const adRes = await fetch("/api/v1/admin/advertising/destinations", {
						credentials: "include",
						cache: "no-store",
					});
					if (adRes.ok) {
						const adData = (await adRes.json()) as {
							data: AdDestinationItem[];
						};
						setDestinations(adData.data ?? []);
					}
				} else {
					setDestinations([]);
				}
			} catch {
				setStatusBanner({
					kind: "error",
					message: "Gagal memuat ringkasan operasional dari server lokal.",
				});
			} finally {
				setLoading(false);
			}
		},
		[],
	);

	useEffect(() => {
		let mounted = true;
		(async () => {
			const search =
				typeof window !== "undefined"
					? new URLSearchParams(window.location.search)
					: null;
			const requestedWs = normalizeWorkspaceParam(
				search?.get("workspace") ?? null,
			);
			const requestedWh = search?.get("warehouse_id") ?? "";

			let resolvedWs: CanonicalWorkspace = requestedWs ?? "owner";
			try {
				const meRes = await fetch("/api/v1/me", {
					credentials: "include",
					cache: "no-store",
				});
				if (meRes.ok) {
					const me = (await meRes.json()) as {
						roles?: string[];
						warehouse_ids?: string[];
					};
					const staffRoles = (me.roles ?? []).filter(
						(r): r is CanonicalWorkspace =>
							[
								"owner",
								"ecommerce_admin",
								"warehouse",
								"customer_service",
								"finance",
							].includes(r),
					);
					if (staffRoles.length > 0 && mounted) {
						setGrantedRoles(
							staffRoles.includes("owner")
								? [
										"owner",
										"ecommerce_admin",
										"warehouse",
										"customer_service",
										"finance",
									]
								: staffRoles,
						);
						if (
							!requestedWs ||
							(!staffRoles.includes(requestedWs) &&
								!staffRoles.includes("owner"))
						) {
							resolvedWs = staffRoles[0];
						}
					}
				}
			} catch {
				// Fallback to requested workspace for local preview
			}

			if (!mounted) return;
			const defaultQueue = WORKSPACE_DEFAULT_QUEUE[resolvedWs];
			setActiveWorkspace(resolvedWs);
			setSelectedWarehouseId(requestedWh);
			setActiveQueue(defaultQueue);
			await loadWorkspaceData(
				resolvedWs,
				requestedWh,
				"30d",
				defaultQueue,
				null,
			);
		})();
		return () => {
			mounted = false;
		};
	}, [loadWorkspaceData]);

	const handleSwitchWorkspace = async (nextWs: CanonicalWorkspace) => {
		const nextQueue = WORKSPACE_DEFAULT_QUEUE[nextWs];
		setActiveWorkspace(nextWs);
		setActiveQueue(nextQueue);
		setActiveFilterToken(null);
		setActiveMetricKey(null);
		setSelectedRowIds([]);
		setExportSnapshot(null);
		setCsvPreview(null);
		await loadWorkspaceData(
			nextWs,
			selectedWarehouseId,
			windowRange,
			nextQueue,
			null,
		);
	};

	const handleMetricDrilldown = async (metric: DashboardMetric) => {
		setActiveQueue(metric.queue_key);
		setActiveFilterToken(metric.queue_filter_token);
		setActiveMetricKey(metric.key);
		setSelectedRowIds([]);
		setExportSnapshot(null);
		await loadWorkspaceData(
			activeWorkspace,
			selectedWarehouseId,
			windowRange,
			metric.queue_key,
			metric.queue_filter_token,
		);
		setStatusBanner({
			kind: "info",
			message: `Menampilkan rincian antrean untuk metrik "${METRIC_LABELS[metric.key] ?? metric.key}" dengan token filter terikat.`,
		});
	};

	const handleToggleRow = (id: string) => {
		setSelectedRowIds((prev) =>
			prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
		);
	};

	const handleFreezeSelection = async () => {
		const cfg = QUEUE_EXPORT_CONFIG[activeQueue];
		if (!cfg) {
			setStatusBanner({
				kind: "error",
				message: "Antrean ini tidak mendukung ekspor CSV langsung.",
			});
			return;
		}
		try {
			const now = new Date();
			const from =
				dashboard?.from ??
				new Date(now.getTime() - 30 * 86400_000).toISOString();
			const to =
				dashboard?.to ?? new Date(now.getTime() + 60_000).toISOString();
			const res = await fetch("/api/v1/admin/export-selections", {
				method: "POST",
				credentials: "include",
				headers: {
					"Content-Type": "application/json",
					"Idempotency-Key": crypto.randomUUID(),
				},
				body: JSON.stringify({
					resource: cfg.resource,
					warehouse_id: selectedWarehouseId || null,
					from,
					to,
					statuses: [],
					max_rows: 1000,
					...(selectedRowIds.length > 0
						? { resource_ids: selectedRowIds }
						: {}),
				}),
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({ code: "EXPORT_FAILED" }));
				setStatusBanner({
					kind: "error",
					message: `Gagal membekukan pilihan ekspor (${res.status}: ${err.code ?? "ERROR"}).`,
				});
				return;
			}
			const snap = await res.json();
			setExportSnapshot(snap);
			setStatusBanner({
				kind: "info",
				message: `Pilihan ekspor berhasil dibekukan (${snap.row_count} baris, versi filter v${snap.filter_version}).`,
			});
		} catch {
			setStatusBanner({
				kind: "error",
				message: "Gagal menghubungi layanan pembekuan ekspor.",
			});
		}
	};

	const handleDownloadCsv = async () => {
		const cfg = QUEUE_EXPORT_CONFIG[activeQueue];
		if (!cfg) return;
		const selectionPayload = exportSnapshot
			? {
					mode: "filtered_snapshot",
					filter_token: exportSnapshot.filter_token,
					filter_version: exportSnapshot.filter_version,
				}
			: {
					mode: "explicit_page",
					resource_ids: selectedRowIds,
				};
		try {
			const res = await fetch("/api/v1/admin/exports", {
				method: "POST",
				credentials: "include",
				headers: {
					"Content-Type": "application/json",
					"Idempotency-Key": crypto.randomUUID(),
				},
				body: JSON.stringify({
					resource: cfg.resource,
					column_set: cfg.columnSet,
					reason: exportReason,
					selection: selectionPayload,
				}),
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({ code: "EXPORT_DENIED" }));
				setStatusBanner({
					kind: "error",
					message: `Ekspor CSV ditolak (${res.status}: ${err.code ?? "FORBIDDEN"}).`,
				});
				return;
			}
			const csvText = await res.text();
			setCsvPreview(csvText);
			setStatusBanner({
				kind: "info",
				message: `Ekspor CSV "${cfg.resource}-${cfg.columnSet}.csv" berhasil dibuat dengan perlindungan injeksi formula.`,
			});
		} catch {
			setStatusBanner({
				kind: "error",
				message: "Gagal mengunduh ekspor CSV.",
			});
		}
	};

	const handleTogglePauseDestination = async (dest: AdDestinationItem) => {
		const endpoint = `/api/v1/admin/advertising/destinations/${dest.platform}/pause`;
		try {
			const res = await fetch(endpoint, {
				method: "POST",
				credentials: "include",
				headers: {
					"Content-Type": "application/json",
					"Idempotency-Key": crypto.randomUUID(),
				},
				body: JSON.stringify({
					expected_version: dest.version,
					paused: !dest.paused,
					reason: dest.paused
						? `Melanjutkan pengiriman sinyal ${dest.platform.toUpperCase()} dari konsol pemilik.`
						: `Menjeda pengiriman sinyal ${dest.platform.toUpperCase()} untuk pemeliharaan.`,
				}),
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({ code: "CONFLICT" }));
				setStatusBanner({
					kind: "error",
					message: `Gagal memperbarui status tujuan iklan (${res.status}: ${err.code ?? "ERROR"}).`,
				});
				return;
			}
			const updated = (await res.json()) as AdDestinationItem;
			setDestinations((prev) =>
				prev.map((d) => (d.platform === updated.platform ? updated : d)),
			);
			setStatusBanner({
				kind: "info",
				message: `Tujuan iklan ${updated.platform.toUpperCase()} diperbarui ke revisi v${updated.version} (${updated.paused ? "Dijeda" : "Aktif"}).`,
			});
		} catch {
			setStatusBanner({
				kind: "error",
				message: "Gagal memperbarui status jeda tujuan iklan.",
			});
		}
	};

	const handleReplayEvent = async (dest: AdDestinationItem) => {
		if (!replayEventId.trim()) {
			setStatusBanner({
				kind: "error",
				message: "Masukkan UUID event_id untuk pengiriman ulang terkontrol.",
			});
			return;
		}
		try {
			const res = await fetch(
				`/api/v1/admin/advertising/destinations/${dest.platform}/replays`,
				{
					method: "POST",
					credentials: "include",
					headers: {
						"Content-Type": "application/json",
						"Idempotency-Key": crypto.randomUUID(),
					},
					body: JSON.stringify({
						expected_version: dest.version,
						event_id: replayEventId.trim(),
						reason:
							"Pengiriman ulang terkontrol oleh pemilik setelah pemulihan antrean.",
					}),
				},
			);
			if (!res.ok) {
				const err = await res.json().catch(() => ({ code: "REPLAY_REJECTED" }));
				setStatusBanner({
					kind: "error",
					message: `Replay ditolak (${res.status}: ${err.code ?? "CONFLICT"}).`,
				});
				return;
			}
			const result = await res.json();
			setStatusBanner({
				kind: "info",
				message: `Replay kejadian ${result.event_id} berhasil dijalankan (operasi: ${result.operation_id}).`,
			});
			await loadWorkspaceData(
				activeWorkspace,
				selectedWarehouseId,
				windowRange,
				activeQueue,
				activeFilterToken,
			);
		} catch {
			setStatusBanner({
				kind: "error",
				message: "Gagal menjalankan pengiriman ulang sinyal iklan.",
			});
		}
	};

	const visibleMetrics = useMemo(() => {
		if (dashboard?.metrics?.length) return dashboard.metrics;
		// Fallback metrics structure when unauthenticated in static preview
		if (activeWorkspace === "warehouse") {
			return [
				{
					key: "fulfillments_due",
					count: 0,
					basis: "event_period" as const,
					complete: true,
					queue_key: "fulfillments" as const,
					kind: "count" as const,
					amount: null,
					currency: null,
					financial_basis: "not_applicable" as const,
					definition:
						"Pemenuhan gudang yang siap dikemas atau diserahkan ke kurir.",
					as_of: new Date().toISOString(),
					queue_filter_token: "preview-token-warehouse-fulfillments",
					filter_version: 1,
					filter_expires_at: new Date(Date.now() + 1800_000).toISOString(),
				},
				{
					key: "stock_alerts",
					count: 0,
					basis: "snapshot" as const,
					complete: true,
					queue_key: "inventory" as const,
					kind: "count" as const,
					amount: null,
					currency: null,
					financial_basis: "not_applicable" as const,
					definition:
						"Saldo stok gudang yang mencapai batas stok rendah atau dikarantina.",
					as_of: new Date().toISOString(),
					queue_filter_token: "preview-token-warehouse-inventory",
					filter_version: 1,
					filter_expires_at: new Date(Date.now() + 1800_000).toISOString(),
				},
			];
		}
		return [];
	}, [dashboard, activeWorkspace]);

	const canSeeMoneyMetrics =
		activeWorkspace === "owner" || activeWorkspace === "finance";
	const canSeeCatalogPanel =
		activeWorkspace === "owner" || activeWorkspace === "ecommerce_admin";
	const canSeeWarehousePanel =
		activeWorkspace === "owner" ||
		activeWorkspace === "warehouse" ||
		activeWorkspace === "ecommerce_admin";
	const canSeeCsPanel =
		activeWorkspace === "owner" || activeWorkspace === "customer_service";
	const canSeeFinancePanel =
		activeWorkspace === "owner" || activeWorkspace === "finance";
	const canSeeOwnerAccessPanel = activeWorkspace === "owner";
	const canSeeOwnerAdvertisingPanel = activeWorkspace === "owner";

	return (
		<main
			data-testid="admin-workspaces-root"
			style={{
				maxWidth: "100%",
				overflowX: "hidden",
				minHeight: "100vh",
				backgroundColor: "#f8fafc",
				color: "#0f172a",
				fontFamily: "system-ui, -apple-system, sans-serif",
				padding: "clamp(12px, 2.5vw, 28px)",
				boxSizing: "border-box",
			}}
		>
			{/* Header & Workspace Role Switcher */}
			<header
				style={{
					display: "flex",
					flexDirection: "column",
					gap: "12px",
					borderBottom: "1px solid #e2e8f0",
					paddingBottom: "16px",
					marginBottom: "20px",
				}}
			>
				<div
					style={{
						display: "flex",
						flexWrap: "wrap",
						alignItems: "center",
						justifyContent: "space-between",
						gap: "8px",
					}}
				>
					<div style={{ minWidth: 0 }}>
						<span
							style={{
								display: "inline-block",
								fontSize: "12px",
								fontWeight: 700,
								textTransform: "uppercase",
								letterSpacing: "0.05em",
								color: "#047857",
								backgroundColor: "#d1fae5",
								padding: "4px 8px",
								borderRadius: "4px",
								marginBottom: "6px",
							}}
						>
							Konsol Operasional Serba Rp99.000
						</span>
						<h1
							data-testid="workspace-heading"
							style={{
								fontSize: "clamp(1.25rem, 3vw, 1.75rem)",
								fontWeight: 700,
								margin: 0,
								lineHeight: 1.25,
								wordBreak: "break-word",
							}}
						>
							{WORKSPACE_LABELS[activeWorkspace].title}
						</h1>
						<p
							style={{
								fontSize: "0.875rem",
								color: "#475569",
								margin: "4px 0 0 0",
								lineHeight: 1.4,
								wordBreak: "break-word",
							}}
						>
							{WORKSPACE_LABELS[activeWorkspace].subtitle}
						</p>
					</div>

					<div
						style={{
							display: "flex",
							flexWrap: "wrap",
							gap: "8px",
							alignItems: "center",
						}}
					>
						<label
							style={{
								fontSize: "0.8125rem",
								color: "#334155",
								display: "flex",
								alignItems: "center",
								gap: "6px",
							}}
						>
							<span>Jendela:</span>
							<select
								data-testid="window-select"
								value={windowRange}
								onChange={(e) => {
									const nextWin = e.target.value;
									setWindowRange(nextWin);
									void loadWorkspaceData(
										activeWorkspace,
										selectedWarehouseId,
										nextWin,
										activeQueue,
										null,
									);
								}}
								style={{
									padding: "6px 8px",
									borderRadius: "6px",
									border: "1px solid #cbd5e1",
									backgroundColor: "#ffffff",
									fontSize: "0.8125rem",
								}}
							>
								<option value="7d">7 Hari Terakhir</option>
								<option value="30d">30 Hari Terakhir</option>
								<option value="90d">90 Hari Terakhir</option>
							</select>
						</label>
					</div>
				</div>

				{/* Role Workspace Tabs */}
				<nav
					aria-label="Pilihan Ruang Kerja Peran"
					data-testid="role-workspace-switcher"
					style={{
						display: "flex",
						flexWrap: "wrap",
						gap: "6px",
					}}
				>
					{(
						[
							"owner",
							"ecommerce_admin",
							"warehouse",
							"customer_service",
							"finance",
						] as CanonicalWorkspace[]
					)
						.filter(
							(role) =>
								grantedRoles.includes(role) || grantedRoles.includes("owner"),
						)
						.map((role) => {
							const isActive = activeWorkspace === role;
							const shortLabel: Record<CanonicalWorkspace, string> = {
								owner: "Pemilik (Owner)",
								ecommerce_admin: "Admin E-Commerce",
								warehouse: "Staf Gudang",
								customer_service: "Layanan Pelanggan (CS)",
								finance: "Staf Keuangan",
							};
							return (
								<button
									key={role}
									type="button"
									data-testid={`workspace-tab-${role}`}
									aria-pressed={isActive}
									onClick={() => void handleSwitchWorkspace(role)}
									style={{
										padding: "8px 12px",
										borderRadius: "6px",
										border: isActive
											? "1px solid #0f172a"
											: "1px solid #cbd5e1",
										backgroundColor: isActive ? "#0f172a" : "#ffffff",
										color: isActive ? "#ffffff" : "#1e293b",
										fontSize: "0.8125rem",
										fontWeight: 600,
										cursor: "pointer",
										maxWidth: "100%",
									}}
								>
									{shortLabel[role]}
								</button>
							);
						})}
				</nav>
			</header>

			{/* Status Banner */}
			{statusBanner && (
				<div
					role="status"
					data-testid="workspace-status-banner"
					style={{
						padding: "10px 14px",
						borderRadius: "8px",
						marginBottom: "16px",
						backgroundColor:
							statusBanner.kind === "error" ? "#fef2f2" : "#ecfdf5",
						border:
							statusBanner.kind === "error"
								? "1px solid #fecaca"
								: "1px solid #a7f3d0",
						color: statusBanner.kind === "error" ? "#991b1b" : "#065f46",
						fontSize: "0.875rem",
						wordBreak: "break-word",
					}}
				>
					{statusBanner.message}
				</div>
			)}

			{/* Section 1: Role-Scoped KPI Cards & Drilldowns */}
			<section
				aria-labelledby="kpi-section-heading"
				style={{ marginBottom: "24px" }}
			>
				<div
					style={{
						display: "flex",
						flexWrap: "wrap",
						justifyContent: "space-between",
						alignItems: "center",
						gap: "8px",
						marginBottom: "12px",
					}}
				>
					<h2
						id="kpi-section-heading"
						style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}
					>
						Indikator Kinerja Operasional (KPI) &amp; Telusur Antrean
					</h2>
					<span style={{ fontSize: "0.75rem", color: "#64748b" }}>
						Basis Waktu: {dashboard?.timezone ?? "Asia/Jakarta"} • Cakupan
						Gudang:{" "}
						{dashboard?.warehouse_ids?.length
							? `${dashboard.warehouse_ids.length} gudang aktif`
							: "Terbatas Peran"}
					</span>
				</div>

				<div
					data-testid="kpi-cards-grid"
					style={{
						display: "grid",
						gridTemplateColumns:
							"repeat(auto-fit, minmax(min(100%, 240px), 1fr))",
						gap: "12px",
					}}
				>
					{visibleMetrics.map((metric) => {
						const isSelected = activeMetricKey === metric.key;
						const isMoney = metric.kind === "money";
						// Enforce UI boundary: non-finance/non-owner never sees money metrics
						if (isMoney && !canSeeMoneyMetrics) return null;

						return (
							<div
								key={metric.key}
								data-testid={`kpi-card-${metric.key}`}
								style={{
									backgroundColor: "#ffffff",
									border: isSelected
										? "2px solid #047857"
										: "1px solid #e2e8f0",
									borderRadius: "10px",
									padding: "14px",
									display: "flex",
									flexDirection: "column",
									justifyContent: "space-between",
									gap: "10px",
									boxSizing: "border-box",
								}}
							>
								<div>
									<div
										style={{
											display: "flex",
											justifyContent: "space-between",
											alignItems: "flex-start",
											gap: "6px",
										}}
									>
										<span
											style={{
												fontSize: "0.8125rem",
												fontWeight: 600,
												color: "#334155",
											}}
										>
											{METRIC_LABELS[metric.key] ?? metric.key}
										</span>
										<span
											style={{
												fontSize: "0.6875rem",
												padding: "2px 6px",
												borderRadius: "4px",
												backgroundColor: metric.complete
													? "#f1f5f9"
													: "#fef3c7",
												color: metric.complete ? "#475569" : "#92400e",
												fontWeight: 600,
											}}
										>
											{metric.complete
												? isMoney
													? metric.financial_basis
													: "Lengkap"
												: "Sumber Biaya Belum Lengkap"}
										</span>
									</div>

									<div
										data-testid={`kpi-value-${metric.key}`}
										style={{
											fontSize: "1.25rem",
											fontWeight: 700,
											marginTop: "8px",
											color: !metric.complete ? "#b45309" : "#0f172a",
											wordBreak: "break-word",
										}}
									>
										{isMoney
											? formatIdr(metric.complete ? metric.amount : null)
											: `${metric.count ?? 0} item`}
									</div>

									<p
										style={{
											fontSize: "0.75rem",
											color: "#64748b",
											margin: "6px 0 0 0",
											lineHeight: 1.35,
										}}
									>
										{metric.definition}
									</p>
								</div>

								<button
									type="button"
									data-testid={`kpi-drilldown-${metric.key}`}
									onClick={() => void handleMetricDrilldown(metric)}
									style={{
										alignSelf: "flex-start",
										padding: "6px 10px",
										borderRadius: "6px",
										border: "1px solid #cbd5e1",
										backgroundColor: "#f8fafc",
										color: "#0f172a",
										fontSize: "0.75rem",
										fontWeight: 600,
										cursor: "pointer",
									}}
								>
									Telusuri {QUEUE_LABELS[metric.queue_key]} →
								</button>
							</div>
						);
					})}
				</div>
			</section>

			{/* Section 2: Role-Scoped Work Queue & S53 Bounded Preview / CSV Export */}
			<section
				aria-labelledby="work-queue-heading"
				data-testid="work-queue-section"
				style={{
					backgroundColor: "#ffffff",
					border: "1px solid #e2e8f0",
					borderRadius: "10px",
					padding: "16px",
					marginBottom: "24px",
					boxSizing: "border-box",
				}}
			>
				<div
					style={{
						display: "flex",
						flexWrap: "wrap",
						justifyContent: "space-between",
						alignItems: "center",
						gap: "10px",
						marginBottom: "14px",
					}}
				>
					<div>
						<h2
							id="work-queue-heading"
							style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}
						>
							{QUEUE_LABELS[activeQueue]} ({queueRows.length} baris)
						</h2>
						{activeFilterToken && (
							<span
								data-testid="active-drilldown-badge"
								style={{
									display: "inline-block",
									marginTop: "4px",
									fontSize: "0.75rem",
									color: "#047857",
									fontWeight: 600,
								}}
							>
								Filter KPI Terkunci Aktif ({activeMetricKey})
							</span>
						)}
					</div>

					<div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
						{WORKSPACE_ALLOWED_QUEUES[activeWorkspace].map((q) => (
							<button
								key={q}
								type="button"
								data-testid={`queue-tab-${q}`}
								onClick={() => {
									setActiveQueue(q);
									setActiveFilterToken(null);
									setActiveMetricKey(null);
									void loadWorkspaceData(
										activeWorkspace,
										selectedWarehouseId,
										windowRange,
										q,
										null,
									);
								}}
								style={{
									padding: "6px 10px",
									borderRadius: "6px",
									border:
										activeQueue === q
											? "1px solid #047857"
											: "1px solid #cbd5e1",
									backgroundColor: activeQueue === q ? "#ecfdf5" : "#ffffff",
									color: activeQueue === q ? "#065f46" : "#334155",
									fontSize: "0.75rem",
									fontWeight: 600,
									cursor: "pointer",
								}}
							>
								{QUEUE_LABELS[q]}
							</button>
						))}
					</div>
				</div>

				{/* S53 Bulk Selection Preview & Bounded CSV Export Bar */}
				{QUEUE_EXPORT_CONFIG[activeQueue] && (
					<div
						data-testid="export-controls-bar"
						style={{
							backgroundColor: "#f8fafc",
							border: "1px solid #e2e8f0",
							borderRadius: "8px",
							padding: "12px",
							marginBottom: "14px",
							display: "flex",
							flexWrap: "wrap",
							alignItems: "center",
							justifyContent: "space-between",
							gap: "10px",
						}}
					>
						<div
							style={{
								display: "flex",
								flexWrap: "wrap",
								alignItems: "center",
								gap: "8px",
								flex: "1 1 240px",
							}}
						>
							<span style={{ fontSize: "0.8125rem", fontWeight: 600 }}>
								Pratinjau Massal &amp; Ekspor CSV Terbatas (Maks 1.000 Baris):
							</span>
							<input
								type="text"
								aria-label="Alasan Ekspor CSV"
								data-testid="export-reason-input"
								value={exportReason}
								onChange={(e) => setExportReason(e.target.value)}
								placeholder="Alasan audit ekspor CSV..."
								style={{
									padding: "6px 10px",
									borderRadius: "6px",
									border: "1px solid #cbd5e1",
									fontSize: "0.8125rem",
									minWidth: "180px",
									maxWidth: "100%",
									flex: "1 1 180px",
								}}
							/>
						</div>

						<div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
							<button
								type="button"
								data-testid="freeze-export-selection-btn"
								onClick={() => void handleFreezeSelection()}
								style={{
									padding: "7px 12px",
									borderRadius: "6px",
									border: "1px solid #0f172a",
									backgroundColor: "#ffffff",
									color: "#0f172a",
									fontSize: "0.75rem",
									fontWeight: 600,
									cursor: "pointer",
								}}
							>
								Bekukan Pilihan Ekspor (
								{selectedRowIds.length > 0
									? `${selectedRowIds.length} dipilih`
									: "Semua Filter"}
								)
							</button>

							<button
								type="button"
								data-testid="download-csv-btn"
								onClick={() => void handleDownloadCsv()}
								style={{
									padding: "7px 12px",
									borderRadius: "6px",
									border: "1px solid #047857",
									backgroundColor: "#047857",
									color: "#ffffff",
									fontSize: "0.75rem",
									fontWeight: 600,
									cursor: "pointer",
								}}
							>
								Unduh CSV Aman
							</button>
						</div>
					</div>
				)}

				{exportSnapshot && (
					<div
						data-testid="frozen-selection-preview"
						style={{
							fontSize: "0.75rem",
							color: "#065f46",
							backgroundColor: "#ecfdf5",
							padding: "8px 12px",
							borderRadius: "6px",
							marginBottom: "12px",
							wordBreak: "break-word",
						}}
					>
						Snapshot Ekspor Terkunci:{" "}
						<strong>{exportSnapshot.row_count} baris</strong> • Versi Filter:{" "}
						<strong>v{exportSnapshot.filter_version}</strong> • As-Of:{" "}
						{exportSnapshot.as_of}
					</div>
				)}

				{csvPreview && (
					<pre
						data-testid="csv-export-preview"
						style={{
							fontSize: "0.75rem",
							backgroundColor: "#0f172a",
							color: "#f8fafc",
							padding: "10px",
							borderRadius: "6px",
							overflowX: "auto",
							maxWidth: "100%",
							marginBottom: "12px",
						}}
					>
						{csvPreview}
					</pre>
				)}

				{/* Queue Rows List */}
				{loading ? (
					<p style={{ fontSize: "0.875rem", color: "#64748b" }}>
						Memuat data antrean kerja...
					</p>
				) : queueRows.length === 0 ? (
					<p
						data-testid="empty-queue-message"
						style={{ fontSize: "0.875rem", color: "#64748b", margin: "8px 0" }}
					>
						Tidak ada item antrean dalam jendela waktu dan cakupan gudang ini.
					</p>
				) : (
					<div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
						{queueRows.map((item) => (
							<div
								key={item.id}
								data-testid={`queue-row-${item.id}`}
								style={{
									display: "flex",
									flexWrap: "wrap",
									alignItems: "center",
									justifyContent: "space-between",
									gap: "8px",
									padding: "10px 12px",
									borderRadius: "8px",
									border: "1px solid #e2e8f0",
									backgroundColor: "#fcfcfd",
								}}
							>
								<label
									style={{
										display: "flex",
										alignItems: "center",
										gap: "8px",
										fontSize: "0.8125rem",
										fontWeight: 600,
										wordBreak: "break-all",
									}}
								>
									<input
										type="checkbox"
										checked={selectedRowIds.includes(item.id)}
										onChange={() => handleToggleRow(item.id)}
									/>
									<span>{item.resource_kind.toUpperCase()}</span>
									<code style={{ fontSize: "0.75rem", color: "#475569" }}>
										{item.id}
									</code>
								</label>

								<div
									style={{
										display: "flex",
										flexWrap: "wrap",
										gap: "8px",
										fontSize: "0.75rem",
										color: "#334155",
									}}
								>
									<span>
										Status: <strong>{item.state}</strong>
									</span>
									<span>Revisi: v{item.version}</span>
									{item.warehouse_id && (
										<span>Gudang: {item.warehouse_id.slice(0, 8)}</span>
									)}
								</div>
							</div>
						))}
					</div>
				)}
			</section>

			{/* Section 3: Domain Operational Modules Scoped by Role */}
			<div
				style={{
					display: "grid",
					gridTemplateColumns:
						"repeat(auto-fit, minmax(min(100%, 300px), 1fr))",
					gap: "16px",
					marginBottom: "24px",
				}}
			>
				{/* S49: Catalog, Cost, Publication, Stock & Promotions */}
				{canSeeCatalogPanel && (
					<section
						data-testid="panel-s49-catalog"
						style={{
							backgroundColor: "#ffffff",
							border: "1px solid #e2e8f0",
							borderRadius: "10px",
							padding: "16px",
						}}
					>
						<h3
							style={{ fontSize: "1rem", fontWeight: 700, margin: "0 0 8px 0" }}
						>
							Manajemen Katalog Rp99.000, Biaya Komponen &amp; Publikasi (S49)
						</h3>
						<p
							style={{
								fontSize: "0.8125rem",
								color: "#475569",
								margin: "0 0 12px 0",
								lineHeight: 1.4,
							}}
						>
							Setiap draf produk divalidasi pada harga tetap Rp99.000. Publikasi
							otomatis menolak penawaran dengan sumber biaya komponen yang belum
							diketahui atau kontribusi negatif tanpa bukti otorisasi pemilik.
						</p>
						<ul
							style={{
								fontSize: "0.8125rem",
								color: "#334155",
								paddingLeft: "18px",
								margin: 0,
								lineHeight: 1.6,
							}}
						>
							<li>Draf Produk &amp; Varian SKU Fisik Terikat Gudang</li>
							<li>
								Versi Biaya Komponen &amp; Asumsi Biaya Penawaran (Kemasan,
								Biaya Penyedia, Cadangan Retur)
							</li>
							<li>
								Gerbang Publikasi (Publication Gate) &amp; Promosi Subsidi
								Ongkir
							</li>
						</ul>
					</section>
				)}

				{/* S50: Warehouse Fulfillment, Returns, Replacements & Delivery Exceptions */}
				{canSeeWarehousePanel && (
					<section
						data-testid="panel-s50-warehouse"
						style={{
							backgroundColor: "#ffffff",
							border: "1px solid #e2e8f0",
							borderRadius: "10px",
							padding: "16px",
						}}
					>
						<h3
							style={{ fontSize: "1rem", fontWeight: 700, margin: "0 0 8px 0" }}
						>
							Operasional Pemenuhan Gudang, Retur &amp; Kendala Kirim (S50)
						</h3>
						<p
							style={{
								fontSize: "0.8125rem",
								color: "#475569",
								margin: "0 0 12px 0",
								lineHeight: 1.4,
							}}
						>
							Staf gudang hanya melihat paket pada gudang yang ditugaskan tanpa
							akses ke total uang pesanan utuh atau data pribadi pembeli di luar
							label pengiriman resmi.
						</p>
						<ul
							style={{
								fontSize: "0.8125rem",
								color: "#334155",
								paddingLeft: "18px",
								margin: 0,
								lineHeight: 1.6,
							}}
						>
							<li>
								Persiapan Paket, Pemesanan Resi Kurir &amp; Bukti Serah Terima
								(Handover)
							</li>
							<li>
								Inspeksi Fisik Barang Retur &amp; Pengiriman Pengganti
								(Zero-Charge Replacement)
							</li>
							<li>
								Penanganan Kendala Pengiriman &amp; Disposisi Stok Karantina
							</li>
						</ul>
					</section>
				)}

				{/* S50 CS: Support & Return Claims */}
				{canSeeCsPanel && (
					<section
						data-testid="panel-s50-cs"
						style={{
							backgroundColor: "#ffffff",
							border: "1px solid #e2e8f0",
							borderRadius: "10px",
							padding: "16px",
						}}
					>
						<h3
							style={{ fontSize: "1rem", fontWeight: 700, margin: "0 0 8px 0" }}
						>
							Layanan Pelanggan, Resolusi Kendala &amp; Persetujuan Retur (S50)
						</h3>
						<p
							style={{
								fontSize: "0.8125rem",
								color: "#475569",
								margin: "0 0 12px 0",
								lineHeight: 1.4,
							}}
						>
							Kelola percakapan bantuan pembeli, tinjau bukti retur, dan
							koordinasikan pengiriman ulang tanpa akses ke mutasi rekening bank
							atau kunci rahasia periklanan.
						</p>
						<a
							href="/admin/support"
							style={{
								display: "inline-block",
								fontSize: "0.8125rem",
								fontWeight: 600,
								color: "#047857",
								textDecoration: "underline",
							}}
						>
							Buka Ruang Kerja Bantuan Pelanggan (/admin/support) →
						</a>
					</section>
				)}

				{/* S51: Finance Reconciliation, Refunds, Affiliate Payouts & Order History */}
				{canSeeFinancePanel && (
					<section
						data-testid="panel-s51-finance"
						style={{
							backgroundColor: "#ffffff",
							border: "1px solid #e2e8f0",
							borderRadius: "10px",
							padding: "16px",
						}}
					>
						<h3
							style={{ fontSize: "1rem", fontWeight: 700, margin: "0 0 8px 0" }}
						>
							Rekonsiliasi Keuangan, Pengembalian Dana &amp; Pencairan Afiliasi
							(S51)
						</h3>
						<p
							style={{
								fontSize: "0.8125rem",
								color: "#475569",
								margin: "0 0 12px 0",
								lineHeight: 1.4,
							}}
						>
							Cocokkan laporan mutasi pembayaran/COD dengan penerimaan ekonomi
							terverifikasi. Pisahkan secara tegas antara nilai Rp 0 dan sumber
							biaya yang belum lengkap (unknown).
						</p>
						<ul
							style={{
								fontSize: "0.8125rem",
								color: "#334155",
								paddingLeft: "18px",
								margin: 0,
								lineHeight: 1.6,
							}}
						>
							<li>
								Rekonsiliasi Mutasi Penyedia Pembayaran &amp; Koleksi COD per
								Paket
							</li>
							<li>
								Eksekusi Pengembalian Dana (Refund) &amp; Pemulihan Pengecualian
								(Recovery Refund)
							</li>
							<li>Verifikasi Bukti Transfer Manual Komisi Afiliasi</li>
						</ul>
					</section>
				)}

				{/* S52: Owner Access, Role Grants, Policy Versions & Commission Rates */}
				{canSeeOwnerAccessPanel && (
					<section
						data-testid="panel-s52-access"
						style={{
							backgroundColor: "#ffffff",
							border: "1px solid #e2e8f0",
							borderRadius: "10px",
							padding: "16px",
						}}
					>
						<h3
							style={{ fontSize: "1rem", fontWeight: 700, margin: "0 0 8px 0" }}
						>
							Tata Kelola Akses Staf, Kebijakan Platform &amp; Komisi Afiliasi
							(S52)
						</h3>
						<p
							style={{
								fontSize: "0.8125rem",
								color: "#475569",
								margin: "0 0 12px 0",
								lineHeight: 1.4,
							}}
						>
							Perubahan hak akses staf, versi kebijakan (privasi, retur,
							pengiriman, afiliasi), dan suku komisi afiliasi prospektif
							mewajibkan sesi MFA aktif serta bukti autentikasi ulang
							(reauthentication proof).
						</p>
						<ul
							style={{
								fontSize: "0.8125rem",
								color: "#334155",
								paddingLeft: "18px",
								margin: 0,
								lineHeight: 1.6,
							}}
						>
							<li>
								Pemberian Peran Staf dengan Cakupan Gudang Eksplisit
								(/api/v1/admin/role-grants)
							</li>
							<li>
								Riwayat Versi Kebijakan Platform Abadi
								(/api/v1/admin/policy-versions)
							</li>
							<li>
								Penetapan Suku Komisi Afiliasi Prospektif
								(/api/v1/admin/affiliates/[id]/rates)
							</li>
						</ul>
					</section>
				)}
			</div>

			{/* Section 4: S60 Owner-Only Advertising Destination Diagnostics & Reconciliation */}
			{canSeeOwnerAdvertisingPanel && (
				<section
					aria-labelledby="ad-diagnostics-heading"
					data-testid="panel-s60-advertising"
					style={{
						backgroundColor: "#ffffff",
						border: "1px solid #e2e8f0",
						borderRadius: "10px",
						padding: "16px",
						boxSizing: "border-box",
					}}
				>
					<div style={{ marginBottom: "14px" }}>
						<h2
							id="ad-diagnostics-heading"
							style={{ fontSize: "1.1rem", fontWeight: 700, margin: 0 }}
						>
							Diagnostik Tujuan Iklan, Rekonsiliasi Uang-vs-Sinyal &amp; Replay
							Terkontrol (S60)
						</h2>
						<p
							style={{
								fontSize: "0.8125rem",
								color: "#475569",
								margin: "4px 0 0 0",
								lineHeight: 1.4,
							}}
						>
							Khusus Pemilik (Owner). Rahasia kredensial selalu diredaksi.
							Memisahkan status <strong>Memenuhi Syarat (Eligible)</strong>,{" "}
							<strong>Ditekan (Suppressed)</strong>,{" "}
							<strong>Dalam Antrean (Queued)</strong>,{" "}
							<strong>Diterima (Accepted)</strong>,{" "}
							<strong>Diproses (Processed)</strong>, dan{" "}
							<strong>Atribusi Eksternal (Tidak Diketahui)</strong>.
						</p>
					</div>

					<div
						style={{
							display: "flex",
							flexWrap: "wrap",
							gap: "8px",
							alignItems: "center",
							marginBottom: "16px",
							padding: "10px 12px",
							backgroundColor: "#f8fafc",
							borderRadius: "8px",
							border: "1px solid #e2e8f0",
						}}
					>
						<label
							htmlFor="replay-event-id-input"
							style={{
								fontSize: "0.8125rem",
								fontWeight: 600,
								color: "#334155",
							}}
						>
							ID Kejadian (event_id) untuk Replay Terkontrol:
						</label>
						<input
							id="replay-event-id-input"
							data-testid="replay-event-id-input"
							type="text"
							value={replayEventId}
							onChange={(e) => setReplayEventId(e.target.value)}
							placeholder="00000000-0000-4000-8000-000000000000"
							style={{
								padding: "6px 10px",
								borderRadius: "6px",
								border: "1px solid #cbd5e1",
								fontSize: "0.8125rem",
								flex: "1 1 240px",
								maxWidth: "100%",
							}}
						/>
					</div>

					<div
						style={{
							display: "grid",
							gridTemplateColumns:
								"repeat(auto-fit, minmax(min(100%, 290px), 1fr))",
							gap: "14px",
						}}
					>
						{destinations.map((dest) => (
							<div
								key={dest.platform}
								data-testid={`ad-destination-card-${dest.platform}`}
								style={{
									border: "1px solid #cbd5e1",
									borderRadius: "10px",
									padding: "14px",
									backgroundColor: "#fcfcfd",
									display: "flex",
									flexDirection: "column",
									gap: "10px",
								}}
							>
								<div
									style={{
										display: "flex",
										flexWrap: "wrap",
										justifyContent: "space-between",
										alignItems: "center",
										gap: "6px",
									}}
								>
									<div>
										<span
											style={{
												fontSize: "0.95rem",
												fontWeight: 700,
												textTransform: "uppercase",
											}}
										>
											{dest.platform}
										</span>
										<span
											style={{
												fontSize: "0.75rem",
												color: "#64748b",
												marginLeft: "8px",
											}}
										>
											Revisi v{dest.version}
										</span>
									</div>
									<span
										data-testid={`ad-status-badge-${dest.platform}`}
										style={{
											fontSize: "0.75rem",
											fontWeight: 700,
											padding: "3px 8px",
											borderRadius: "999px",
											backgroundColor: dest.paused ? "#fef3c7" : "#d1fae5",
											color: dest.paused ? "#92400e" : "#065f46",
										}}
									>
										{dest.paused ? "Dijeda" : "Aktif"}
									</span>
								</div>

								<div
									style={{
										fontSize: "0.75rem",
										color: "#334155",
										lineHeight: 1.5,
										wordBreak: "break-word",
									}}
								>
									<div>
										ID Publik: <code>{dest.public_identifier}</code>
									</div>
									{dest.google_conversion_source && (
										<div>
											Sumber Konversi Google:{" "}
											<strong>{dest.google_conversion_source}</strong>
										</div>
									)}
									<div data-testid={`ad-secret-redacted-${dest.platform}`}>
										Status Kredensial:{" "}
										<strong>
											{dest.credentials_configured
												? "Terkonfigurasi (Rahasia Diredaksi)"
												: "Belum Diatur"}
										</strong>
									</div>
								</div>

								{/* Delivery Status Breakdown */}
								<div
									style={{
										display: "grid",
										gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
										gap: "6px",
										fontSize: "0.75rem",
										backgroundColor: "#f1f5f9",
										padding: "8px",
										borderRadius: "6px",
									}}
								>
									<div>
										Memenuhi Syarat: <strong>{dest.eligible}</strong>
									</div>
									<div>
										Ditekan (No Consent): <strong>{dest.suppressed}</strong>
									</div>
									<div>
										Dalam Antrean: <strong>{dest.queued}</strong>
									</div>
									<div>
										Diterima (Accepted): <strong>{dest.accepted}</strong>
									</div>
									<div>
										Diproses Lokal: <strong>{dest.processed}</strong>
									</div>
									<div>
										Atribusi Iklan:{" "}
										<strong>
											{dest.attributed === null
												? "Tidak Diketahui"
												: dest.attributed}
										</strong>
									</div>
								</div>

								{/* Purchase Collection Instances vs Unique Orders & Money Reconciliation */}
								<div
									style={{
										fontSize: "0.75rem",
										borderTop: "1px solid #e2e8f0",
										paddingTop: "8px",
										lineHeight: 1.5,
									}}
								>
									<div>
										Kejadian Koleksi Purchase:{" "}
										<strong>
											{dest.purchase_collection_instances} kejadian
										</strong>{" "}
										vs Pesanan Unik:{" "}
										<strong>{dest.unique_orders} pesanan</strong>
									</div>
									<div>
										Penerimaan Kotor:{" "}
										<strong>
											{formatIdr(
												dest.reconciliation.gross_merchandise_amount_idr,
											)}
										</strong>
									</div>
									<div>
										Pengembalian Dana (Refund):{" "}
										<strong>
											{formatIdr(
												dest.reconciliation.refunded_merchandise_amount_idr,
											)}
										</strong>
									</div>
									<div>
										Pendapatan Bersih (Net):{" "}
										<strong>
											{formatIdr(
												dest.reconciliation.net_merchandise_amount_idr,
											)}
										</strong>
									</div>
									<div>
										Sinyal Purchase Terkirim:{" "}
										<strong>
											{formatIdr(
												dest.reconciliation
													.dispatched_purchase_signal_amount_idr,
											)}
										</strong>
									</div>
									<div>
										Identitas/Izin Hilang:{" "}
										<strong>
											{dest.missing_identity.total_suppressed_or_missing}{" "}
											kejadian
										</strong>{" "}
										(Tanpa Sesi:{" "}
										{dest.missing_identity.orders_without_visitor_session},
										Tanpa Izin: {dest.missing_identity.orders_without_consent})
									</div>
								</div>

								<div
									style={{
										display: "flex",
										flexWrap: "wrap",
										gap: "8px",
										marginTop: "4px",
									}}
								>
									<button
										type="button"
										data-testid={`ad-toggle-pause-${dest.platform}`}
										onClick={() => void handleTogglePauseDestination(dest)}
										style={{
											padding: "6px 10px",
											borderRadius: "6px",
											border: "1px solid #0f172a",
											backgroundColor: "#ffffff",
											color: "#0f172a",
											fontSize: "0.75rem",
											fontWeight: 600,
											cursor: "pointer",
										}}
									>
										{dest.paused ? "Lanjutkan Pengiriman" : "Jeda Pengiriman"}
									</button>

									<button
										type="button"
										data-testid={`ad-replay-btn-${dest.platform}`}
										onClick={() => void handleReplayEvent(dest)}
										style={{
											padding: "6px 10px",
											borderRadius: "6px",
											border: "1px solid #047857",
											backgroundColor: "#047857",
											color: "#ffffff",
											fontSize: "0.75rem",
											fontWeight: 600,
											cursor: "pointer",
										}}
									>
										Replay Kejadian
									</button>
								</div>
							</div>
						))}
					</div>
				</section>
			)}
		</main>
	);
}
