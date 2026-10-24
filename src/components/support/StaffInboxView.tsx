"use client";

import { RefreshCw } from "lucide-react";
import Link from "next/link";
import type React from "react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { DataTable } from "@/components/admin/data-table";
import { FormField, nativeSelectClass } from "@/components/admin/form";
import { useKeysetList } from "@/components/admin/use-keyset-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type StaffUser = {
	id: string;
	roles: string[];
	canManageTools: boolean;
	canOpenOrders: boolean;
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
	/** Printed order number of the conversation's order (S113); null without an order. */
	order_number: string | null;
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

// around_sequence returns sequences within +/- limit/2 of the anchor.
const MESSAGE_WINDOW = 40;
const MESSAGE_HALF = MESSAGE_WINDOW / 2;
const CONFLICT_MESSAGE = "Percakapan diperbarui. Coba lagi.";
const NETWORK_MESSAGE = "Koneksi terputus. Periksa jaringan lalu coba lagi.";
const STATUS_LABELS: Record<string, string> = {
	open: "Terbuka",
	waiting_customer: "Menunggu pelanggan",
	resolved: "Selesai",
};
const STATUS_ACTIONS = [
	["waiting_customer", "Set Menunggu Pelanggan"],
	["resolved", "Tandai Selesai (Resolve)"],
	["open", "Buka Kembali"],
] as const;
type StaffAction =
	| "claim"
	| "read"
	| "assign"
	| "release"
	| "priority"
	| "saved-reply"
	| "note-search"
	| `status:${SupportConversation["status"]}`;

function mergeMessages(prev: SupportMessage[], incoming: SupportMessage[]) {
	const byId = new Map(prev.map((m) => [m.id, m]));
	for (const m of incoming) byId.set(m.id, m);
	return [...byId.values()].sort((a, b) => a.sequence - b.sequence);
}

async function fetchMessageWindow(messagesPath: string, around: number) {
	const params = new URLSearchParams({
		around_sequence: String(Math.max(1, around)),
		limit: String(MESSAGE_WINDOW),
	});
	const res = await fetch(`${messagesPath}?${params.toString()}`, {
		headers: { Accept: "application/json" },
	});
	if (!res.ok) return null;
	return ((await res.json()) as { data: SupportMessage[] }).data;
}

// Walks forward from a possibly stale tail until the window is no longer full.
async function fetchLatestMessages(messagesPath: string, lastKnown: number) {
	if (lastKnown < 1) return [];
	let around = lastKnown;
	let collected: SupportMessage[] = [];
	for (let i = 0; i < 10; i++) {
		const page = await fetchMessageWindow(messagesPath, around);
		if (!page) return null;
		collected = mergeMessages(collected, page);
		const top = page.at(-1)?.sequence ?? 0;
		if (top < around + MESSAGE_HALF) break;
		around = top + MESSAGE_HALF;
	}
	return collected.slice(-(MESSAGE_HALF + 1));
}

// lazy: no staff GET for one conversation exists, so scan the "all" inbox; switch to
// GET /api/v1/admin/support/conversations/{id} if the API adds it.
async function fetchStaffItem(conversationId: string) {
	let cursor: string | null = null;
	for (let i = 0; i < 20; i++) {
		const params = new URLSearchParams({ assignment: "all", limit: "100" });
		if (cursor) params.set("cursor", cursor);
		const res = await fetch(
			`/api/v1/admin/support/conversations?${params.toString()}`,
			{ headers: { Accept: "application/json" } },
		);
		if (!res.ok) return null;
		const body = (await res.json()) as {
			data: SupportStaffConversation[];
			pagination?: { next_cursor: string | null };
		};
		const hit = body.data.find((x) => x.conversation.id === conversationId);
		if (hit) return hit;
		cursor = body.pagination?.next_cursor ?? null;
		if (!cursor) return null;
	}
	return null;
}

async function problemCode(res: Response) {
	try {
		return ((await res.json()) as { code?: string }).code ?? null;
	} catch {
		return null;
	}
}

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

// Inline styles cannot use :disabled; dim disabled actions so the state is visible.
const off = (style: React.CSSProperties, disabled: boolean): React.CSSProperties =>
	disabled ? { ...style, opacity: 0.55, cursor: "not-allowed" } : style;

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

/** Latest context card title for this conversation's product/order (no raw ids on screen). */
function contextTitle(
	messages: SupportMessage[],
	kind: "product" | "order",
	id: string | undefined,
) {
	if (!id) return null;
	for (let i = messages.length - 1; i >= 0; i--) {
		const c = messages[i].context;
		if (c?.kind === kind && (kind === "order" ? c.order_id : c.product_id) === id && c.availability === "available")
			return c.title;
	}
	return null;
}
// Links to the console order and catalog detail pages (the pages re-check access).
function ContextLink({ id, label, href }: { id: string | undefined; label: string; href: string | null }) {
	if (!id) return <>Tidak ada</>;
	if (!href) return <>{label}</>;
	return (
		<a href={href} style={{ color: "#5b2a86", fontWeight: 600 }}>
			{label}
		</a>
	);
}

export function StaffInboxView({ staffUser }: { staffUser: StaffUser }) {
	// Catalog detail is for owner/ecommerce_admin catalog readers; the page re-checks access.
	const canOpenCatalog = staffUser.roles.some((r) => ["owner", "ecommerce_admin"].includes(r));
	const baseId = useId();
	const [assignmentFilter, setAssignmentFilter] = useState<
		"unassigned" | "assigned_to_me" | "all"
	>("unassigned");
	const [statusFilter, setStatusFilter] = useState<string>("");
	const [priorityFilter, setPriorityFilter] = useState<string>("");
	const [unreadOnly, setUnreadOnly] = useState<boolean>(false);

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
	const [submitting, setSubmitting] = useState(false);
	// One staff action at a time: they share the conversation revision, so a second click
	// would only produce VERSION_CONFLICT. The ref blocks a double click before re-render.
	const [busy, setBusy] = useState<StaffAction | null>(null);
	const busyRef = useRef(false);
	const [pendingReply, setPendingReply] = useState<{
		key: string;
		signature: string;
	} | null>(null);
	const [pendingNote, setPendingNote] = useState<{
		key: string;
		signature: string;
	} | null>(null);
	const [loadingOlder, setLoadingOlder] = useState(false);
	const activeConvRef = useRef<string | null>(null);
	const logRef = useRef<HTMLDivElement | null>(null);
	const scrollAnchorRef = useRef<{ height: number; top: number } | null>(null);
	const scrollToEndRef = useRef(false);
	const hasOlder = (messages[0]?.sequence ?? 1) > 1;

	useLayoutEffect(() => {
		const el = logRef.current;
		if (!el || messages.length === 0) return;
		const anchor = scrollAnchorRef.current;
		if (anchor) {
			el.scrollTop = anchor.top + (el.scrollHeight - anchor.height);
			scrollAnchorRef.current = null;
		} else if (scrollToEndRef.current) {
			el.scrollTop = el.scrollHeight;
			scrollToEndRef.current = false;
		}
	}, [messages]);

	// S113: the queue is a keyset DataTable (S104 server paging); a filter change starts at page one.
	const inboxParams = new URLSearchParams({ assignment: assignmentFilter, limit: "20" });
	if (statusFilter) inboxParams.set("status", statusFilter);
	if (priorityFilter) inboxParams.set("priority", priorityFilter);
	if (unreadOnly) inboxParams.set("unread", "true");
	const inboxList = useKeysetList<SupportStaffConversation>(
		`/api/v1/admin/support/conversations?${inboxParams.toString()}`,
		(item) => item.conversation.id,
	);
	const setInbox = (
		update: (prev: SupportStaffConversation[]) => SupportStaffConversation[],
	) => inboxList.setRows((prev) => (prev ? update(prev) : prev));

	useEffect(() => {
		let cancelled = false;
		async function bootstrap() {
			const [srRes, tagRes] = await Promise.all([
				fetch("/api/v1/admin/support/saved-replies", {
					headers: { Accept: "application/json" },
				}),
				fetch("/api/v1/admin/support/tags", {
					headers: { Accept: "application/json" },
				}),
			]);
			if (cancelled) return;
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

	function applyStaffItem(item: SupportStaffConversation) {
		// Revisions only grow; keep the higher one if classification answered first.
		setSelected((prev) =>
			prev?.conversation.id === item.conversation.id
				? {
						...item,
						assignment_version: Math.max(
							item.assignment_version,
							prev.assignment_version,
						),
					}
				: prev,
		);
		setInbox((prev) =>
			prev.map((x) => (x.conversation.id === item.conversation.id ? item : x)),
		);
	}

	async function fetchClassification(cid: string) {
		const res = await fetch(
			`/api/v1/admin/support/conversations/${cid}/classification`,
			{ headers: { Accept: "application/json" } },
		);
		if (!res.ok || activeConvRef.current !== cid) return;
		const c = (await res.json()) as Classification;
		if (activeConvRef.current !== cid) return;
		setClassification(c);
		// Classification carries the current conversation revision used by every staff mutation.
		setSelected((prev) =>
			prev?.conversation.id === cid && c.version > prev.assignment_version
				? { ...prev, assignment_version: c.version }
				: prev,
		);
	}

	async function loadLatestMessages(cid: string, lastKnown: number) {
		const latest = await fetchLatestMessages(
			`/api/v1/admin/support/conversations/${cid}/messages`,
			lastKnown,
		);
		if (activeConvRef.current !== cid) return;
		if (latest === null) {
			setError("Gagal memuat riwayat pesan.");
			return;
		}
		scrollToEndRef.current = true;
		setMessages((prev) => {
			const prevTop = prev.at(-1)?.sequence ?? 0;
			const gap = (latest[0]?.sequence ?? 0) > prevTop + 1;
			return gap ? latest : mergeMessages(prev, latest);
		});
	}

	// After a conflict: pull current assignment, status, version and newest messages. Never resubmits.
	async function refreshSelected(cid: string) {
		const [item] = await Promise.all([
			fetchStaffItem(cid),
			fetchClassification(cid),
		]);
		if (activeConvRef.current !== cid) return;
		if (item) applyStaffItem(item);
		await loadLatestMessages(
			cid,
			item?.conversation.last_message_sequence ??
				messages.at(-1)?.sequence ??
				0,
		);
	}

	async function selectThread(item: SupportStaffConversation) {
		const cid = item.conversation.id;
		activeConvRef.current = cid;
		setSelected(item);
		setMessages([]);
		setNotes([]);
		setClassification(null);
		setError(null);
		setFeedback(null);
		setNoteSearchHits(null);
		setUnresolvedPlaceholders([]);
		const [, noteRes] = await Promise.all([
			loadLatestMessages(cid, item.conversation.last_message_sequence),
			fetch(`/api/v1/admin/support/conversations/${cid}/notes`, {
				headers: { Accept: "application/json" },
			}),
			fetchClassification(cid),
		]);
		if (activeConvRef.current !== cid) return;
		if (noteRes.ok) {
			const n = (await noteRes.json()) as { data: InternalNote[] };
			setNotes(n.data);
		}
	}

	async function loadOlderMessages() {
		if (!selected || loadingOlder || !hasOlder) return;
		const cid = selected.conversation.id;
		const oldest = messages[0]?.sequence ?? 1;
		setLoadingOlder(true);
		setError(null);
		try {
			const page = await fetchMessageWindow(
				`/api/v1/admin/support/conversations/${cid}/messages`,
				oldest - MESSAGE_HALF - 1,
			);
			if (activeConvRef.current !== cid) return;
			if (!page) {
				setError("Pesan sebelumnya belum dimuat. Coba lagi.");
				return;
			}
			const older = page.filter((m) => m.sequence < oldest);
			const el = logRef.current;
			if (el) {
				scrollAnchorRef.current = {
					height: el.scrollHeight,
					top: el.scrollTop,
				};
			}
			setMessages((prev) => mergeMessages(prev, older));
			setFeedback(
				older.length > 0
					? `${older.length} pesan sebelumnya dimuat.`
					: "Tidak ada pesan sebelumnya.",
			);
			if ((older[0]?.sequence ?? 1) <= 1) logRef.current?.focus();
		} catch {
			if (activeConvRef.current === cid) {
				setError("Pesan sebelumnya belum dimuat. Coba lagi.");
			}
		} finally {
			setLoadingOlder(false);
		}
	}

	async function handleConflict(res: Response, cid: string, fallback: string) {
		const code = await problemCode(res);
		if (code === "VERSION_CONFLICT" || code === "ALREADY_CLAIMED") {
			await refreshSelected(cid);
			setError(code === "ALREADY_CLAIMED" ? fallback : CONFLICT_MESSAGE);
			return;
		}
		setError(fallback);
	}

	async function runAction(action: StaffAction, work: () => Promise<void>) {
		if (busyRef.current) return;
		busyRef.current = true;
		setBusy(action);
		setError(null);
		setFeedback(null);
		try {
			await work();
		} catch {
			setError(NETWORK_MESSAGE);
		} finally {
			busyRef.current = false;
			setBusy(null);
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
			await handleConflict(
				res,
				selected.conversation.id,
				"Klaim gagal karena percakapan sudah diklaim agen lain. Draf Anda tetap aman.",
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
			await handleConflict(
				res,
				selected.conversation.id,
				"Gagal mengubah penugasan. Pastikan target memiliki peran customer_service.",
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
			await handleConflict(
				res,
				selected.conversation.id,
				"Gagal mengubah status percakapan. Pastikan percakapan sudah Anda klaim.",
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
		if (submitting) return;
		setError(null);
		setFeedback(null);
		setSubmitting(true);
		// Reuse the key on retry of the same draft so a lost response cannot duplicate the reply.
		const signature = JSON.stringify([selected.conversation.id, publicDraft]);
		const clientMsgId =
			pendingReply?.signature === signature
				? pendingReply.key
				: makeKey("csmsg");
		setPendingReply({ key: clientMsgId, signature });
		try {
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
			const knownTop = messages.at(-1)?.sequence ?? 0;
			scrollToEndRef.current = true;
			setMessages((prev) => mergeMessages(prev, [created]));
			if (created.sequence > knownTop + 1) {
				// The buyer wrote meanwhile (revision bumped); refresh version and missing messages.
				void refreshSelected(selected.conversation.id);
			}
			setPublicDraft("");
			setPendingReply(null);
			setUnresolvedPlaceholders([]);
			setFeedback("Balasan publik terkirim ke pelanggan.");
		} catch {
			setError(
				"Koneksi terputus. Balasan belum pasti terkirim; kirim ulang draf yang sama.",
			);
		} finally {
			setSubmitting(false);
		}
	}

	async function sendInternalNote(e: React.FormEvent) {
		e.preventDefault();
		if (!selected || !noteDraft.trim() || submitting) return;
		setError(null);
		setFeedback(null);
		setSubmitting(true);
		const text = noteDraft.trim();
		const signature = JSON.stringify([selected.conversation.id, text]);
		const key =
			pendingNote?.signature === signature ? pendingNote.key : makeKey("note");
		setPendingNote({ key, signature });
		try {
			const res = await fetch(
				`/api/v1/admin/support/conversations/${selected.conversation.id}/notes`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"Idempotency-Key": key,
					},
					body: JSON.stringify({ text }),
				},
			);
			if (!res.ok) {
				setError("Gagal menyimpan catatan internal.");
				return;
			}
			const created = (await res.json()) as InternalNote;
			setNotes((prev) =>
				prev.some((n) => n.id === created.id) ? prev : [...prev, created],
			);
			setNoteDraft("");
			setPendingNote(null);
			setFeedback(
				"Catatan internal staf tersimpan (tidak terlihat oleh pelanggan).",
			);
		} catch {
			setError(
				"Koneksi terputus. Catatan belum pasti tersimpan; simpan ulang catatan yang sama.",
			);
		} finally {
			setSubmitting(false);
		}
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
		setError(null);
		setFeedback(null);
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
		if (!res.ok) {
			await handleConflict(
				res,
				selected.conversation.id,
				"Gagal memperbarui prioritas. Coba lagi.",
			);
			return;
		}
		const updated = (await res.json()) as Classification;
		setClassification(updated);
		setSelected((prev) =>
			prev ? { ...prev, assignment_version: updated.version } : prev,
		);
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
		if (!res.ok) {
			setError("Penanda baca belum tersimpan. Coba lagi.");
			return;
		}
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

	async function searchNotes() {
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
		if (!res.ok) {
			setError("Pencarian catatan gagal. Coba lagi.");
			return;
		}
		const body = (await res.json()) as { data: InternalNote[] };
		setNoteSearchHits(body.data);
	}

	const isClaimedByMe = selected?.assignee_user_id === staffUser.id;
	// Status and assignment need the claim (owner may act without it); the API enforces CLAIM_REQUIRED.
	const canAct = isClaimedByMe || staffUser.roles.includes("owner");

	const conversationCell = (item: SupportStaffConversation) => (
		<div className="flex min-w-0 flex-col">
			<span className="font-medium">Percakapan #{item.conversation.id.slice(0, 8)}</span>
			<span className="text-xs text-muted-foreground">
				{item.order_number ? `Pesanan ${item.order_number}` : "Tanpa pesanan"}
			</span>
		</div>
	);
	const assigneeText = (item: SupportStaffConversation) =>
		item.assignee_user_id === null
			? "Belum diklaim"
			: item.assignee_user_id === staffUser.id
				? "Saya"
				: "Staf lain";
	const openButton = (item: SupportStaffConversation) => {
		const open = selected?.conversation.id === item.conversation.id;
		return (
			<Button
				type="button"
				size="sm"
				variant={open ? "default" : "outline"}
				aria-pressed={open}
				onClick={() => void selectThread(item)}
			>
				Buka Detail
			</Button>
		);
	};

	return (
		<div className="flex flex-col gap-5 px-4 py-5 md:px-8 md:py-6">
			<header className="flex flex-wrap items-end justify-between gap-3 border-b pb-5">
				<div className="flex min-w-0 flex-col gap-1">
					<h1 className="text-2xl font-semibold tracking-tight">Kotak Masuk Pelanggan</h1>
					<p className="max-w-prose text-sm text-muted-foreground">
						Klaim percakapan sebelum membalas. Catatan internal tidak pernah terlihat oleh pelanggan.
					</p>
				</div>
				<div className="flex flex-wrap gap-2">
					<Button asChild variant="outline">
						<Link href="/admin">Ke Konsol Operasional</Link>
					</Button>
					<Button type="button" variant="outline" onClick={() => void inboxList.reload()}>
						<RefreshCw data-icon="inline-start" aria-hidden="true" />
						Segarkan Antrean
					</Button>
				</div>
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

			{/* Queue: filters and the keyset DataTable of conversations */}
			<section aria-labelledby={`${baseId}-queue-heading`} className="flex flex-col gap-3 rounded-lg border bg-card p-4">
				<h2 id={`${baseId}-queue-heading`} className="text-base font-semibold">
					Antrean percakapan
				</h2>
				<div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-4">
					<FormField id={`${baseId}-assign`} label="Klaim penugasan">
						<select
							id={`${baseId}-assign`}
							value={assignmentFilter}
							onChange={(e) => setAssignmentFilter(e.target.value as "unassigned" | "assigned_to_me" | "all")}
							className={nativeSelectClass}
						>
							<option value="unassigned">Belum diklaim</option>
							<option value="assigned_to_me">Klaim saya</option>
							<option value="all">Semua percakapan</option>
						</select>
					</FormField>
					<FormField id={`${baseId}-status`} label="Status percakapan">
						<select id={`${baseId}-status`} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={nativeSelectClass}>
							<option value="">Semua status</option>
							<option value="open">Terbuka</option>
							<option value="waiting_customer">Menunggu pelanggan</option>
							<option value="resolved">Selesai</option>
						</select>
					</FormField>
					<FormField id={`${baseId}-prio`} label="Prioritas internal">
						<select id={`${baseId}-prio`} value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} className={nativeSelectClass}>
							<option value="">Semua prioritas</option>
							<option value="high">Tinggi</option>
							<option value="normal">Normal</option>
							<option value="low">Rendah</option>
						</select>
					</FormField>
					<label className="flex min-h-9 items-center gap-2 text-sm font-medium">
						<input
							type="checkbox"
							className="size-4 accent-primary"
							checked={unreadOnly}
							onChange={(e) => setUnreadOnly(e.target.checked)}
						/>
						Hanya yang belum saya baca
					</label>
				</div>
				<DataTable
					rows={inboxList.rows}
					rowKey={(item) => item.conversation.id}
					status={inboxList.status}
					loadingLabel="Memuat antrean…"
					empty="Tidak ada percakapan untuk filter ini."
					caption="Antrean percakapan pelanggan"
					testId="support-inbox"
					rowTestId={(item) => `support-inbox-row-${item.conversation.id}`}
					paging={{ ...inboxList.paging, testId: "support-inbox-more" }}
					columns={[
						{
							id: "conversation",
							header: "Percakapan",
							cell: (item) => conversationCell(item),
						},
						{
							id: "status",
							header: "Status",
							cell: (item) => <Badge variant="outline">{STATUS_LABELS[item.conversation.status] ?? item.conversation.status}</Badge>,
						},
						{
							id: "assignee",
							header: "Penanggung jawab",
							className: "hidden lg:table-cell",
							cell: (item) => assigneeText(item),
						},
						{
							id: "unread",
							header: "Belum dibaca",
							className: "text-right tabular-nums",
							cell: (item) => item.current_agent_unread_messages,
						},
						{
							id: "open",
							header: <span className="sr-only">Tindakan</span>,
							className: "text-right",
							cell: (item) => openButton(item),
						},
					]}
					card={(item) => (
						<>
							<div className="flex flex-wrap items-start justify-between gap-2">
								{conversationCell(item)}
								<Badge variant="outline">{STATUS_LABELS[item.conversation.status] ?? item.conversation.status}</Badge>
							</div>
							<p className="text-xs text-muted-foreground">
								{assigneeText(item)} · {item.current_agent_unread_messages} belum dibaca
							</p>
							<div>{openButton(item)}</div>
						</>
					)}
				/>
			</section>

			<div
				style={{
					display: "grid",
					gridTemplateColumns:
						"repeat(auto-fit, minmax(min(100%, 22rem), 1fr))",
					gap: "20px",
					alignItems: "start",
				}}
			>
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
											onClick={() => runAction("claim", claimThread)}
											disabled={busy !== null}
											style={off(primaryBtn, busy !== null)}
										>
											{busy === "claim" ? "Mengklaim…" : "Klaim Percakapan"}
										</button>
									)}
									<button
										type="button"
										onClick={() => runAction("read", markStaffRead)}
										disabled={busy !== null}
										style={off(secondaryBtn, busy !== null)}
									>
										{busy === "read" ? "Menyimpan…" : "Tandai Dibaca"}
									</button>
								</div>
							</div>

							{hasOlder && (
								<button
									type="button"
									onClick={loadOlderMessages}
									aria-disabled={loadingOlder}
									aria-controls={`${baseId}-log`}
									style={{ ...secondaryBtn, justifySelf: "start" }}
								>
									{loadingOlder ? "Memuat pesan..." : "Muat pesan sebelumnya"}
								</button>
							)}

							<div
								ref={logRef}
								id={`${baseId}-log`}
								role="log"
								aria-label="Riwayat pesan publik pelanggan dan CS"
								aria-busy={loadingOlder}
								// biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable message history must be keyboard-scrollable
								tabIndex={0}
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
													Konteks {m.context.kind === "order" ? "pesanan" : "produk"}:{" "}
													{m.context.kind === "order" && m.context.order_id && m.context.availability === "available" && staffUser.canOpenOrders ? (
														<a href={`/admin/orders/${m.context.order_id}`} style={{ color: "#5b2a86", fontWeight: 600 }}>
															{m.context.title}
														</a>
													) : (
														m.context.title
													)}
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
									disabled={!isClaimedByMe || submitting}
									style={off(primaryBtn, !isClaimedByMe || submitting)}
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
								<button
									type="submit"
									disabled={submitting}
									style={off(noteBtn, submitting)}
								>
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
									<ContextLink
										id={selected.conversation.product_id}
										label={contextTitle(messages, "product", selected.conversation.product_id) ?? "Lihat produk"}
										href={canOpenCatalog ? `/admin/catalog/${selected.conversation.product_id}` : null}
									/>
								</span>
								<span>
									Pesanan Terverifikasi:{" "}
									<ContextLink
										id={selected.conversation.order_id}
										label={contextTitle(messages, "order", selected.conversation.order_id) ?? "Lihat detail pesanan"}
										href={staffUser.canOpenOrders ? `/admin/orders/${selected.conversation.order_id}` : null}
									/>
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
								{!canAct && (
									<p
										id={`${baseId}-claim-needed`}
										style={{ margin: 0, fontSize: "0.85rem", color: "#8b241d" }}
									>
										Klaim percakapan terlebih dahulu untuk mengubah status atau
										penugasan.
									</p>
								)}
								<div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
									{STATUS_ACTIONS.filter(
										([value]) => value !== selected.conversation.status,
									).map(([value, label]) => (
										<button
											key={value}
											type="button"
											onClick={() =>
												runAction(`status:${value}`, () => changeStatus(value))
											}
											disabled={!canAct || busy !== null}
											aria-describedby={
												canAct ? undefined : `${baseId}-claim-needed`
											}
											style={off(secondaryBtn, !canAct || busy !== null)}
										>
											{busy === `status:${value}` ? "Menyimpan…" : label}
										</button>
									))}
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
										onClick={() => {
											if (!handoffTarget.trim()) {
												setFeedback(null);
												setError("Isi ID staf tujuan.");
												return;
											}
											void runAction("assign", () =>
												handoffOrRelease(handoffTarget.trim()),
											);
										}}
										disabled={!canAct || busy !== null}
										aria-describedby={
											canAct ? undefined : `${baseId}-claim-needed`
										}
										style={off(secondaryBtn, !canAct || busy !== null)}
									>
										{busy === "assign" ? "Mengalihkan…" : "Alihkan Penugasan"}
									</button>
									{selected.assignee_user_id && (
										<button
											type="button"
											onClick={() =>
												runAction("release", () => handoffOrRelease(null))
											}
											disabled={!canAct || busy !== null}
											aria-describedby={
												canAct ? undefined : `${baseId}-claim-needed`
											}
											style={off(secondaryBtn, !canAct || busy !== null)}
										>
											{busy === "release" ? "Melepas…" : "Lepas ke Antrean"}
										</button>
									)}
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
										onChange={(e) => {
											const next = e.target.value as "low" | "normal" | "high";
											void runAction("priority", () => updatePriority(next));
										}}
										disabled={busy !== null}
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
													onClick={() =>
														runAction("saved-reply", () => insertSavedReply(sr))
													}
													disabled={busy !== null}
													style={off(secondaryBtn, busy !== null)}
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
									onSubmit={(e) => {
										e.preventDefault();
										void runAction("note-search", searchNotes);
									}}
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
									<button
										type="submit"
										disabled={busy !== null}
										style={off(secondaryBtn, busy !== null)}
									>
										{busy === "note-search" ? "Mencari…" : "Cari Catatan"}
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
		</div>
	);
}
