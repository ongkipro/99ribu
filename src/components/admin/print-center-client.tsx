"use client";

import { useState } from "react";
import type {
	ShippingLabelArtifactResponse,
	ShippingLabelFormat,
	ShippingLabelTemplateResponse,
	ShippingPrintAttemptResponse,
} from "@/modules/documents/labels";
import { rupiah } from "@/modules/storefront/format";

type ShipmentItem = {
	shipment_id: string;
	parcel_id: string;
	warehouse_id: string;
	warehouse_name: string;
	order_number: string;
	tracking_number: string | null;
	fulfillment_status: string | null;
	cod_due: number;
};

type Props = {
	initialTemplates: ShippingLabelTemplateResponse[];
	initialShipments: ShipmentItem[];
	initialArtifacts: ShippingLabelArtifactResponse[];
	initialAttempts: ShippingPrintAttemptResponse[];
};

export function PrintCenterClient({
	initialTemplates,
	initialShipments,
	initialArtifacts,
	initialAttempts,
}: Props) {
	const [format, setFormat] = useState<ShippingLabelFormat>("thermal_100x150");
	const [selectedShipments, setSelectedShipments] = useState<string[]>([]);
	const [artifacts, setArtifacts] = useState(initialArtifacts);
	const [attempts, setAttempts] = useState(initialAttempts);
	const [reprintReason, setReprintReason] = useState("");
	const [activeShipmentForReprint, setActiveShipmentForReprint] = useState<
		string | null
	>(null);
	const [statusBanner, setStatusBanner] = useState<string | null>(null);

	function toggleShipmentSelection(shipmentId: string) {
		setSelectedShipments((prev) =>
			prev.includes(shipmentId)
				? prev.filter((id) => id !== shipmentId)
				: [...prev, shipmentId],
		);
	}

	async function handleGenerateSingle(shipmentId: string) {
		const res = await fetch(
			`/api/v1/admin/shipments/${shipmentId}/label-jobs`,
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					"idempotency-key": crypto.randomUUID(),
				},
				body: JSON.stringify({ format }),
			},
		);
		if (res.status === 202) {
			const job = (await res.json()) as { artifact_id: string | null };
			if (job.artifact_id) {
				const artRes = await fetch(
					`/api/v1/admin/label-artifacts/${job.artifact_id}`,
				);
				if (artRes.ok) {
					const art = (await artRes.json()) as ShippingLabelArtifactResponse;
					setArtifacts((prev) => [art, ...prev.filter((a) => a.id !== art.id)]);
				}
			}
			setStatusBanner(`Label ${format} berhasil dibuat.`);
		} else {
			const err = (await res.json()) as { code?: string };
			setStatusBanner(`Gagal membuat label: ${err.code ?? res.status}`);
		}
	}

	async function handleGenerateBatch() {
		if (selectedShipments.length === 0) return;
		const res = await fetch("/api/v1/admin/label-batches", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"idempotency-key": crypto.randomUUID(),
			},
			body: JSON.stringify({
				shipment_ids: selectedShipments,
				format,
			}),
		});
		if (res.status === 202) {
			const batch = (await res.json()) as { status: string };
			setStatusBanner(`Batch cetak selesai dengan status: ${batch.status}.`);
		}
	}

	async function handleRecordPrint(
		shipmentId: string,
		artifactId: string,
		kind: "initial_print" | "reprint",
		reason?: string,
	) {
		const res = await fetch(
			`/api/v1/admin/shipments/${shipmentId}/print-attempts`,
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					"idempotency-key": crypto.randomUUID(),
				},
				body: JSON.stringify({
					artifact_id: artifactId,
					kind,
					outcome: "completed",
					...(reason ? { reason } : {}),
				}),
			},
		);
		if (res.status === 201) {
			const created = (await res.json()) as ShippingPrintAttemptResponse;
			setAttempts((prev) => [created, ...prev]);
			setActiveShipmentForReprint(null);
			setReprintReason("");
			setStatusBanner(
				kind === "initial_print"
					? "Cetakan awal tercatat."
					: "Cetak ulang (reprint) tercatat dengan alasan audit.",
			);
		} else {
			const err = (await res.json()) as { code?: string };
			setStatusBanner(`Cetak ditolak: ${err.code ?? res.status}`);
		}
	}

	return (
		<div className="print-center-workspace" data-testid="print-center-root">
			{statusBanner && (
				<output
					className="checkout-hint"
					data-testid="print-center-status-banner"
				>
					{statusBanner}
				</output>
			)}

			<section
				className="receipt-card"
				aria-labelledby="print-controls-heading"
				data-testid="print-controls-section"
			>
				<h2 id="print-controls-heading">
					Format Label & Cetak Massal (Batch Print)
				</h2>
				<div className="notice-actions">
					<label htmlFor="label-format-select">Format Kertas Label</label>
					<select
						id="label-format-select"
						data-testid="label-format-select"
						value={format}
						onChange={(e) => setFormat(e.target.value as ShippingLabelFormat)}
					>
						<option value="thermal_100x150">Thermal 100×150 mm</option>
						<option value="a4">A4 Lembar Standar</option>
					</select>
					<button
						type="button"
						className="button"
						data-testid="batch-generate-button"
						disabled={selectedShipments.length === 0}
						onClick={handleGenerateBatch}
					>
						Cetak Batch ({selectedShipments.length} paket)
					</button>
				</div>
			</section>

			<section
				className="receipt-card"
				aria-labelledby="shipments-queue-heading"
				data-testid="shipments-queue-section"
			>
				<h2 id="shipments-queue-heading">Daftar Paket & Status Resi Gudang</h2>
				<ul className="receipt-parcel-items" data-testid="print-shipment-list">
					{initialShipments.map((s) => {
						const latestArtifact = artifacts.find(
							(a) => a.shipment_id === s.shipment_id,
						);
						return (
							<li
								key={s.shipment_id}
								data-testid={`print-shipment-row-${s.shipment_id}`}
							>
								<div>
									<input
										type="checkbox"
										aria-label={`Pilih paket ${s.parcel_id}`}
										data-testid={`select-shipment-${s.shipment_id}`}
										checked={selectedShipments.includes(s.shipment_id)}
										onChange={() => toggleShipmentSelection(s.shipment_id)}
									/>{" "}
									<strong>
										{s.order_number} · {s.parcel_id}
									</strong>{" "}
									· Gudang {s.warehouse_name} · Status:{" "}
									<span data-testid={`fulfillment-status-${s.shipment_id}`}>
										{s.fulfillment_status ?? "preparing"}
									</span>
								</div>
								<p className="checkout-hint">
									Resi:{" "}
									<strong data-testid={`shipment-waybill-${s.shipment_id}`}>
										{s.tracking_number ?? "Belum terbit"}
									</strong>{" "}
									· COD: {s.cod_due > 0 ? rupiah(s.cod_due) : "Non-COD"}
								</p>
								{latestArtifact && (
									<p className="checkout-hint">
										Artifak Label:{" "}
										<span
											className="receipt-badge"
											data-testid={`artifact-status-badge-${latestArtifact.id}`}
											data-status={latestArtifact.status}
										>
											{latestArtifact.status}
										</span>{" "}
										· Format: {latestArtifact.format} · SHA-256:{" "}
										<code>{latestArtifact.content_sha256.slice(0, 12)}</code>
									</p>
								)}
								<div className="notice-actions">
									<button
										type="button"
										className="button button-secondary"
										data-testid={`generate-label-${s.shipment_id}`}
										onClick={() => handleGenerateSingle(s.shipment_id)}
									>
										Buat Label ({format})
									</button>
									{latestArtifact && latestArtifact.status === "valid" && (
										<>
											<a
												className="button button-secondary"
												data-testid={`download-pdf-${latestArtifact.id}`}
												href={`/api/v1/admin/label-artifacts/${latestArtifact.id}/content`}
												target="_blank"
												rel="noreferrer"
											>
												Unduh PDF
											</a>
											<button
												type="button"
												className="button"
												data-testid={`initial-print-${s.shipment_id}`}
												onClick={() =>
													handleRecordPrint(
														s.shipment_id,
														latestArtifact.id,
														"initial_print",
													)
												}
											>
												Catat Cetak Awal
											</button>
											<button
												type="button"
												className="button button-secondary"
												data-testid={`open-reprint-${s.shipment_id}`}
												onClick={() =>
													setActiveShipmentForReprint(s.shipment_id)
												}
											>
												Cetak Ulang (Reprint)
											</button>
										</>
									)}
								</div>
								{activeShipmentForReprint === s.shipment_id &&
									latestArtifact && (
										<div
											className="receipt-card"
											data-testid={`reprint-modal-${s.shipment_id}`}
										>
											<label htmlFor={`reprint-reason-${s.shipment_id}`}>
												Alasan Cetak Ulang (Wajib untuk Audit)
											</label>
											<input
												id={`reprint-reason-${s.shipment_id}`}
												data-testid={`reprint-reason-input-${s.shipment_id}`}
												type="text"
												value={reprintReason}
												onChange={(e) => setReprintReason(e.target.value)}
												placeholder="Contoh: Kertas thermal kusut"
											/>
											<button
												type="button"
												className="button"
												data-testid={`confirm-reprint-${s.shipment_id}`}
												onClick={() =>
													handleRecordPrint(
														s.shipment_id,
														latestArtifact.id,
														"reprint",
														reprintReason,
													)
												}
											>
												Konfirmasi Cetak Ulang
											</button>
										</div>
									)}
							</li>
						);
					})}
				</ul>
			</section>

			<section
				className="receipt-card"
				aria-labelledby="templates-heading"
				data-testid="templates-section"
			>
				<h2 id="templates-heading">Template Label & Tata Kelola Brand</h2>
				<ul className="receipt-parcel-items" data-testid="template-list">
					{initialTemplates.map((tpl) => (
						<li key={tpl.id} data-testid={`template-row-${tpl.id}`}>
							<strong>{tpl.name}</strong> · Format: {tpl.format} · Mode Brand:{" "}
							<span>{tpl.brand_mode}</span> · Privasi Telepon:{" "}
							<span>{tpl.privacy_mode}</span> · Versi: v{tpl.active_version}
							{tpl.partner_brand_name && (
								<p className="checkout-hint">
									Mitra: {tpl.partner_brand_name} · {tpl.disclosure_text}
								</p>
							)}
						</li>
					))}
				</ul>
			</section>

			<section
				className="receipt-card"
				aria-labelledby="print-audit-heading"
				data-testid="print-audit-section"
			>
				<h2 id="print-audit-heading">Riwayat Audit Cetak & Cetak Ulang</h2>
				<ul className="receipt-parcel-items" data-testid="print-attempts-list">
					{attempts.map((att) => (
						<li key={att.id} data-testid={`print-attempt-row-${att.id}`}>
							<strong>{att.kind}</strong> ({att.outcome}) · Paket{" "}
							{att.shipment_id.slice(0, 8)} · Artifak{" "}
							{att.artifact_id.slice(0, 8)}
							{att.reason && (
								<p className="checkout-hint">Alasan: {att.reason}</p>
							)}
						</li>
					))}
				</ul>
			</section>
		</div>
	);
}
