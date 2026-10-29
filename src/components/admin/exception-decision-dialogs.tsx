"use client";

import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { type CommerceException, DECISION, type Decision, decisionsFor, PROPOSAL, STATUS } from "./exception-model";
import { useIntent } from "./exception-intent";
import { formatWib } from "./format";
import { FormDialog, FormField } from "./form";

// S133 staff decisions of one case (POST …/decisions): record a proposal for the buyer or
// escalate (owner, customer service in scope), and apply the proposal the buyer already
// accepted. Neither moves money; the API owns the state machine and scope.

type Props = {
	detail: CommerceException;
	onClose: () => void;
	/** `warn`: the saved status still needs attention (escalated, unknown). */
	onDone: (text: string, warn?: boolean) => void;
	/** The answer was lost: the page reloads while the dialog keeps its intent. */
	onUncertain: () => void;
};

const base = (detail: CommerceException) => `/api/v1/admin/commerce-exceptions/${detail.id}/decisions`;

export function DecideDialog({ detail, onClose, onDone, onUncertain }: Props) {
	const choices = decisionsFor(detail.kind);
	const [decision, setDecision] = useState<Decision>(choices[0]);
	const [reason, setReason] = useState("");
	const intent = useIntent();
	async function send() {
		if (!reason.trim()) return intent.setError("Alasan wajib diisi.");
		const saved = await intent.run<CommerceException>(
			base(detail),
			() => ({ expected_version: detail.version, decision, reason: reason.trim() }),
			{ onUncertain },
		);
		if (saved) onDone(`Keputusan tersimpan. Status: ${STATUS[saved.status][0]}.`, STATUS[saved.status][1] === "problem");
	}
	return (
		<FormDialog
			title="Putuskan penanganan"
			description="Usulan dikirim ke pembeli dan baru berlaku setelah pembeli menyetujuinya. Alasan ini ikut terlihat di riwayat kasus."
			pending={intent.pending}
			error={intent.error}
			submitLabel={intent.uncertain ? "Kirim ulang (kunci sama)" : "Simpan keputusan"}
			onClose={onClose}
			onSubmit={() => void send()}
		>
			<fieldset className="flex flex-col gap-2" disabled={intent.uncertain}>
				<legend className="mb-1 text-sm font-medium">Keputusan</legend>
				{choices.map((choice) => (
					<label key={choice} className="flex items-start gap-2 text-sm">
						<input
							type="radio"
							name="exception-decision"
							className="mt-0.5 size-4 accent-primary"
							value={choice}
							data-testid={`decision-${choice}`}
							checked={decision === choice}
							onChange={() => setDecision(choice)}
						/>
						<span>
							{DECISION[choice].label}
							<span className="block text-xs text-muted-foreground">{DECISION[choice].hint}</span>
						</span>
					</label>
				))}
			</fieldset>
			<FormField id="decide-reason" label="Alasan (wajib)">
				<Textarea
					id="decide-reason"
					value={reason}
					maxLength={500}
					rows={3}
					disabled={intent.uncertain}
					onChange={(e) => setReason(e.target.value)}
				/>
			</FormField>
		</FormDialog>
	);
}

export function ApplyDialog({ detail, onClose, onDone, onUncertain }: Props) {
	const proposal = detail.proposal;
	const [reason, setReason] = useState("");
	const intent = useIntent();
	async function send() {
		if (!proposal) return;
		if (!reason.trim()) return intent.setError("Alasan wajib diisi.");
		const saved = await intent.run<CommerceException>(
			base(detail),
			() => ({ expected_version: detail.version, proposal_id: proposal.id, reason: reason.trim() }),
			{ onUncertain },
		);
		if (saved) onDone(`Persetujuan pembeli diterapkan. Status: ${STATUS[saved.status][0]}.`, STATUS[saved.status][1] === "problem");
	}
	return (
		<FormDialog
			title="Terapkan persetujuan pembeli"
			description="Server membatalkan resi yang belum diserahkan, membatalkan unit yang disetujui, melepas stoknya dan menghentikan komisinya. Dana tidak dikirim di langkah ini; refund diajukan keuangan sesudahnya."
			pending={intent.pending}
			error={intent.error}
			submitLabel={intent.uncertain ? "Kirim ulang (kunci sama)" : "Terapkan"}
			onClose={onClose}
			onSubmit={() => void send()}
		>
			{proposal && (
				<dl className="flex flex-col gap-1 rounded-md border bg-muted/40 p-3 text-sm" data-testid="apply-proposal">
					<div className="flex justify-between gap-3">
						<dt className="text-muted-foreground">Usulan</dt>
						<dd className="font-medium">{PROPOSAL[proposal.action]}</dd>
					</div>
					<div className="flex justify-between gap-3">
						<dt className="text-muted-foreground">Unit terdampak</dt>
						<dd className="tabular-nums">{proposal.unit_ids.length}</dd>
					</div>
					<div className="flex justify-between gap-3">
						<dt className="text-muted-foreground">Diusulkan</dt>
						<dd className="tabular-nums">{formatWib(proposal.created_at)}</dd>
					</div>
				</dl>
			)}
			<FormField id="apply-reason" label="Alasan (wajib)">
				<Textarea
					id="apply-reason"
					value={reason}
					maxLength={500}
					rows={3}
					disabled={intent.uncertain}
					onChange={(e) => setReason(e.target.value)}
				/>
			</FormField>
		</FormDialog>
	);
}
