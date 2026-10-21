"use client";

import type React from "react";
import { useEffect, useId, useState } from "react";

type StaffUser = {
	id: string;
	roles: string[];
	canManageTools: boolean;
};

type SupportConversation = {
	id: string;
	status: "open" | "waiting_customer" | "resolved";
	version: number;
	created_at: string;
	updated_at: string;
	last_message_sequence: number;
	product_id?: string;
	order_id?: string;
	buyer_last_read_sequence: number;
	staff_last_read_sequence: number;
};

type SupportStaffConversation = {
	conversation: SupportConversation;
	assignee_user_id: string | null;
	assignment_version: number;
	current_agent_last_read_sequence: number;
	current_agent_unread_messages: number;
};

type SupportMessage = {
	id: string;
	conversation_id: string;
	sequence: number;
	client_message_id: string;
	sender: "buyer" | "customer_service";
	text: string;
	attachments: {
		id: string;
		media_type: string;
		size_bytes: number;
		status: string;
	}[];
	created_at: string;
	reply?: {
		message_id: string;
		state: "visible" | "redacted" | "expired";
		excerpt: string;
	};
	context?: {
		kind: "product" | "order";
		product_id?: string;
		order_id?: string;
		title: string;
		availability: string;
		snapshot_at: string;
	};
};

type InternalNote = {
	id: string;
	conversation_id: string;
	author_id: string;
	text: string;
	created_at: string;
};

type SavedReply = {
	id: string;
	version: number;
	title: string;
	text: string;
	placeholders: string[];
	enabled: boolean;
};

type SupportTag = {
	id: string;
	version: number;
	label: string;
	enabled: boolean;
};

type Classification = {
	conversation_id: string;
	version: number;
	tag_ids: string[];
	priority: "low" | "normal" | "high";
	updated_at: string;
};

function makeKey(prefixStr: string) {
	const rand =
		typeof crypto !== "undefined" && "randomUUID" in crypto
			? crypto.randomUUID().replaceAll("-", "")
			: `${Date.now()}${Math.random().toString(36).slice(2, 12)}`;
	return `${prefixStr}_${rand}`.slice(0, 48);
}

const primaryBtn: React.CSSProperties = {
	minHeight: "44px",
	padding: "8px 14px",
	borderRadius: "6px",
	border: "1px solid #5b35d5",
	background: "#5b35d5",
	color: "#fff",
	fontWeight: 600,
	fontSize: "0.875rem",
	display: "inline-flex",
	alignItems: "center",
	justifyContent: "center",
	gap: "6px",
	maxWidth: "100%",
};

const secondaryBtn: React.CSSProperties = {
	...primaryBtn,
	background: "#fff",
	color: "#18181b",
	border: "1px solid #85858e",
};

const noteBtn: React.CSSProperties = {
	...primaryBtn,
	background: "#9c3f0a",
	border: "1px solid #9c3f0a",
};

const fieldInput: React.CSSProperties = {
	minHeight: "44px",
	width: "100%",
	minWidth: 0,
	maxWidth: "100%",
	padding: "9px 12px",
	borderRadius: "6px",
	border: "1px solid #85858e",
	background: "#fff",
	color: "#18181b",
	fontSize: "0.95rem",
	boxSizing: "border-box",
};

export function StaffInboxView({ staffUser }: { staffUser: StaffUser }) {
	const baseId = useId();
	const [assignmentFilter, setAssignmentFilter] = useState<
		"unassigned" | "assigned_to_me" | "all"
	>("all");
	const [statusFilter, setStatusFilter] = useState<string>("");
	const [priorityFilter, setPriorityFilter] = useState<string>("");
	const [unreadOnly, setUnreadOnly] = useState<boolean>(false);

	const [inbox, setInbox] = useState<SupportStaffConversation[]>([]);
	const [selected, setSelected] = useState<SupportStaffConversation | null>(
		null,
	);
	const [messages, setMessages] = useState<SupportMessage[]>([]);
	const [notes, setNotes] = useState<InternalNote[]>([]);
	const [classification, setClassification] = useState<Classification | null>(
		null,
	);
	const [savedReplies, setSavedReplies] = useState<SavedReply[]>([]);
	const [tags, setTags] = useState<SupportTag[]>([]);

	const [publicDraft, setPublicDraft] = useState("");
	const [unresolvedPlaceholders, setUnresolvedPlaceholders] = useState<
		string[]
	>([]);
	const [noteDraft, setNoteDraft] = useState("");
	const [handoffTarget, setHandoffTarget] = useState("");
	const [actionReason, setActionReason] = useState("Tindak lanjut CS");

	const [noteSearchQuery, setNoteSearchQuery] = useState("");
	const [noteSearchHits, setNoteSearchHits] = useState<InternalNote[] | null>(
		null,
	);

	const [feedback, setFeedback] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	async function loadInbox(
		nextAssign = assignmentFilter,
		nextStatus = statusFilter,
		nextPriority = priorityFilter,
		nextUnread = unreadOnly,
	) {
		setError(null);
		const params = new URLSearchParams({ assignment: nextAssign });
		if (nextStatus) params.set("status", nextStatus);
		if (nextPriority) params.set("priority", nextPriority);
		if (nextUnread) params.set("unread", "true");
		const res = await fetch(
			`/api/v1/admin/support/conversations?${params.toString()}`,
			{
				headers: { Accept: "application/json" },
			},
		);
		if (!res.ok) {
			setError("Gagal memuat antrean CS.");
			return;
		}
		const body = (await res.json()) as { data: SupportStaffConversation[] };
		setInbox(body.data);
	}

	useEffect(() => {
		let cancelled = false;
		async function bootstrap() {
			const [inboxRes, srRes, tagRes] = await Promise.all([
				fetch("/api/v1/admin/support/conversations?assignment=unassigned", {
					headers: { Accept: "application/json" },
				}),
				fetch("/api/v1/admin/support/saved-replies", {
					headers: { Accept: "application/json" },
				}),
				fetch("/api/v1/admin/support/tags", {
					headers: { Accept: "application/json" },
				}),
			]);
			if (cancelled) return;
			if (inboxRes.ok) {
				const body = (await inboxRes.json()) as {
					data: SupportStaffConversation[];
				};
				setInbox(body.data);
			}
			if (srRes.ok) {
				const srBody = (await srRes.json()) as { data: SavedReply[] };
				setSavedReplies(srBody.data);
			}
			if (tagRes.ok) {
				const tagBody = (await tagRes.json()) as { data: SupportTag[] };
				setTags(tagBody.data);
			}
		}
		void bootstrap();
		return () => {
			cancelled = true;
		};
	}, []);

	async function selectThread(item: SupportStaffConversation) {
		setSelected(item);
		setError(null);
		setFeedback(null);
		setNoteSearchHits(null);
		setUnresolvedPlaceholders([]);
		const cid = item.conversation.id;
		const [msgRes, noteRes, classRes] = await Promise.all([
			fetch(`/api/v1/admin/support/conversations/${cid}/messages`, {
				headers: { Accept: "application/json" },
			}),
			fetch(`/api/v1/admin/support/conversations/${cid}/notes`, {
				headers: { Accept: "application/json" },
			}),
			fetch(`/api/v1/admin/support/conversations/${cid}/classification`, {
				headers: { Accept: "application/json" },
			}),
		]);
		if (msgRes.ok) {
			const m = (await msgRes.json()) as { data: SupportMessage[] };
			setMessages(m.data);
		}
		if (noteRes.ok) {
			const n = (await noteRes.json()) as { data: InternalNote[] };
			setNotes(n.data);
		}
		if (classRes.ok) {
			const c = (await classRes.json()) as Classification;
			setClassification(c);
		}
	}

	async function claimThread() {
		if (!selected) return;
		setError(null);
		const res = await fetch(
			`/api/v1/admin/support/conversations/${selected.conversation.id}/claims`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Idempotency-Key": makeKey("claim"),
				},
				body: JSON.stringify({ expected_version: selected.assignment_version }),
			},
		);
		if (!res.ok) {
			setError(
				"Klaim gagal karena percakapan sudah diklaim agen lain atau versi berubah. Draf Anda tetap aman.",
			);
			await loadInbox();
			return;
		}
		const updated = (await res.json()) as SupportStaffConversation;
		setSelected(updated);
		setInbox((prev) =>
			prev.map((x) =>
				x.conversation.id === updated.conversation.id ? updated : x,
			),
		);
		setFeedback("Percakapan berhasil diklaim secara eksklusif.");
	}

	async function handoffOrRelease(targetUserId: string | null) {
		if (!selected) return;
		setError(null);
		const res = await fetch(
			`/api/v1/admin/support/conversations/${selected.conversation.id}/assignments`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Idempotency-Key": makeKey("assign"),
				},
				body: JSON.stringify({
					expected_version: selected.assignment_version,
					assignee_user_id: targetUserId,
					reason: actionReason.trim() || "Penugasan ulang CS",
				}),
			},
		);
		if (!res.ok) {
			setError(
				"Gagal mengubah penugasan. Pastikan target memiliki peran customer_service dan versi sesuai.",
			);
			return;
		}
		const updated = (await res.json()) as SupportStaffConversation;
		setSelected(updated);
		setInbox((prev) =>
			prev.map((x) =>
				x.conversation.id === updated.conversation.id ? updated : x,
			),
		);
		setFeedback(
			targetUserId
				? `Dialihkan ke ${targetUserId}.`
				: "Klaim dilepas ke antrean.",
		);
	}

	async function changeStatus(
		nextStatus: "open" | "waiting_customer" | "resolved",
	) {
		if (!selected) return;
		setError(null);
		const res = await fetch(
			`/api/v1/admin/support/conversations/${selected.conversation.id}/status`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Idempotency-Key": makeKey("status"),
				},
				body: JSON.stringify({
					expected_version: selected.assignment_version,
					status: nextStatus,
					reason: actionReason.trim() || `Ubah status ke ${nextStatus}`,
				}),
			},
		);
		if (!res.ok) {
			setError(
				"Gagal mengubah status percakapan (versi sudah berubah atau belum diklaim).",
			);
			return;
		}
		const updated = (await res.json()) as SupportStaffConversation;
		setSelected(updated);
		setInbox((prev) =>
			prev.map((x) =>
				x.conversation.id === updated.conversation.id ? updated : x,
			),
		);
		setFeedback(`Status diubah menjadi ${nextStatus}.`);
	}

	async function sendPublicReply(e: React.FormEvent) {
		e.preventDefault();
		if (!selected) return;
		if (selected.assignee_user_id !== staffUser.id) {
			setError(
				"Klaim percakapan terlebih dahulu sebelum mengirim balasan publik ke pelanggan.",
			);
			return;
		}
		if (unresolvedPlaceholders.length > 0 && publicDraft.includes("{{")) {
			setError(
				"Selesaikan placeholder template sebelum mengirim balasan ke pelanggan.",
			);
			return;
		}
		if (!publicDraft.trim()) {
			setError("Isi balasan publik tidak boleh kosong.");
			return;
		}
		setError(null);
		const clientMsgId = makeKey("csmsg");
		const res = await fetch(
			`/api/v1/admin/support/conversations/${selected.conversation.id}/messages`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Idempotency-Key": clientMsgId,
				},
				body: JSON.stringify({
					client_message_id: clientMsgId,
					text: publicDraft,
					attachment_ids: [],
				}),
			},
		);
		if (!res.ok) {
			setError("Gagal mengirim balasan publik. Draf tetap disimpan.");
			return;
		}
		const created = (await res.json()) as SupportMessage;
		setMessages((prev) => [...prev, created]);
		setPublicDraft("");
		setUnresolvedPlaceholders([]);
		setFeedback("Balasan publik terkirim ke pelanggan.");
	}

	async function sendInternalNote(e: React.FormEvent) {
		e.preventDefault();
		if (!selected || !noteDraft.trim()) return;
		setError(null);
		const res = await fetch(
			`/api/v1/admin/support/conversations/${selected.conversation.id}/notes`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Idempotency-Key": makeKey("note"),
				},
				body: JSON.stringify({ text: noteDraft.trim() }),
			},
		);
		if (!res.ok) {
			setError("Gagal menyimpan catatan internal.");
			return;
		}
		const created = (await res.json()) as InternalNote;
		setNotes((prev) => [...prev, created]);
		setNoteDraft("");
		setFeedback(
			"Catatan internal staf tersimpan (tidak terlihat oleh pelanggan).",
		);
	}

	async function insertSavedReply(sr: SavedReply) {
		if (!selected) return;
		setError(null);
		const res = await fetch(
			`/api/v1/admin/support/conversations/${selected.conversation.id}/saved-reply-previews`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Idempotency-Key": makeKey("srprev"),
				},
				body: JSON.stringify({
					saved_reply_id: sr.id,
					saved_reply_version: sr.version,
				}),
			},
		);
		if (!res.ok) {
			setError(
				"Klaim percakapan terlebih dahulu untuk menyiapkan draf template.",
			);
			return;
		}
		const preview = (await res.json()) as {
			text: string;
			unresolved_placeholders: string[];
			can_send: boolean;
		};
		setPublicDraft(preview.text);
		setUnresolvedPlaceholders(preview.unresolved_placeholders);
		setFeedback("Draf balasan dimasukkan ke editor publik (belum dikirim).");
	}

	async function updatePriority(nextPriority: "low" | "normal" | "high") {
		if (!selected || !classification) return;
		const res = await fetch(
			`/api/v1/admin/support/conversations/${selected.conversation.id}/classification`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Idempotency-Key": makeKey("class"),
				},
				body: JSON.stringify({
					expected_version: selected.assignment_version,
					tag_ids: classification.tag_ids,
					priority: nextPriority,
					reason: "Perbarui prioritas antrean",
				}),
			},
		);
		if (res.ok) {
			const updated = (await res.json()) as Classification;
			setClassification(updated);
			setSelected((prev) =>
				prev ? { ...prev, assignment_version: updated.version } : prev,
			);
		}
	}

	async function markStaffRead() {
		if (!selected) return;
		const latest = messages.reduce((max, m) => Math.max(max, m.sequence), 0);
		const res = await fetch(
			`/api/v1/admin/support/conversations/${selected.conversation.id}/read-markers`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Idempotency-Key": makeKey("sread"),
				},
				body: JSON.stringify({ last_seen_sequence: latest }),
			},
		);
		if (res.ok) {
			setSelected((prev) =>
				prev
					? {
							...prev,
							current_agent_last_read_sequence: latest,
							current_agent_unread_messages: 0,
						}
					: prev,
			);
			setFeedback("Pesan publik ditandai dibaca oleh agen ini.");
		}
	}

	async function searchNotes(e: React.FormEvent) {
		e.preventDefault();
		if (!selected || !noteSearchQuery.trim()) return;
		const res = await fetch(
			`/api/v1/admin/support/conversations/${selected.conversation.id}/note-searches`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Idempotency-Key": makeKey("nsearch"),
				},
				body: JSON.stringify({ query: noteSearchQuery.trim() }),
			},
		);
		if (res.ok) {
			const body = (await res.json()) as { data: InternalNote[] };
			setNoteSearchHits(body.data);
		}
	}

	const isClaimedByMe = selected?.assignee_user_id === staffUser.id;

	return (
		<main
			id="main"
			style={{
				maxWidth: "1360px",
				margin: "0 auto",
				padding: "20px 16px 40px",
				boxSizing: "border-box",
			}}
		>
			<header
				style={{
					display: "flex",
					flexWrap: "wrap",
					justifyContent: "space-between",
					alignItems: "center",
					gap: "12px",
					paddingBottom: "16px",
					borderBottom: "1px solid #d8d8df",
					marginBottom: "20px",
				}}
			>
				<div>
					<h1 style={{ margin: 0 }}>Antrean Layanan Pelanggan (CS Inbox)</h1>
					<p
						style={{ margin: "4px 0 0", fontSize: "0.9rem", color: "#5b5b63" }}
					>
						Masuk sebagai: <strong>{staffUser.id}</strong> (
						{staffUser.roles.join(", ")})
					</p>
				</div>
				<button type="button" onClick={() => loadInbox()} style={secondaryBtn}>
					Segarkan Antrean
				</button>
			</header>

			{error && (
				<div
					role="alert"
					style={{
						padding: "12px 14px",
						marginBottom: "16px",
						borderRadius: "6px",
						borderLeft: "4px solid #8b241d",
						background: "#fff4f2",
						color: "#8b241d",
						overflowWrap: "anywhere",
					}}
				>
					{error}
				</div>
			)}

			{feedback && (
				<output
					style={{
						display: "block",
						padding: "12px 14px",
						marginBottom: "16px",
						borderRadius: "6px",
						borderLeft: "4px solid #5b35d5",
						background: "#f7f5fd",
						color: "#18181b",
					}}
				>
					{feedback}
				</output>
			)}

			<div
				style={{
					display: "grid",
					gridTemplateColumns:
						"repeat(auto-fit, minmax(min(100%, 20rem), 1fr))",
					gap: "20px",
					alignItems: "start",
				}}
			>
				{/* Pane 1: Queue & Triage Filters */}
				<section
					aria-label="Filter dan daftar antrean percakapan"
					style={{
						border: "1px solid #d8d8df",
						borderRadius: "8px",
						padding: "16px",
						background: "#faf9fc",
						display: "grid",
						gap: "12px",
					}}
				>
					<h2 style={{ margin: 0 }}>Filter Antrean</h2>
					<div style={{ display: "grid", gap: "8px" }}>
						<label
							htmlFor={`${baseId}-assign`}
							style={{ fontWeight: 600, fontSize: "0.85rem" }}
						>
							Klaim Penugasan
						</label>
						<select
							id={`${baseId}-assign`}
							value={assignmentFilter}
							onChange={(e) => {
								const v = e.target.value as
									| "unassigned"
									| "assigned_to_me"
									| "all";
								setAssignmentFilter(v);
								void loadInbox(v, statusFilter, priorityFilter, unreadOnly);
							}}
							style={fieldInput}
						>
							<option value="unassigned">Belum Diklaim (unassigned)</option>
							<option value="assigned_to_me">
								Klaim Saya (assigned_to_me)
							</option>
							<option value="all">Semua Percakapan (all)</option>
						</select>

						<label
							htmlFor={`${baseId}-status`}
							style={{ fontWeight: 600, fontSize: "0.85rem" }}
						>
							Status Percakapan
						</label>
						<select
							id={`${baseId}-status`}
							value={statusFilter}
							onChange={(e) => {
								const v = e.target.value;
								setStatusFilter(v);
								void loadInbox(assignmentFilter, v, priorityFilter, unreadOnly);
							}}
							style={fieldInput}
						>
							<option value="">Semua Status</option>
							<option value="open">Terbuka (open)</option>
							<option value="waiting_customer">Menunggu Pelanggan</option>
							<option value="resolved">Selesai (resolved)</option>
						</select>

						<label
							htmlFor={`${baseId}-prio`}
							style={{ fontWeight: 600, fontSize: "0.85rem" }}
						>
							Prioritas Internal
						</label>
						<select
							id={`${baseId}-prio`}
							value={priorityFilter}
							onChange={(e) => {
								const v = e.target.value;
								setPriorityFilter(v);
								void loadInbox(assignmentFilter, statusFilter, v, unreadOnly);
							}}
							style={fieldInput}
						>
							<option value="">Semua Prioritas</option>
							<option value="high">Tinggi (high)</option>
							<option value="normal">Normal</option>
							<option value="low">Rendah (low)</option>
						</select>

						<label
							style={{
								display: "flex",
								alignItems: "center",
								gap: "8px",
								minHeight: "44px",
								fontWeight: 600,
								fontSize: "0.85rem",
							}}
						>
							<input
								type="checkbox"
								checked={unreadOnly}
								onChange={(e) => {
									const v = e.target.checked;
									setUnreadOnly(v);
									void loadInbox(
										assignmentFilter,
										statusFilter,
										priorityFilter,
										v,
									);
								}}
								style={{ width: "20px", height: "20px" }}
							/>
							Hanya yang belum saya baca
						</label>
					</div>

					<h3 style={{ margin: "8px 0 0" }}>
						Daftar Percakapan ({inbox.length})
					</h3>
					{inbox.length === 0 ? (
						<p style={{ margin: 0, color: "#5b5b63", fontSize: "0.9rem" }}>
							Tidak ada percakapan untuk filter ini.
						</p>
					) : (
						<ul
							style={{
								listStyle: "none",
								padding: 0,
								margin: 0,
								display: "grid",
								gap: "8px",
							}}
						>
							{inbox.map((item) => {
								const c = item.conversation;
								const active = selected?.conversation.id === c.id;
								return (
									<li
										key={c.id}
										style={{
											border: active
												? "2px solid #5b35d5"
												: "1px solid #d8d8df",
											borderRadius: "6px",
											padding: "10px",
											background: "#fff",
											display: "grid",
											gap: "6px",
										}}
									>
										<div
											style={{
												display: "flex",
												flexWrap: "wrap",
												justifyContent: "space-between",
												gap: "6px",
												fontSize: "0.85rem",
											}}
										>
											<strong>#{c.id.slice(0, 8)}</strong>
											<span>Status: {c.status}</span>
										</div>
										<div style={{ fontSize: "0.8rem", color: "#5b5b63" }}>
											Assignee: {item.assignee_user_id ?? "Belum diklaim"} •
											Belum dibaca agen ini:{" "}
											<strong>{item.current_agent_unread_messages}</strong>
										</div>
										<button
											type="button"
											onClick={() => selectThread(item)}
											style={secondaryBtn}
										>
											Buka Detail
										</button>
									</li>
								);
							})}
						</ul>
					)}
				</section>

				{/* Pane 2: Active Thread, Public Reply Composer & Separate Internal Note Composer */}
				<section
					aria-label="Percakapan aktif dan editor balasan"
					style={{
						border: "1px solid #d8d8df",
						borderRadius: "8px",
						padding: "16px",
						background: "#fff",
						display: "grid",
						gap: "16px",
					}}
				>
					{!selected ? (
						<p style={{ margin: 0, color: "#5b5b63" }}>
							Pilih satu percakapan dari antrean untuk memeriksa riwayat,
							mengklaim, atau membalas.
						</p>
					) : (
						<>
							<div
								style={{
									display: "flex",
									flexWrap: "wrap",
									justifyContent: "space-between",
									alignItems: "center",
									gap: "8px",
									borderBottom: "1px solid #d8d8df",
									paddingBottom: "10px",
								}}
							>
								<div>
									<h2 style={{ margin: 0 }}>
										Percakapan #{selected.conversation.id.slice(0, 8)}
									</h2>
									<small style={{ color: "#5b5b63" }}>
										Status: <strong>{selected.conversation.status}</strong> •
										Versi: {selected.assignment_version} • Pemegang klaim:{" "}
										<strong>
											{selected.assignee_user_id ?? "Belum diklaim"}
										</strong>
									</small>
								</div>
								<div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
									{!isClaimedByMe && (
										<button
											type="button"
											onClick={claimThread}
											style={primaryBtn}
										>
											Klaim Percakapan
										</button>
									)}
									<button
										type="button"
										onClick={markStaffRead}
										style={secondaryBtn}
									>
										Tandai Dibaca
									</button>
								</div>
							</div>

							<div
								role="log"
								aria-label="Riwayat pesan publik pelanggan dan CS"
								style={{
									display: "grid",
									gap: "8px",
									maxHeight: "300px",
									overflowY: "auto",
									padding: "10px",
									border: "1px solid #e7e5ed",
									borderRadius: "6px",
									background: "#faf9fc",
								}}
							>
								{messages.length === 0 ? (
									<p style={{ margin: 0, color: "#5b5b63" }}>
										Belum ada pesan publik.
									</p>
								) : (
									messages.map((m) => (
										<article
											key={m.id}
											style={{
												padding: "8px 10px",
												borderRadius: "6px",
												border: "1px solid #d8d8df",
												background:
													m.sender === "customer_service" ? "#f3effb" : "#fff",
												overflowWrap: "anywhere",
											}}
										>
											<div style={{ fontSize: "0.78rem", color: "#5b5b63" }}>
												<strong>
													#{m.sequence} •{" "}
													{m.sender === "buyer" ? "Pelanggan" : "CS"}
												</strong>
											</div>
											{m.context && (
												<div
													style={{
														marginTop: "4px",
														padding: "4px 8px",
														background: "#fff8de",
														borderRadius: "4px",
														fontSize: "0.8rem",
													}}
												>
													Konteks {m.context.kind}: {m.context.title} (
													{m.context.availability})
												</div>
											)}
											<p style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>
												{m.text}
											</p>
										</article>
									))
								)}
							</div>

							{/* Public Customer Reply Composer */}
							<form
								onSubmit={sendPublicReply}
								style={{
									padding: "12px",
									border: "2px solid #5b35d5",
									borderRadius: "6px",
									background: "#faf9ff",
									display: "grid",
									gap: "10px",
								}}
							>
								<label
									htmlFor={`${baseId}-pub-reply`}
									style={{ fontWeight: 700 }}
								>
									Balasan Publik ke Pelanggan
								</label>
								{!isClaimedByMe && (
									<p
										style={{ margin: 0, fontSize: "0.85rem", color: "#8b241d" }}
									>
										Klaim percakapan terlebih dahulu sebelum mengirim balasan
										publik ke pelanggan.
									</p>
								)}
								{unresolvedPlaceholders.length > 0 && (
									<p
										style={{ margin: 0, fontSize: "0.85rem", color: "#9c3f0a" }}
									>
										Perhatian: Placeholder belum terisi (
										{unresolvedPlaceholders.join(", ")}). Edit draf secara
										manual sebelum mengirim.
									</p>
								)}
								<textarea
									id={`${baseId}-pub-reply`}
									rows={3}
									maxLength={4000}
									value={publicDraft}
									onChange={(e) => setPublicDraft(e.target.value)}
									placeholder="Tulis balasan yang akan dilihat pelanggan..."
									style={{ ...fieldInput, minHeight: "80px" }}
								/>
								<button
									type="submit"
									disabled={!isClaimedByMe}
									style={primaryBtn}
								>
									Kirim Balasan Publik
								</button>
							</form>

							{/* Separate Staff-Only Internal Note Composer */}
							<form
								onSubmit={sendInternalNote}
								style={{
									padding: "12px",
									border: "2px dashed #9c3f0a",
									borderRadius: "6px",
									background: "#fff5ed",
									display: "grid",
									gap: "10px",
								}}
							>
								<label
									htmlFor={`${baseId}-staff-note`}
									style={{ fontWeight: 700, color: "#9c3f0a" }}
								>
									Catatan Internal Staf (Privat — Tidak Pernah Dikirim ke
									Pelanggan)
								</label>
								<textarea
									id={`${baseId}-staff-note`}
									rows={2}
									maxLength={4000}
									value={noteDraft}
									onChange={(e) => setNoteDraft(e.target.value)}
									placeholder="Tulis catatan internal antar staf CS..."
									style={{ ...fieldInput, minHeight: "68px" }}
								/>
								<button type="submit" style={noteBtn}>
									Simpan Catatan Internal
								</button>
							</form>
						</>
					)}
				</section>

				{/* Pane 3: Context, Assignment Governance, Saved Replies & Internal Notes List */}
				<section
					aria-label="Konteks, template, dan catatan internal"
					style={{
						border: "1px solid #d8d8df",
						borderRadius: "8px",
						padding: "16px",
						background: "#faf9fc",
						display: "grid",
						gap: "16px",
					}}
				>
					<h2 style={{ margin: 0 }}>Konteks & Alat Kerja CS</h2>
					{selected ? (
						<>
							<div
								style={{
									padding: "10px",
									borderRadius: "6px",
									border: "1px solid #d8d8df",
									background: "#fff",
									fontSize: "0.875rem",
									display: "grid",
									gap: "6px",
								}}
							>
								<strong>Ringkasan Konteks Aman</strong>
								<span>
									Produk Terkait:{" "}
									{selected.conversation.product_id ?? "Tidak ada"}
								</span>
								<span>
									Pesanan Terverifikasi:{" "}
									{selected.conversation.order_id ?? "Tidak ada"}
								</span>
								<small style={{ color: "#5b5b63" }}>
									Catatan: Chat atau klaim CS tidak pernah mengotorisasi refund,
									payout, atau perubahan stok secara langsung.
								</small>
							</div>

							<div style={{ display: "grid", gap: "8px" }}>
								<label
									htmlFor={`${baseId}-reason`}
									style={{ fontWeight: 600, fontSize: "0.85rem" }}
								>
									Alasan Tindakan Audit
								</label>
								<input
									id={`${baseId}-reason`}
									type="text"
									value={actionReason}
									onChange={(e) => setActionReason(e.target.value)}
									style={fieldInput}
								/>
								<div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
									<button
										type="button"
										onClick={() => changeStatus("waiting_customer")}
										style={secondaryBtn}
									>
										Set Menunggu Pelanggan
									</button>
									<button
										type="button"
										onClick={() => changeStatus("resolved")}
										style={secondaryBtn}
									>
										Tandai Selesai (Resolve)
									</button>
									<button
										type="button"
										onClick={() => changeStatus("open")}
										style={secondaryBtn}
									>
										Buka Kembali
									</button>
								</div>
							</div>

							<div style={{ display: "grid", gap: "8px" }}>
								<label
									htmlFor={`${baseId}-handoff`}
									style={{ fontWeight: 600, fontSize: "0.85rem" }}
								>
									Alihkan ke ID Staf CS Lain / Lepas Klaim
								</label>
								<input
									id={`${baseId}-handoff`}
									type="text"
									value={handoffTarget}
									onChange={(e) => setHandoffTarget(e.target.value)}
									placeholder="ID user CS tujuan..."
									style={fieldInput}
								/>
								<div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
									<button
										type="button"
										onClick={() =>
											handoffOrRelease(handoffTarget.trim() || null)
										}
										style={secondaryBtn}
									>
										Alihkan Penugasan
									</button>
									<button
										type="button"
										onClick={() => handoffOrRelease(null)}
										style={secondaryBtn}
									>
										Lepas ke Antrean
									</button>
								</div>
							</div>

							{classification && (
								<div style={{ display: "grid", gap: "8px" }}>
									<label
										htmlFor={`${baseId}-set-prio`}
										style={{ fontWeight: 600, fontSize: "0.85rem" }}
									>
										Prioritas Percakapan ({classification.priority})
									</label>
									<select
										id={`${baseId}-set-prio`}
										value={classification.priority}
										onChange={(e) =>
											updatePriority(
												e.target.value as "low" | "normal" | "high",
											)
										}
										style={fieldInput}
									>
										<option value="low">Rendah (low)</option>
										<option value="normal">Normal</option>
										<option value="high">Tinggi (high)</option>
									</select>
									{tags.length > 0 && (
										<div style={{ fontSize: "0.85rem" }}>
											Tag tersedia: {tags.map((t) => t.label).join(", ")}
										</div>
									)}
								</div>
							)}

							<div style={{ display: "grid", gap: "8px" }}>
								<strong>Template Balasan Cepat (Saved Replies)</strong>
								{!staffUser.canManageTools && (
									<small style={{ color: "#5b5b63" }}>
										Anda dapat memakai template, namun pengelolaan definisi
										hanya untuk supervisor / owner.
									</small>
								)}
								{savedReplies.length === 0 ? (
									<p
										style={{ margin: 0, fontSize: "0.85rem", color: "#5b5b63" }}
									>
										Belum ada template tersimpan.
									</p>
								) : (
									<ul
										style={{
											listStyle: "none",
											padding: 0,
											margin: 0,
											display: "grid",
											gap: "6px",
										}}
									>
										{savedReplies.map((sr) => (
											<li
												key={sr.id}
												style={{
													display: "flex",
													flexWrap: "wrap",
													justifyContent: "space-between",
													alignItems: "center",
													gap: "6px",
													padding: "8px",
													background: "#fff",
													border: "1px solid #d8d8df",
													borderRadius: "6px",
												}}
											>
												<span style={{ fontSize: "0.85rem", fontWeight: 600 }}>
													{sr.title}
												</span>
												<button
													type="button"
													onClick={() => insertSavedReply(sr)}
													style={secondaryBtn}
												>
													Sisipkan ke Draf
												</button>
											</li>
										))}
									</ul>
								)}
							</div>

							<div style={{ display: "grid", gap: "8px" }}>
								<strong>Riwayat Catatan Internal ({notes.length})</strong>
								<form
									onSubmit={searchNotes}
									style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}
								>
									<input
										type="search"
										aria-label="Cari catatan internal"
										value={noteSearchQuery}
										onChange={(e) => setNoteSearchQuery(e.target.value)}
										placeholder="Cari catatan internal..."
										style={{ ...fieldInput, flex: "1 1 10rem" }}
									/>
									<button type="submit" style={secondaryBtn}>
										Cari Catatan
									</button>
								</form>
								<ul
									style={{
										listStyle: "none",
										padding: 0,
										margin: 0,
										display: "grid",
										gap: "6px",
									}}
								>
									{(noteSearchHits ?? notes).map((n) => (
										<li
											key={n.id}
											style={{
												padding: "8px",
												borderRadius: "6px",
												border: "1px solid #f5c5a0",
												background: "#fff5ed",
												fontSize: "0.85rem",
												overflowWrap: "anywhere",
											}}
										>
											<strong>[{n.author_id}]:</strong> {n.text}
										</li>
									))}
								</ul>
							</div>
						</>
					) : (
						<p style={{ margin: 0, fontSize: "0.9rem", color: "#5b5b63" }}>
							Pilih percakapan untuk melihat konteks, klasifikasi, dan catatan
							internal.
						</p>
					)}
				</section>
			</div>
		</main>
	);
}
