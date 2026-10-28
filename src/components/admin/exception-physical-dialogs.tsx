"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { failureText, getJson } from "./admin-errors";
import { useIntent } from "./exception-intent";
import { type CommerceException, type ExceptionUnit, STATUS } from "./exception-model";
import {
	type Balance,
	type Component,
	componentsOf,
	type FulfillmentRead,
	readBalances,
	readFulfillmentOfShipment,
} from "./exception-physical";
import { FormDialog, FormField, nativeSelectClass } from "./form";

// S133 warehouse steps: count a parcel's complete units that are not yet handed over
// (POST /admin/commerce-exceptions, optionally as a reinspection of one case) and record the
// goods a carrier returned (POST …/intakes). The screen joins the fulfillment pick rows with the
// inventory balances; the domain re-verifies every id, version, quantity and warehouse scope.

const COMMERCE = "/api/v1/admin/commerce-exceptions";
// A count field: digits only (the domain bounds the value against the lot).
const isCount = (text: string) => /^\d{1,9}$/.test(text.trim());

type Props = {
	onClose: () => void;
	onDone: (text: string, saved: CommerceException) => void;
	onUncertain: () => void;
};

function Loading({ label }: { label: string }) {
	return (
		<div className="flex flex-col gap-2" aria-busy="true" aria-live="polite">
			<p className="text-sm text-muted-foreground">{label}</p>
			<Skeleton className="h-10 w-full bg-border/70" />
			<Skeleton className="h-10 w-full bg-border/70" />
		</div>
	);
}

type Warehouse = { id: string; name: string };
type FulfillmentOption = FulfillmentRead & { warehouse_name: string | null };

/** Parcels the caller may count: unhanded, in their warehouses (the list API scopes by membership). */
async function readOpenParcels(): Promise<{ ok: true; data: FulfillmentOption[] } | { ok: false; text: string }> {
	const names = await getJson<{ data: Warehouse[] }>("/api/v1/admin/warehouses?limit=100");
	const nameOf = new Map((names.ok ? names.data.data : []).map((w) => [w.id, w.name]));
	const found: FulfillmentOption[] = [];
	for (const status of ["ready", "picking", "packed", "handover_pending"]) {
		const read = await getJson<{ data: FulfillmentRead[] }>(`/api/v1/admin/fulfillments?status=${status}&limit=50`);
		if (!read.ok) return { ok: false, text: failureText(read.failure) };
		for (const row of read.data.data)
			if (!row.handover_at) found.push({ ...row, warehouse_name: nameOf.get(row.warehouse_id) ?? null });
	}
	return { ok: true, data: found };
}

const unitLabel = (f: FulfillmentRead, unitId: string, index: number) => {
	const names = f.pick_items.filter((p) => p.fulfillment_item_id === unitId).map((p) => `${p.name} ×${p.quantity}`);
	return `Unit ${index + 1}${names.length ? `: ${names.join(", ")}` : ""}`;
};

export function StockReportDialog({
	reinspect,
	onClose,
	onDone,
	onUncertain,
}: Props & { reinspect?: CommerceException }) {
	const [parcels, setParcels] = useState<FulfillmentOption[] | null>(null);
	const [parcel, setParcel] = useState<FulfillmentRead | null>(null);
	const [balances, setBalances] = useState<Balance[]>([]);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [chosen, setChosen] = useState<string[]>([]);
	const [missing, setMissing] = useState<Record<string, string>>({});
	const [reason, setReason] = useState("");
	const intent = useIntent();

	const open = useCallback(
		async (next: FulfillmentRead) => {
			setLoadError(null);
			const read = await readBalances(
				next.warehouse_id,
				next.pick_items.map((p) => p.stock_item_id),
			);
			if (!read.ok) return setLoadError(failureText(read.failure));
			setBalances(read.data);
			setParcel(next);
			setMissing({});
			setChosen(
				reinspect
					? reinspect.units.map((u) => u.fulfillment_item_id)
					: next.items.filter((i) => !i.cancelled).map((i) => i.fulfillment_item_id),
			);
		},
		[reinspect],
	);
	// biome-ignore lint/correctness/useExhaustiveDependencies: load once per dialog
	useEffect(() => {
		void (async () => {
			if (reinspect) {
				const read = await readFulfillmentOfShipment(reinspect.units[0].shipment_id);
				if (!read.ok) return setLoadError(failureText(read.failure));
				return open(read.data);
			}
			const read = await readOpenParcels();
			if (!read.ok) return setLoadError(read.text);
			setParcels(read.data);
		})();
	}, []);

	const components: Component[] = useMemo(
		() => (parcel ? componentsOf(parcel.pick_items, chosen, balances) : []),
		[parcel, chosen, balances],
	);
	const frozen = intent.uncertain;

	async function send() {
		if (!parcel) return intent.setError("Pilih paket yang dihitung.");
		if (!chosen.length) return intent.setError("Pilih minimal satu unit.");
		if (!reason.trim()) return intent.setError("Catatan hitungan wajib diisi.");
		const lines: { balance_id: string; stock_item_id: string; expected_balance_version: number; missing_quantity: number }[] = [];
		let total = 0;
		for (const component of components) {
			const text = (missing[component.key] ?? "0").trim();
			if (!component.balance) return intent.setError(`Lot ${component.name} tidak ditemukan di stok gudang. Tutup lalu buka lagi.`);
			const limit = Math.min(component.quantity, component.balance.on_hand);
			if (!isCount(text) || Number(text) > limit)
				return intent.setError(`Jumlah kurang ${component.name} harus 0–${limit} (dipesan ${component.quantity}, stok fisik ${component.balance.on_hand}).`);
			total += Number(text);
			lines.push({
				balance_id: component.balance.id,
				stock_item_id: component.stock_item_id,
				expected_balance_version: component.balance.version,
				missing_quantity: Number(text),
			});
		}
		if (!reinspect && total === 0) return intent.setError("Laporan pertama harus mencatat minimal satu komponen yang kurang.");
		const saved = await intent.run<CommerceException>(
			COMMERCE,
			() => ({
				fulfillment_id: parcel.id,
				fulfillment_item_ids: chosen,
				expected_version: parcel.version,
				reason: reason.trim(),
				observed_components: lines,
				...(reinspect ? { reinspection: { exception_id: reinspect.id, expected_version: reinspect.version } } : {}),
			}),
			{ onUncertain },
		);
		if (saved) onDone(`Hitungan tersimpan. Status kasus: ${STATUS[saved.status][0]}.`, saved);
	}

	return (
		<FormDialog
			title={reinspect ? "Hitung ulang stok" : "Laporkan selisih stok"}
			description={
				reinspect
					? "Hitung ulang semua lot dari unit kasus ini. Hasil nol di semua lot menutup penyelidikan stok ini; persetujuan pembeli yang sudah tersimpan tidak dibatalkan."
					: "Catat hitungan fisik untuk paket yang belum diserahkan ke kurir. Laporan hanya mencatat fakta; stok, dana dan janji ke pembeli belum berubah. Packing dan pemesanan resi paket ini berhenti selama kasus terbuka."
			}
			className="md:max-w-2xl"
			pending={intent.pending}
			error={intent.error ?? loadError}
			submitLabel={frozen ? "Kirim ulang (kunci sama)" : "Simpan hitungan"}
			onClose={onClose}
			onSubmit={() => void send()}
		>
			{!reinspect && parcels === null && !loadError && <Loading label="Memuat paket yang bisa dihitung…" />}
			{!reinspect && parcels !== null && (
				<FormField id="report-parcel" label="Paket">
					<select
						id="report-parcel"
						className={`${nativeSelectClass} w-full`}
						value={parcel?.id ?? ""}
						disabled={frozen}
						onChange={(e) => {
							const next = parcels.find((p) => p.id === e.target.value);
							if (next) void open(next);
							else setParcel(null);
						}}
					>
						<option value="">{parcels.length ? "Pilih paket…" : "Tidak ada paket yang belum diserahkan"}</option>
						{parcels.map((p) => (
							<option key={p.id} value={p.id}>
								Paket {p.id.slice(0, 8)}
								{p.warehouse_name ? ` · ${p.warehouse_name}` : ""} · {p.items.filter((i) => !i.cancelled).length} unit
							</option>
						))}
					</select>
				</FormField>
			)}
			{reinspect && !parcel && !loadError && <Loading label="Memuat isi paket…" />}
			{parcel && (
				<>
					<fieldset className="flex flex-col gap-2" disabled={frozen || Boolean(reinspect)}>
						<legend className="mb-1 text-sm font-medium">Unit yang dihitung</legend>
						{parcel.items.map((item, index) => (
							<label key={item.fulfillment_item_id} className="flex items-start gap-2 text-sm">
								<input
									type="checkbox"
									className="mt-0.5 size-4 accent-primary"
									data-testid="report-unit"
									disabled={item.cancelled === true}
									checked={chosen.includes(item.fulfillment_item_id)}
									onChange={(e) =>
										setChosen((all) =>
											e.target.checked ? [...all, item.fulfillment_item_id] : all.filter((id) => id !== item.fulfillment_item_id),
										)
									}
								/>
								<span>{unitLabel(parcel, item.fulfillment_item_id, index)}</span>
							</label>
						))}
					</fieldset>
					<div className="flex flex-col gap-3">
						<p className="text-sm font-medium">Hitungan per lot</p>
						{components.map((component) => {
							const field = `report-missing-${component.key}`;
							const limit = component.balance ? Math.min(component.quantity, component.balance.on_hand) : 0;
							return (
								<div key={component.key} className="grid grid-cols-[minmax(0,1fr)_5.5rem] items-center gap-x-2 gap-y-1" data-testid="report-component">
									<label htmlFor={field} className="text-sm">
										{component.name}
										<span className="block text-xs text-muted-foreground">
											Dipesan {component.quantity}
											{component.balance ? ` · stok fisik ${component.balance.on_hand} · dipesan semua ${component.balance.reserved}` : " · lot tidak ditemukan"}
										</span>
									</label>
									<Input
										id={field}
										inputMode="numeric"
										aria-label={`Jumlah kurang ${component.name}`}
										value={missing[component.key] ?? "0"}
										disabled={frozen || !component.balance}
										onChange={(e) => setMissing((all) => ({ ...all, [component.key]: e.target.value }))}
									/>
									<p className="col-span-2 text-xs text-muted-foreground">Isi jumlah yang kurang (0–{limit}); 0 bila lot ini lengkap.</p>
								</div>
							);
						})}
					</div>
				</>
			)}
			<FormField id="report-reason" label="Catatan hitungan (wajib)">
				<Textarea id="report-reason" value={reason} maxLength={500} rows={3} disabled={frozen} onChange={(e) => setReason(e.target.value)} />
			</FormField>
		</FormDialog>
	);
}

type UnitDraft = { include: boolean; rows: Record<string, { quantity: string; confirmed: boolean }> };

export function IntakeDialog({ detail, onClose, onDone, onUncertain }: Props & { detail: CommerceException }) {
	const units: ExceptionUnit[] = useMemo(
		() => detail.units.filter((u) => u.replacement_link_id === null && u.physical_state !== "quarantined"),
		[detail.units],
	);
	const [basis, setBasis] = useState<{ parcels: Map<string, FulfillmentRead>; balances: Balance[] } | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [draft, setDraft] = useState<Record<string, UnitDraft>>({});
	const [reason, setReason] = useState("");
	const intent = useIntent();

	// biome-ignore lint/correctness/useExhaustiveDependencies: load once per dialog
	useEffect(() => {
		void (async () => {
			const parcels = new Map<string, FulfillmentRead>();
			const balances: Balance[] = [];
			for (const shipmentId of new Set(units.map((u) => u.shipment_id))) {
				const read = await readFulfillmentOfShipment(shipmentId);
				if (!read.ok) return setLoadError(failureText(read.failure));
				parcels.set(shipmentId, read.data);
				const stock = await readBalances(
					read.data.warehouse_id,
					read.data.pick_items.map((p) => p.stock_item_id),
				);
				if (!stock.ok) return setLoadError(failureText(stock.failure));
				balances.push(...stock.data);
			}
			const next: Record<string, UnitDraft> = {};
			for (const unit of units) {
				const parcel = parcels.get(unit.shipment_id);
				const rows: UnitDraft["rows"] = {};
				for (const c of parcel ? componentsOf(parcel.pick_items, [unit.fulfillment_item_id], balances) : [])
					rows[c.key] = { quantity: String(c.quantity), confirmed: true };
				next[unit.id] = { include: true, rows };
			}
			setDraft(next);
			setBasis({ parcels, balances });
		})();
	}, []);

	const componentsFor = (unit: ExceptionUnit) => {
		const parcel = basis?.parcels.get(unit.shipment_id);
		return parcel ? componentsOf(parcel.pick_items, [unit.fulfillment_item_id], basis?.balances ?? []) : [];
	};
	const frozen = intent.uncertain;

	async function send() {
		if (!reason.trim()) return intent.setError("Catatan penerimaan wajib diisi.");
		const lines: {
			exception_unit_id: string;
			stock_item_id: string | null;
			expected_balance_id: string | null;
			quantity: number;
			identity_confirmed: boolean;
		}[] = [];
		for (const unit of units) {
			const state = draft[unit.id];
			if (!state?.include) continue;
			let unidentified = 0;
			for (const component of componentsFor(unit)) {
				const row = state.rows[component.key];
				const text = (row?.quantity ?? "").trim();
				if (text === "" || text === "0") continue;
				if (!isCount(text) || Number(text) > component.quantity)
					return intent.setError(`Jumlah ${component.name} harus 0–${component.quantity}.`);
				if (row.confirmed) {
					if (!component.balance) return intent.setError(`Lot ${component.name} tidak ditemukan di stok gudang.`);
					lines.push({
						exception_unit_id: unit.id,
						stock_item_id: component.stock_item_id,
						expected_balance_id: component.balance.id,
						quantity: Number(text),
						identity_confirmed: true,
					});
				} else unidentified += Number(text);
			}
			if (unidentified > 0)
				lines.push({ exception_unit_id: unit.id, stock_item_id: null, expected_balance_id: null, quantity: unidentified, identity_confirmed: false });
		}
		if (!lines.length) return intent.setError("Isi jumlah barang yang tiba untuk minimal satu komponen.");
		const saved = await intent.run<CommerceException>(
			`${COMMERCE}/${detail.id}/intakes`,
			() => ({ expected_version: detail.version, physical_outcome_id: detail.source_id, lines, reason: reason.trim() }),
			{ onUncertain },
		);
		if (saved) onDone(`Barang kembali tercatat. Status kasus: ${STATUS[saved.status][0]}.`, saved);
	}

	return (
		<FormDialog
			title="Catat barang kembali"
			description="Isi jumlah setiap komponen yang benar-benar tiba dari kurir. Komponen yang identitasnya cocok masuk stok karantina; yang tidak cocok hanya dicatat jumlahnya, stok tidak bertambah."
			className="md:max-w-2xl"
			pending={intent.pending}
			error={intent.error ?? loadError}
			submitLabel={frozen ? "Kirim ulang (kunci sama)" : "Simpan penerimaan"}
			onClose={onClose}
			onSubmit={() => void send()}
		>
			{!basis && !loadError && <Loading label="Memuat isi paket dan stok gudang…" />}
			{basis &&
				units.map((unit, index) => {
					const state = draft[unit.id];
					if (!state) return null;
					return (
						<fieldset key={unit.id} className="flex flex-col gap-2 rounded-md border p-3" disabled={frozen} data-testid="intake-unit">
							<legend className="sr-only">Unit {unit.unit_ordinal}</legend>
							<label className="flex items-start gap-2 text-sm font-medium">
								<input
									type="checkbox"
									className="mt-0.5 size-4 accent-primary"
									checked={state.include}
									onChange={(e) => setDraft((all) => ({ ...all, [unit.id]: { ...state, include: e.target.checked } }))}
								/>
								<span>
									{unit.product_name ?? `Unit ${index + 1}`}
									<span className="block text-xs font-normal text-muted-foreground">
										{[unit.variant_label, `unit ${unit.unit_ordinal}`, unit.warehouse_name].filter(Boolean).join(" · ")}
									</span>
								</span>
							</label>
							{state.include &&
								componentsFor(unit).map((component) => {
									const row = state.rows[component.key] ?? { quantity: "", confirmed: true };
									const field = `intake-${unit.id}-${component.key}`;
									const set = (next: Partial<typeof row>) =>
										setDraft((all) => ({
											...all,
											[unit.id]: { ...state, rows: { ...state.rows, [component.key]: { ...row, ...next } } },
										}));
									return (
										<div key={component.key} className="grid grid-cols-[minmax(0,1fr)_5.5rem] items-center gap-x-2 gap-y-1 pl-6">
											<label htmlFor={field} className="text-sm">
												{component.name}
												<span className="block text-xs text-muted-foreground">Dikirim {component.quantity}; isi jumlah yang tiba</span>
											</label>
											<Input id={field} inputMode="numeric" value={row.quantity} onChange={(e) => set({ quantity: e.target.value })} />
											<label className="col-span-2 flex items-center gap-2 text-xs text-muted-foreground">
												<input
													type="checkbox"
													className="size-4 accent-primary"
													checked={row.confirmed}
													onChange={(e) => set({ confirmed: e.target.checked })}
												/>
												Identitas cocok dengan yang dikirim
											</label>
										</div>
									);
								})}
						</fieldset>
					);
				})}
			<FormField id="intake-reason" label="Catatan penerimaan (wajib)">
				<Textarea id="intake-reason" value={reason} maxLength={500} rows={3} disabled={frozen} onChange={(e) => setReason(e.target.value)} />
			</FormField>
		</FormDialog>
	);
}
