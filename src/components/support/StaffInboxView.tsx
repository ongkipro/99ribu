"use client";

import { cn } from "cn";
import { CircleAlert, CircleCheck, RefreshCw } from "lucide-react";
import Link from "next/link";
import type React from "react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { CardActions, CardMeta, CardTitle, DataTable } from "@/components/admin/data-table";
import { FilterSheet, FormField, nativeSelectClass } from "@/components/admin/form";
import { AdminPage, PageHeader, StickyActions } from "@/components/admin/page-blocks";
import { StatusBadge, type StatusTone } from "@/components/admin/status";
import { useKeysetList } from "@/components/admin/use-keyset-list";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { wibDateTime } from "@/modules/storefront/format";
import { adminPath } from "@/modules/access/admin-paths";

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
	/** Admin numbers of the conversation's order and product (the console links by them); null without one. */
	order_admin_no: number | null;
	product_admin_no: number | null;
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
const STATUS_TONE: Record<string, StatusTone> = { resolved: "done" };
const STATUS_ACTIONS = [
	["waiting_customer", "Tandai menunggu pelanggan"],
	["resolved", "Tandai selesai"],
	["open", "Buka kembali"],
] as const;
type SupportAgent = { id: string; name: string };

/**
 * One human label per conversation, the same in the inbox, the detail pane and the dashboard queue:
 * the printed order number, else "Percakapan tanpa pesanan" (the row also shows when it started).
 */
const conversationLabel = (item: { order_number: string | null }) =>
	item.order_number ? `Pesanan ${item.order_number}` : "Percakapan tanpa pesanan";
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
		<Link href={href} className="font-medium text-primary underline-offset-4 hover:underline pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center">
			{label}
		</Link>
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
	const [agents, setAgents] = useState<SupportAgent[]>([]);
	const agentName = (userId: string) =>
		userId === staffUser.id ? "Saya" : (agents.find((a) => a.id === userId)?.name ?? "Staf lain");

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
	const threadHeadingRef = useRef<HTMLHeadingElement>(null);
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
			const [srRes, tagRes, agentRes] = await Promise.all([
				fetch("/api/v1/admin/support/saved-replies", {
					headers: { Accept: "application/json" },
				}),
				fetch("/api/v1/admin/support/tags", {
					headers: { Accept: "application/json" },
				}),
				fetch("/api/v1/admin/support/agents", {
					headers: { Accept: "application/json" },
				}),
			]);
			if (cancelled) return;
			if (agentRes.ok) {
				const agentBody = (await agentRes.json()) as { data?: SupportAgent[] };
				setAgents(agentBody.data ?? []);
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
		// Phones stack the thread under the queue: bring it into view and move focus to its title.
		if (window.matchMedia("(max-width: 767px)").matches)
			requestAnimationFrame(() => {
				threadHeadingRef.current?.scrollIntoView({ block: "start" });
				threadHeadingRef.current?.focus({ preventScroll: true });
			});
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
				"Gagal mengubah penugasan. Staf tujuan harus staf layanan pelanggan atau Super Admin.",
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
				? `Dialihkan ke ${agentName(targetUserId)}.`
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
		setFeedback(`Status diubah menjadi ${STATUS_LABELS[nextStatus] ?? nextStatus}.`);
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
			<span className="font-medium">{conversationLabel(item)}</span>
			<span className="text-xs text-muted-foreground tabular-nums">
				Dibuat {wibDateTime(item.conversation.created_at)}
			</span>
		</div>
	);
	const assigneeText = (item: SupportStaffConversation) =>
		item.assignee_user_id === null ? "Belum diklaim" : agentName(item.assignee_user_id);
	const statusBadge = (status: string) => (
		<StatusBadge tone={STATUS_TONE[status] ?? "open"}>{STATUS_LABELS[status] ?? status}</StatusBadge>
	);
	const openButton = (item: SupportStaffConversation) => {
		const open = selected?.conversation.id === item.conversation.id;
		return (
			<Button
				type="button"
				size="sm"
				variant={open ? "secondary" : "outline"}
				aria-pressed={open}
				onClick={() => void selectThread(item)}
			>
				Buka detail
			</Button>
		);
	};
	const handoffAgents = agents.filter((a) => a.id !== selected?.assignee_user_id);
	const claimNeededId = `${baseId}-claim-needed`;

	return (
		<AdminPage>
			<PageHeader
				title="Kotak Masuk Pelanggan"
				description="Klaim percakapan sebelum membalas. Catatan internal tidak pernah terlihat oleh pelanggan."
				actions={
					<Button type="button" variant="outline" onClick={() => void inboxList.reload()}>
						<RefreshCw data-icon="inline-start" aria-hidden="true" />
						Segarkan antrean
					</Button>
				}
			/>

			{error && (
				<Alert
					role="alert"
					variant="destructive"
					className="border-destructive/40 bg-destructive-surface [overflow-wrap:anywhere]"
				>
					<CircleAlert aria-hidden="true" />
					<AlertDescription className="text-foreground">{error}</AlertDescription>
				</Alert>
			)}

			{feedback && (
				<output className="block">
					<Alert className="border-primary/30 bg-secondary">
						<CircleCheck aria-hidden="true" />
						<AlertDescription className="text-foreground">{feedback}</AlertDescription>
					</Alert>
				</output>
			)}

			{/* Queue: filters and the keyset DataTable of conversations */}
			<section aria-labelledby={`${baseId}-queue-heading`} className="flex flex-col gap-3 md:rounded-lg md:border md:bg-card md:p-4">
				<h2 id={`${baseId}-queue-heading`} className="text-base font-semibold">
					Antrean percakapan
				</h2>
				<div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-4">
					<FilterSheet
						active={
							(assignmentFilter === "unassigned" ? 0 : 1) +
							(statusFilter ? 1 : 0) +
							(priorityFilter ? 1 : 0) +
							(unreadOnly ? 1 : 0)
						}
					>
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
						<label className="flex min-h-9 items-center gap-2 text-sm font-medium pointer-coarse:min-h-11">
							<input
								type="checkbox"
								className="size-4 accent-primary"
								checked={unreadOnly}
								onChange={(e) => setUnreadOnly(e.target.checked)}
							/>
							Hanya yang belum saya baca
						</label>
					</FilterSheet>
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
					activeKey={selected?.conversation.id ?? null}
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
							// md–xl hides the assignee column; the claim state stays under the status
							// ("Belum diklaim", the dashboard's word too).
							cell: (item) => (
								<div className="flex flex-col items-start gap-1">
									{statusBadge(item.conversation.status)}
									<span className="text-xs text-muted-foreground xl:hidden">{assigneeText(item)}</span>
								</div>
							),
						},
						{
							id: "assignee",
							header: "Penanggung jawab",
							className: "hidden xl:table-cell",
							cell: (item) => assigneeText(item),
						},
						{
							id: "unread",
							header: "Belum dibaca",
							className: "text-right tabular-nums",
							cell: (item) => item.current_agent_unread_messages,
						},
						{
							id: "actions",
							header: <span className="sr-only">Tindakan</span>,
							className: "text-right",
							cell: (item) => openButton(item),
						},
					]}
					card={(item) => (
						<>
							<CardTitle title={conversationCell(item)} aside={statusBadge(item.conversation.status)} />
							<CardMeta>
								{assigneeText(item)} · {item.current_agent_unread_messages} belum dibaca
							</CardMeta>
							<CardActions>{openButton(item)}</CardActions>
						</>
					)}
				/>
			</section>

			{/* Phones show the thread and its tools only once a conversation is open. */}
			<div className={cn("grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]", !selected && "max-md:hidden")}>
				{/* Thread, public reply and the separate internal note */}
				<section
					aria-label="Percakapan aktif dan editor balasan"
					className="flex min-w-0 flex-col gap-4 rounded-lg border bg-card p-4"
				>
					{!selected ? (
						<p className="text-sm text-muted-foreground">
							Pilih satu percakapan dari antrean untuk memeriksa riwayat, mengklaim, atau membalas.
						</p>
					) : (
						<>
							<div className="flex flex-wrap items-start justify-between gap-3 border-b pb-3">
								<div className="flex min-w-0 flex-col gap-1.5">
									<h2
										ref={threadHeadingRef}
										tabIndex={-1}
										className="scroll-mt-16 text-lg font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
									>
										{conversationLabel(selected)}
									</h2>
									<div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
										{statusBadge(selected.conversation.status)}
										<span>
											Pemegang klaim:{" "}
											<span className="font-medium text-foreground">{assigneeText(selected)}</span>
										</span>
									</div>
								</div>
								{/* The thread's primary actions: a sticky bottom bar on phones. */}
								<StickyActions>
									{!isClaimedByMe && (
										<Button
											type="button"
											onClick={() => runAction("claim", claimThread)}
											disabled={busy !== null}
										>
											{busy === "claim" ? "Mengklaim…" : "Klaim percakapan"}
										</Button>
									)}
									<Button
										type="button"
										variant="outline"
										onClick={() => runAction("read", markStaffRead)}
										disabled={busy !== null}
									>
										{busy === "read" ? "Menyimpan…" : "Tandai dibaca"}
									</Button>
								</StickyActions>
							</div>

							{hasOlder && (
								<Button
									type="button"
									variant="outline"
									size="sm"
									className="self-start"
									onClick={loadOlderMessages}
									aria-disabled={loadingOlder}
									aria-controls={`${baseId}-log`}
								>
									{loadingOlder ? "Memuat pesan…" : "Muat pesan sebelumnya"}
								</Button>
							)}

							<div
								ref={logRef}
								id={`${baseId}-log`}
								role="log"
								aria-label="Riwayat pesan publik pelanggan dan CS"
								aria-busy={loadingOlder}
								// biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable message history must be keyboard-scrollable
								tabIndex={0}
								className="flex max-h-80 flex-col gap-2 overflow-y-auto rounded-md border bg-muted/40 p-2.5 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
							>
								{messages.length === 0 ? (
									<p className="text-sm text-muted-foreground">Belum ada pesan publik.</p>
								) : (
									messages.map((m) => (
										<article
											key={m.id}
											className={cn(
												"rounded-md border px-2.5 py-2 text-sm [overflow-wrap:anywhere]",
												m.sender === "customer_service" ? "border-primary/20 bg-secondary" : "bg-card",
											)}
										>
											<p className="text-xs font-medium text-muted-foreground">
												{m.sender === "buyer" ? "Pelanggan" : "CS"} · {wibDateTime(m.created_at)}
											</p>
											{m.context && (
												<p className="mt-1 rounded-sm bg-warning-surface px-2 py-1 text-xs">
													Konteks {m.context.kind === "order" ? "pesanan" : "produk"}:{" "}
													{m.context.kind === "order" && m.context.order_id && m.context.availability === "available" && staffUser.canOpenOrders && selected?.order_admin_no != null ? (
														<Link href={adminPath("order", selected.order_admin_no)} className="font-medium text-primary underline-offset-4 hover:underline pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center">
															{m.context.title}
														</Link>
													) : (
														m.context.title
													)}
												</p>
											)}
											<p className="mt-1 whitespace-pre-wrap">{m.text}</p>
										</article>
									))
								)}
							</div>

							{/* Public customer reply */}
							<form onSubmit={sendPublicReply} className="flex flex-col gap-3 rounded-md border border-primary/40 p-3">
								<FormField
									id={`${baseId}-pub-reply`}
									label="Balasan publik ke pelanggan"
									hint={!isClaimedByMe ? "Klaim percakapan terlebih dahulu sebelum mengirim balasan publik ke pelanggan." : undefined}
								>
									<Textarea
										id={`${baseId}-pub-reply`}
										rows={3}
										maxLength={4000}
										value={publicDraft}
										onChange={(e) => setPublicDraft(e.target.value)}
										placeholder="Tulis balasan yang akan dilihat pelanggan…"
										aria-describedby={!isClaimedByMe ? `${baseId}-pub-reply-hint` : undefined}
									/>
								</FormField>
								{unresolvedPlaceholders.length > 0 && (
									<p className="text-sm text-warning">
										Isian template belum lengkap ({unresolvedPlaceholders.join(", ")}). Ubah draf sebelum mengirim.
									</p>
								)}
								<Button type="submit" className="self-start" disabled={!isClaimedByMe || submitting}>
									Kirim balasan publik
								</Button>
							</form>

							{/* Staff-only internal note */}
							<form
								onSubmit={sendInternalNote}
								className="flex flex-col gap-3 rounded-md border border-dashed border-warning/60 bg-warning-surface p-3"
							>
								<FormField
									id={`${baseId}-staff-note`}
									label="Catatan internal staf"
									hint="Privat, tidak pernah dikirim ke pelanggan."
								>
									<Textarea
										id={`${baseId}-staff-note`}
										rows={2}
										maxLength={4000}
										value={noteDraft}
										onChange={(e) => setNoteDraft(e.target.value)}
										placeholder="Tulis catatan untuk sesama staf CS…"
										aria-describedby={`${baseId}-staff-note-hint`}
										className="bg-card"
									/>
								</FormField>
								<Button type="submit" variant="outline" className="self-start bg-card" disabled={submitting}>
									Simpan catatan internal
								</Button>
							</form>
						</>
					)}
				</section>

				{/* Context, assignment, saved replies and internal notes */}
				<section
					aria-labelledby={`${baseId}-tools-heading`}
					className="flex min-w-0 flex-col gap-4 rounded-lg border bg-card p-4"
				>
					<h2 id={`${baseId}-tools-heading`} className="text-base font-semibold">
						Konteks dan alat kerja
					</h2>
					{selected ? (
						<>
							<dl className="grid gap-1.5 rounded-md border p-3 text-sm">
								<div className="flex flex-wrap justify-between gap-x-3">
									<dt className="text-muted-foreground">Produk terkait</dt>
									<dd>
										<ContextLink
											id={selected.conversation.product_id}
											label={contextTitle(messages, "product", selected.conversation.product_id) ?? "Lihat produk"}
											href={canOpenCatalog && selected.product_admin_no != null ? adminPath("product", selected.product_admin_no) : null}
										/>
									</dd>
								</div>
								<div className="flex flex-wrap justify-between gap-x-3">
									<dt className="text-muted-foreground">Pesanan terverifikasi</dt>
									<dd>
										<ContextLink
											id={selected.conversation.order_id}
											label={selected.order_number ?? contextTitle(messages, "order", selected.conversation.order_id) ?? "Lihat detail pesanan"}
											href={staffUser.canOpenOrders && selected.order_admin_no != null ? adminPath("order", selected.order_admin_no) : null}
										/>
									</dd>
								</div>
								<p className="pt-1 text-xs text-muted-foreground">
									Chat atau klaim CS tidak mengotorisasi pengembalian dana, pencairan, atau perubahan stok.
								</p>
							</dl>

							<div className="flex flex-col gap-3">
								<FormField id={`${baseId}-reason`} label="Alasan tindakan (tercatat di audit)">
									<Input
										id={`${baseId}-reason`}
										value={actionReason}
										onChange={(e) => setActionReason(e.target.value)}
										maxLength={500}
									/>
								</FormField>
								{!canAct && (
									<p id={claimNeededId} className="text-sm text-muted-foreground">
										Klaim percakapan terlebih dahulu untuk mengubah status atau penugasan.
									</p>
								)}
								<div className="flex flex-wrap gap-2">
									{STATUS_ACTIONS.filter(([value]) => value !== selected.conversation.status).map(([value, label]) => (
										<Button
											key={value}
											type="button"
											variant="outline"
											onClick={() => runAction(`status:${value}`, () => changeStatus(value))}
											disabled={!canAct || busy !== null}
											aria-describedby={canAct ? undefined : claimNeededId}
										>
											{busy === `status:${value}` ? "Menyimpan…" : label}
										</Button>
									))}
								</div>
							</div>

							<div className="flex flex-col gap-3 border-t pt-4">
								<FormField
									id={`${baseId}-handoff`}
									label="Alihkan ke staf CS lain"
									hint={agents.length === 0 ? "Daftar staf belum termuat." : undefined}
								>
									<select
										id={`${baseId}-handoff`}
										value={handoffTarget}
										onChange={(e) => setHandoffTarget(e.target.value)}
										className={nativeSelectClass}
										aria-describedby={agents.length === 0 ? `${baseId}-handoff-hint` : undefined}
									>
										<option value="">Pilih staf</option>
										{handoffAgents.map((a) => (
											<option key={a.id} value={a.id}>
												{a.id === staffUser.id ? `${a.name} (saya)` : a.name}
											</option>
										))}
									</select>
								</FormField>
								<div className="flex flex-wrap gap-2">
									<Button
										type="button"
										variant="outline"
										onClick={() => {
											if (!handoffTarget) {
												setFeedback(null);
												setError("Pilih staf tujuan.");
												return;
											}
											void runAction("assign", () => handoffOrRelease(handoffTarget));
										}}
										disabled={!canAct || busy !== null}
										aria-describedby={canAct ? undefined : claimNeededId}
									>
										{busy === "assign" ? "Mengalihkan…" : "Alihkan penugasan"}
									</Button>
									{selected.assignee_user_id && (
										<Button
											type="button"
											variant="outline"
											onClick={() => runAction("release", () => handoffOrRelease(null))}
											disabled={!canAct || busy !== null}
											aria-describedby={canAct ? undefined : claimNeededId}
										>
											{busy === "release" ? "Melepas…" : "Lepas ke antrean"}
										</Button>
									)}
								</div>
							</div>

							{classification && (
								<div className="flex flex-col gap-2 border-t pt-4">
									<FormField id={`${baseId}-set-prio`} label="Prioritas percakapan">
										<select
											id={`${baseId}-set-prio`}
											value={classification.priority}
											onChange={(e) => {
												const next = e.target.value as "low" | "normal" | "high";
												void runAction("priority", () => updatePriority(next));
											}}
											disabled={busy !== null}
											className={nativeSelectClass}
										>
											<option value="low">Rendah</option>
											<option value="normal">Normal</option>
											<option value="high">Tinggi</option>
										</select>
									</FormField>
									{tags.length > 0 && (
										<p className="text-sm text-muted-foreground">
											Tag tersedia: {tags.map((t) => t.label).join(", ")}
										</p>
									)}
								</div>
							)}

							<div className="flex flex-col gap-2 border-t pt-4">
								<h3 className="text-sm font-semibold">Template balasan</h3>
								{!staffUser.canManageTools && (
									<p className="text-xs text-muted-foreground">
										Anda dapat memakai template; mengubahnya hanya untuk supervisor atau Super Admin.
									</p>
								)}
								{savedReplies.length === 0 ? (
									<p className="text-sm text-muted-foreground">Belum ada template tersimpan.</p>
								) : (
									<ul className="flex flex-col divide-y rounded-md border">
										{savedReplies.map((sr) => (
											<li key={sr.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
												<span className="text-sm font-medium">{sr.title}</span>
												<Button
													type="button"
													variant="outline"
													size="sm"
													onClick={() => runAction("saved-reply", () => insertSavedReply(sr))}
													disabled={busy !== null}
												>
													Sisipkan ke draf
												</Button>
											</li>
										))}
									</ul>
								)}
							</div>

							<div className="flex flex-col gap-2 border-t pt-4">
								<h3 className="text-sm font-semibold">Catatan internal ({notes.length})</h3>
								<form
									onSubmit={(e) => {
										e.preventDefault();
										void runAction("note-search", searchNotes);
									}}
									className="flex flex-wrap gap-2"
								>
									<Input
										type="search"
										aria-label="Cari catatan internal"
										value={noteSearchQuery}
										onChange={(e) => setNoteSearchQuery(e.target.value)}
										placeholder="Cari catatan internal…"
										className="min-w-0 flex-[1_1_10rem]"
									/>
									<Button type="submit" variant="outline" disabled={busy !== null}>
										{busy === "note-search" ? "Mencari…" : "Cari catatan"}
									</Button>
								</form>
								<ul className="flex flex-col gap-1.5">
									{(noteSearchHits ?? notes).map((n) => (
										<li
											key={n.id}
											className="rounded-md border border-dashed border-warning/60 bg-warning-surface px-3 py-2 text-sm [overflow-wrap:anywhere]"
										>
											<span className="block text-xs font-medium text-muted-foreground">
												{agentName(n.author_id)} · {wibDateTime(n.created_at)}
											</span>
											{n.text}
										</li>
									))}
								</ul>
							</div>
						</>
					) : (
						<p className="text-sm text-muted-foreground">
							Pilih percakapan untuk melihat konteks, klasifikasi, dan catatan internal.
						</p>
					)}
				</section>
			</div>
		</AdminPage>
	);
}
