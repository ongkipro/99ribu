"use client";

import type React from "react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../storefront/icon";

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

type SupportAttachment = {
	id: string;
	media_type: "image/jpeg" | "image/png" | "image/webp";
	size_bytes: number;
	status: "pending_scan" | "ready" | "rejected";
};

type SupportMessage = {
	id: string;
	conversation_id: string;
	sequence: number;
	client_message_id: string;
	sender: "buyer" | "customer_service";
	text: string;
	attachments: SupportAttachment[];
	created_at: string;
	reply?: {
		message_id: string;
		state: "visible" | "redacted" | "expired";
		excerpt: string;
	};
	context?: {
		kind: "product" | "order";
		product_id?: string;
		variant_id?: string;
		order_id?: string;
		title: string;
		availability: "available" | "unavailable" | "redacted";
		snapshot_at: string;
	};
};

type SupportPreference = {
	conversation_id: string;
	version: number;
	archived: boolean;
	muted: boolean;
	updated_at: string;
};

type PrivateNotification = {
	id: string;
	kind: string;
	target_kind: string;
	target_id: string;
	created_at: string;
	seen_at: string | null;
	dismissed_at: string | null;
	version: number;
};

type SearchHit = {
	message_id: string;
	sequence: number;
	excerpt: string;
	created_at: string;
};

// around_sequence returns sequences within +/- limit/2 of the anchor.
const MESSAGE_WINDOW = 40;
const MESSAGE_HALF = MESSAGE_WINDOW / 2;
const CONFLICT_MESSAGE = "Percakapan diperbarui. Coba lagi.";

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
	let around = Math.max(1, lastKnown);
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

async function problemCode(res: Response) {
	try {
		return ((await res.json()) as { code?: string }).code ?? null;
	} catch {
		return null;
	}
}

function makeClientKey(prefixStr: string) {
	const rand =
		typeof crypto !== "undefined" && "randomUUID" in crypto
			? crypto.randomUUID().replaceAll("-", "")
			: `${Date.now()}${Math.random().toString(36).slice(2, 12)}`;
	return `${prefixStr}_${rand}`.slice(0, 48);
}

const btnStyle: React.CSSProperties = {
	minHeight: "44px",
	padding: "10px 20px",
	borderRadius: "9999px",
	border: "1px solid #5b35d5",
	background: "#5b35d5",
	color: "#fff",
	fontWeight: 600,
	fontSize: "0.9rem",
	display: "inline-flex",
	alignItems: "center",
	justifyContent: "center",
	gap: "6px",
	maxWidth: "100%",
};

// Same role and look as the storefront .button.secondary (purple outline pill).
const secondaryBtnStyle: React.CSSProperties = {
	...btnStyle,
	background: "#fff",
	color: "#5b35d5",
	border: "1px solid #5b35d5",
};

const inputStyle: React.CSSProperties = {
	minHeight: "44px",
	width: "100%",
	minWidth: 0,
	maxWidth: "100%",
	padding: "10px 12px",
	// Border, radius and focus come from the storefront field contract in globals.css.
	background: "#fff",
	color: "#18181b",
	fontSize: "1rem",
	boxSizing: "border-box",
};

export function CustomerChatView() {
	const baseId = useId();
	const [sessionReady, setSessionReady] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [liveNotice, setLiveNotice] = useState("");

	const [conversations, setConversations] = useState<SupportConversation[]>([]);
	const [viewFilter, setViewFilter] = useState<"active" | "archived" | "all">(
		"active",
	);
	const [statusFilter, setStatusFilter] = useState<string>("");
	const [convSearchQuery, setConvSearchQuery] = useState("");

	const [selectedConv, setSelectedConv] = useState<SupportConversation | null>(
		null,
	);
	const [messages, setMessages] = useState<SupportMessage[]>([]);
	const [preference, setPreference] = useState<SupportPreference | null>(null);
	const [notifications, setNotifications] = useState<PrivateNotification[]>([]);

	const [draftText, setDraftText] = useState("");
	const [replyTo, setReplyTo] = useState<SupportMessage | null>(null);
	const [pendingContext, setPendingContext] = useState<
		| { kind: "product"; product_id: string }
		| { kind: "order"; order_id: string; order_token?: string }
		| null
	>(null);
	const [contextTypeInput, setContextTypeInput] = useState<
		"none" | "product" | "order"
	>("none");
	const [contextIdInput, setContextIdInput] = useState("");
	const [orderTokenInput, setOrderTokenInput] = useState("");

	const [uploadedAttachments, setUploadedAttachments] = useState<
		SupportAttachment[]
	>([]);
	const [sending, setSending] = useState(false);
	// Retry reuses the key only while the hashed payload is unchanged; any edit is a new message.
	const [pendingSend, setPendingSend] = useState<{
		key: string;
		signature: string;
	} | null>(null);

	const [threadSearchQuery, setThreadSearchQuery] = useState("");
	const [threadSearchHits, setThreadSearchHits] = useState<SearchHit[] | null>(
		null,
	);

	const [viewerAttachment, setViewerAttachment] =
		useState<SupportAttachment | null>(null);
	const [viewerZoom, setViewerZoom] = useState(1);
	const viewerTriggerRef = useRef<HTMLButtonElement | null>(null);
	const isComposingRef = useRef(false);
	const selectedConvId = selectedConv?.id ?? null;
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

	useEffect(() => {
		if (!selectedConvId) return;
		try {
			const saved = sessionStorage.getItem(`support.draft.${selectedConvId}`);
			if (saved) {
				const parsed = JSON.parse(saved) as { text?: string };
				setDraftText(parsed.text ?? "");
			} else {
				setDraftText("");
			}
		} catch {
			setDraftText("");
		}
	}, [selectedConvId]);

	function updateDraftText(value: string) {
		setDraftText(value);
		if (selectedConv) {
			try {
				if (value) {
					sessionStorage.setItem(
						`support.draft.${selectedConv.id}`,
						JSON.stringify({ text: value }),
					);
				} else {
					sessionStorage.removeItem(`support.draft.${selectedConv.id}`);
				}
			} catch {
				// sessionStorage unavailable
			}
		}
	}

	async function ensureGuestSession() {
		const res = await fetch("/api/v1/guest-support-sessions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Idempotency-Key": makeClientKey("gsess"),
			},
			body: JSON.stringify({ client_request_id: makeClientKey("req") }),
		});
		if (!res.ok) {
			throw new Error("Gagal menyiapkan sesi chat bantuan.");
		}
		setSessionReady(true);
	}

	async function loadConversations(
		nextView: "active" | "archived" | "all" = viewFilter,
		nextStatus = statusFilter,
	) {
		setLoading(true);
		setError(null);
		try {
			if (!sessionReady) {
				await ensureGuestSession();
			}
			const params = new URLSearchParams({ view: nextView });
			if (nextStatus) params.set("status", nextStatus);
			const res = await fetch(
				`/api/v1/support/conversations?${params.toString()}`,
				{
					headers: { Accept: "application/json" },
				},
			);
			if (!res.ok) throw new Error("Gagal memuat daftar percakapan.");
			const body = (await res.json()) as { data: SupportConversation[] };
			setConversations(body.data);
			const notifRes = await fetch("/api/v1/support/notifications", {
				headers: { Accept: "application/json" },
			});
			if (notifRes.ok) {
				const notifBody = (await notifRes.json()) as {
					data: PrivateNotification[];
				};
				setNotifications(notifBody.data);
			}
		} catch (err) {
			setError(
				err instanceof Error ? err.message : "Terjadi gangguan jaringan.",
			);
		} finally {
			setLoading(false);
		}
	}

	async function startNewConversation() {
		setLoading(true);
		setError(null);
		try {
			if (!sessionReady) {
				await ensureGuestSession();
			}
			const payload: Record<string, string> = {
				client_conversation_id: makeClientKey("conv"),
			};
			const headers: Record<string, string> = {
				"Content-Type": "application/json",
				"Idempotency-Key": makeClientKey("cconv"),
			};
			if (pendingContext?.kind === "product") {
				payload.product_id = pendingContext.product_id;
			} else if (pendingContext?.kind === "order") {
				payload.order_id = pendingContext.order_id;
				if (pendingContext.order_token) {
					headers["X-Order-Token"] = pendingContext.order_token;
				}
			}
			const res = await fetch("/api/v1/support/conversations", {
				method: "POST",
				headers,
				body: JSON.stringify(payload),
			});
			if (!res.ok) {
				throw new Error(
					"Konteks tidak valid atau akses pesanan tidak terverifikasi.",
				);
			}
			const conv = (await res.json()) as SupportConversation;
			setConversations((prev) => [
				conv,
				...prev.filter((c) => c.id !== conv.id),
			]);
			await openThread(conv);
			setLiveNotice("Percakapan bantuan siap digunakan.");
		} catch (err) {
			setError(
				err instanceof Error ? err.message : "Gagal memulai percakapan.",
			);
		} finally {
			setLoading(false);
		}
	}

	function applyFreshConversation(fresh: SupportConversation) {
		setSelectedConv((prev) => (prev?.id === fresh.id ? fresh : prev));
		setConversations((prev) =>
			prev.map((c) => (c.id === fresh.id ? fresh : c)),
		);
	}

	// Refetches the conversation, then the newest message window, and merges it.
	async function syncLatest(convId: string, scrollToEnd: boolean) {
		const base = `/api/v1/support/conversations/${convId}`;
		const convRes = await fetch(base, {
			headers: { Accept: "application/json" },
		});
		if (activeConvRef.current !== convId) return false;
		if (!convRes.ok) return false;
		const fresh = (await convRes.json()) as SupportConversation;
		if (activeConvRef.current !== convId) return false;
		applyFreshConversation(fresh);
		const lastKnown = fresh.last_message_sequence;
		const latest =
			lastKnown < 1
				? []
				: await fetchLatestMessages(`${base}/messages`, lastKnown);
		if (activeConvRef.current !== convId || latest === null) return false;
		if (scrollToEnd) scrollToEndRef.current = true;
		setMessages((prev) => {
			const prevTop = prev.at(-1)?.sequence ?? 0;
			const gap = (latest[0]?.sequence ?? 0) > prevTop + 1;
			return gap ? latest : mergeMessages(prev, latest);
		});
		return true;
	}

	async function openThread(conv: SupportConversation) {
		activeConvRef.current = conv.id;
		setSelectedConv(conv);
		setMessages([]);
		setPreference(null);
		setThreadSearchHits(null);
		setReplyTo(null);
		setError(null);
		try {
			const [synced, prefRes] = await Promise.all([
				syncLatest(conv.id, true),
				fetch(`/api/v1/support/conversations/${conv.id}/preferences`, {
					headers: { Accept: "application/json" },
				}),
			]);
			if (activeConvRef.current !== conv.id) return;
			if (!synced) setError("Gagal memuat riwayat pesan.");
			if (prefRes.ok) {
				const prefData = (await prefRes.json()) as SupportPreference;
				setPreference(prefData);
			}
		} catch {
			if (activeConvRef.current === conv.id) {
				setError("Gagal memuat riwayat pesan.");
			}
		}
	}

	async function loadOlderMessages() {
		if (!selectedConv || loadingOlder || !hasOlder) return;
		const convId = selectedConv.id;
		const oldest = messages[0]?.sequence ?? 1;
		setLoadingOlder(true);
		setError(null);
		try {
			const page = await fetchMessageWindow(
				`/api/v1/support/conversations/${convId}/messages`,
				oldest - MESSAGE_HALF - 1,
			);
			if (activeConvRef.current !== convId) return;
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
			setLiveNotice(
				older.length > 0
					? `${older.length} pesan sebelumnya dimuat.`
					: "Tidak ada pesan sebelumnya.",
			);
			if ((older[0]?.sequence ?? 1) <= 1) logRef.current?.focus();
		} catch {
			if (activeConvRef.current === convId) {
				setError("Pesan sebelumnya belum dimuat. Coba lagi.");
			}
		} finally {
			setLoadingOlder(false);
		}
	}

	async function sendMessage(e?: React.FormEvent) {
		if (e) e.preventDefault();
		if (!selectedConv || sending) return;
		const readyAttachmentIds = uploadedAttachments
			.filter((a) => a.status === "ready")
			.map((a) => a.id);
		if (!draftText.trim() && readyAttachmentIds.length === 0) {
			setError("Tulis pesan atau lampirkan gambar yang siap dikirim.");
			return;
		}
		if (pendingContext && !draftText.trim()) {
			setError(
				"Pengiriman konteks wajib disertai keterangan teks yang terlihat.",
			);
			return;
		}
		setSending(true);
		setError(null);
		try {
			const headers: Record<string, string> = {
				"Content-Type": "application/json",
			};
			const payload: Record<string, unknown> = {
				text: draftText,
				attachment_ids: readyAttachmentIds,
			};
			if (replyTo) {
				payload.reply_to_message_id = replyTo.id;
			}
			if (pendingContext) {
				if (pendingContext.kind === "product") {
					payload.context = {
						kind: "product",
						product_id: pendingContext.product_id,
					};
				} else {
					payload.context = {
						kind: "order",
						order_id: pendingContext.order_id,
					};
					if (pendingContext.order_token) {
						headers["X-Order-Token"] = pendingContext.order_token;
					}
				}
			}
			const signature = JSON.stringify([selectedConv.id, payload]);
			const clientMsgId =
				pendingSend?.signature === signature
					? pendingSend.key
					: makeClientKey("cmsg");
			setPendingSend({ key: clientMsgId, signature });
			headers["Idempotency-Key"] = clientMsgId;
			const res = await fetch(
				`/api/v1/support/conversations/${selectedConv.id}/messages`,
				{
					method: "POST",
					headers,
					body: JSON.stringify({ ...payload, client_message_id: clientMsgId }),
				},
			);
			if (!res.ok) {
				throw new Error(
					"Pesan belum terkirim. Draf tetap disimpan untuk dicoba kembali.",
				);
			}
			const created = (await res.json()) as SupportMessage;
			const knownTop = messages.at(-1)?.sequence ?? 0;
			scrollToEndRef.current = true;
			setMessages((prev) => mergeMessages(prev, [created]));
			if (created.sequence > knownTop + 1) {
				// CS replied meanwhile; pull the missing messages and current conversation.
				void syncLatest(selectedConv.id, true);
			}
			updateDraftText("");
			setPendingSend(null);
			setReplyTo(null);
			setPendingContext(null);
			setUploadedAttachments([]);
			setLiveNotice("Pesan terkirim.");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Gagal mengirim pesan.");
		} finally {
			setSending(false);
		}
	}

	async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
		const file = e.target.files?.[0];
		e.target.value = "";
		if (!file || !selectedConv) return;
		if (uploadedAttachments.length >= 3) {
			setError("Maksimal 3 gambar per pesan.");
			return;
		}
		if (file.size > 5_242_880) {
			setError("Ukuran gambar maksimal 5 MiB.");
			return;
		}
		setError(null);
		try {
			const form = new FormData();
			form.set("client_attachment_id", makeClientKey("catt"));
			form.set("file", file);
			const res = await fetch(
				`/api/v1/support/conversations/${selectedConv.id}/attachments`,
				{
					method: "POST",
					headers: {
						"Idempotency-Key": makeClientKey("uatt"),
					},
					body: form,
				},
			);
			if (!res.ok) {
				throw new Error(
					"Format gambar tidak didukung. Gunakan JPEG, PNG, atau WebP maksimal 5 MiB.",
				);
			}
			const att = (await res.json()) as SupportAttachment;
			setUploadedAttachments((prev) => [...prev, att]);
		} catch (err) {
			setError(
				err instanceof Error ? err.message : "Gagal mengunggah lampiran.",
			);
		}
	}

	async function markRead() {
		if (!selectedConv) return;
		const latestSeq = messages.reduce((max, m) => Math.max(max, m.sequence), 0);
		const res = await fetch(
			`/api/v1/support/conversations/${selectedConv.id}/read-markers`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Idempotency-Key": makeClientKey("read"),
				},
				body: JSON.stringify({ last_seen_sequence: latestSeq }),
			},
		);
		if (res.ok) {
			setSelectedConv((prev) =>
				prev ? { ...prev, buyer_last_read_sequence: latestSeq } : prev,
			);
			setLiveNotice("Pesan ditandai sudah dibaca.");
		}
	}

	async function togglePreference(field: "archived" | "muted") {
		if (!selectedConv || !preference) return;
		const nextArchived =
			field === "archived" ? !preference.archived : preference.archived;
		const nextMuted = field === "muted" ? !preference.muted : preference.muted;
		const res = await fetch(
			`/api/v1/support/conversations/${selectedConv.id}/preferences`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Idempotency-Key": makeClientKey("pref"),
				},
				body: JSON.stringify({
					expected_version: preference.version,
					archived: nextArchived,
					muted: nextMuted,
				}),
			},
		);
		if (res.ok) {
			const updated = (await res.json()) as SupportPreference;
			setPreference(updated);
			return;
		}
		if ((await problemCode(res)) === "VERSION_CONFLICT") {
			const convId = selectedConv.id;
			const prefRes = await fetch(
				`/api/v1/support/conversations/${convId}/preferences`,
				{ headers: { Accept: "application/json" } },
			);
			if (prefRes.ok && activeConvRef.current === convId) {
				setPreference((await prefRes.json()) as SupportPreference);
			}
			setError(CONFLICT_MESSAGE);
			return;
		}
		setError("Pengaturan percakapan belum tersimpan. Coba lagi.");
	}

	async function runThreadSearch(e: React.FormEvent) {
		e.preventDefault();
		if (!selectedConv || !threadSearchQuery.trim()) return;
		const res = await fetch(
			`/api/v1/support/conversations/${selectedConv.id}/message-searches`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Idempotency-Key": makeClientKey("msearch"),
				},
				body: JSON.stringify({ query: threadSearchQuery.trim() }),
			},
		);
		if (res.ok) {
			const body = (await res.json()) as { data: SearchHit[] };
			setThreadSearchHits(body.data);
		}
	}

	async function runConversationSearch(e: React.FormEvent) {
		e.preventDefault();
		if (!convSearchQuery.trim()) {
			await loadConversations(viewFilter, statusFilter);
			return;
		}
		if (!sessionReady) await ensureGuestSession();
		const res = await fetch("/api/v1/support/conversation-searches", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Idempotency-Key": makeClientKey("csearch"),
			},
			body: JSON.stringify({
				query: convSearchQuery.trim(),
				view: viewFilter,
				...(statusFilter ? { status: statusFilter } : {}),
			}),
		});
		if (res.ok) {
			const body = (await res.json()) as { data: SupportConversation[] };
			setConversations(body.data);
		}
	}

	async function markNotification(
		notif: PrivateNotification,
		state: "seen" | "dismissed",
	) {
		const res = await fetch(`/api/v1/support/notifications/${notif.id}/state`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Idempotency-Key": makeClientKey("nstate"),
			},
			body: JSON.stringify({ expected_version: notif.version, state }),
		});
		if (res.ok) {
			const updated = (await res.json()) as PrivateNotification;
			setNotifications((prev) =>
				prev.map((n) => (n.id === updated.id ? updated : n)),
			);
			return;
		}
		if ((await problemCode(res)) === "VERSION_CONFLICT") {
			const notifRes = await fetch("/api/v1/support/notifications", {
				headers: { Accept: "application/json" },
			});
			if (notifRes.ok) {
				const body = (await notifRes.json()) as { data: PrivateNotification[] };
				setNotifications(body.data);
			}
			setError(CONFLICT_MESSAGE);
		}
	}

	return (
		<section
			id="support-chat"
			aria-labelledby={`${baseId}-heading`}
			style={{
				marginTop: "16px",
				padding: "24px",
				borderRadius: "20px",
				background: "#fff",
				border: "1px solid rgba(5, 41, 77, 0.1)",
				maxWidth: "100%",
				width: "100%",
				boxSizing: "border-box",
			}}
		>
			<div className="sr-only" aria-live="polite" aria-atomic="true">
				{liveNotice}
			</div>

			<div
				style={{
					display: "grid",
					gap: "4px",
					marginBottom: "12px",
				}}
			>
				<h2 id={`${baseId}-heading`} style={{ margin: 0 }}>
					Chat bantuan pelanggan
				</h2>
				<p
					style={{
						margin: 0,
						fontSize: "0.8125rem",
						lineHeight: 1.5,
						color: "#5b5b63",
						fontWeight: 400,
						overflowWrap: "anywhere",
					}}
				>
					Pesan diterima kapan saja. CS membalas pukul 08.00–21.00 WIB.
				</p>
			</div>

			<p
				style={{
					marginBlock: "8px 16px",
					fontSize: "0.9375rem",
					color: "#5b5b63",
				}}
			>
				Hubungi layanan pelanggan 99ribu langsung di situs tanpa perlu membuat
				akun atau nomor WhatsApp. Nomor pesanan saja tidak membuka rincian
				pribadi tanpa verifikasi akses pesanan.
			</p>

			{error && (
				<div
					role="alert"
					style={{
						padding: "12px 14px",
						marginBottom: "16px",
						borderRadius: "12px",
						borderLeft: "4px solid #8b241d",
						background: "#fff4f2",
						color: "#8b241d",
						fontSize: "0.9rem",
						overflowWrap: "anywhere",
					}}
				>
					{error}
				</div>
			)}

			<div
				style={{
					display: "flex",
					flexWrap: "wrap",
					gap: "10px",
					marginBottom: "16px",
				}}
			>
				<button
					type="button"
					onClick={() => startNewConversation()}
					disabled={loading}
					style={btnStyle}
				>
					Mulai chat bantuan
				</button>
				<button
					type="button"
					onClick={() => loadConversations(viewFilter, statusFilter)}
					disabled={loading}
					style={secondaryBtnStyle}
				>
					Muat percakapan saya
				</button>
				{selectedConv && (
					<button
						type="button"
						onClick={() => {
							activeConvRef.current = null;
							setSelectedConv(null);
						}}
						style={secondaryBtnStyle}
					>
						Kembali ke daftar
					</button>
				)}
			</div>

			<details className="chat-attach">
				<summary
					style={{
						minHeight: "44px",
						display: "block",
						paddingBlock: "10px",
						cursor: "pointer",
						fontWeight: 600,
						color: "#5b35d5",
					}}
				>
					Lampirkan konteks produk atau pesanan (opsional)
					<Icon name="chevron" />
				</summary>
				<div
					style={{
						display: "grid",
						gap: "10px",
						padding: "12px",
						marginTop: "8px",
						border: "1px solid #d8d8df",
						borderRadius: "12px",
						background: "#fff",
					}}
				>
					<label
						htmlFor={`${baseId}-ctx-type`}
						style={{ fontWeight: 600, fontSize: "0.875rem" }}
					>
						Jenis konteks
					</label>
					<select
						id={`${baseId}-ctx-type`}
						value={contextTypeInput}
						onChange={(e) =>
							setContextTypeInput(
								e.target.value as "none" | "product" | "order",
							)
						}
						style={inputStyle}
					>
						<option value="none">Tanpa konteks</option>
						<option value="product">Produk katalog</option>
						<option value="order">Pesanan terverifikasi</option>
					</select>
					{contextTypeInput !== "none" && (
						<>
							<label
								htmlFor={`${baseId}-ctx-id`}
								style={{ fontWeight: 600, fontSize: "0.875rem" }}
							>
								{contextTypeInput === "product"
									? "ID Produk (UUID)"
									: "ID Pesanan (UUID)"}
							</label>
							<input
								id={`${baseId}-ctx-id`}
								type="text"
								value={contextIdInput}
								onChange={(e) => setContextIdInput(e.target.value)}
								placeholder="00000000-0000-4000-8000-000000000000"
								style={inputStyle}
							/>
							{contextTypeInput === "order" && (
								<>
									<label
										htmlFor={`${baseId}-ctx-token`}
										style={{ fontWeight: 600, fontSize: "0.875rem" }}
									>
										Token akses pesanan tamu (opsional bila via header)
									</label>
									<input
										id={`${baseId}-ctx-token`}
										type="password"
										value={orderTokenInput}
										onChange={(e) => setOrderTokenInput(e.target.value)}
										style={inputStyle}
									/>
								</>
							)}
							<div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
								<button
									type="button"
									style={secondaryBtnStyle}
									onClick={() => {
										if (!contextIdInput.trim()) return;
										if (contextTypeInput === "product") {
											setPendingContext({
												kind: "product",
												product_id: contextIdInput.trim(),
											});
										} else {
											setPendingContext({
												kind: "order",
												order_id: contextIdInput.trim(),
												...(orderTokenInput.trim()
													? { order_token: orderTokenInput.trim() }
													: {}),
											});
										}
									}}
								>
									Siapkan draf konteks
								</button>
								{pendingContext && (
									<button
										type="button"
										style={secondaryBtnStyle}
										onClick={() => setPendingContext(null)}
									>
										Hapus konteks
									</button>
								)}
							</div>
						</>
					)}
				</div>
			</details>

			{notifications.filter((n) => !n.dismissed_at).length > 0 && (
				<section
					aria-label="Notifikasi bantuan"
					style={{
						marginBottom: "16px",
						padding: "12px",
						border: "1px solid #d8cff4",
						borderRadius: "12px",
						background: "#f7f5fd",
					}}
				>
					<strong style={{ display: "block", marginBottom: "8px" }}>
						Notifikasi bantuan ({notifications.filter((n) => !n.seen_at).length}{" "}
						belum dilihat)
					</strong>
					<ul
						style={{
							listStyle: "none",
							padding: 0,
							margin: 0,
							display: "grid",
							gap: "8px",
						}}
					>
						{notifications
							.filter((n) => !n.dismissed_at)
							.map((n) => (
								<li
									key={n.id}
									style={{
										display: "flex",
										flexWrap: "wrap",
										justifyContent: "space-between",
										alignItems: "center",
										gap: "8px",
									}}
								>
									<span>
										Pembaruan percakapan #{n.target_id.slice(0, 8)} (
										{n.seen_at ? "Sudah dilihat" : "Baru"})
									</span>
									<div
										style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}
									>
										{!n.seen_at && (
											<button
												type="button"
												onClick={() => markNotification(n, "seen")}
												style={secondaryBtnStyle}
											>
												Tandai dilihat
											</button>
										)}
										<button
											type="button"
											onClick={() => markNotification(n, "dismissed")}
											style={secondaryBtnStyle}
										>
											Tutup notifikasi
										</button>
									</div>
								</li>
							))}
					</ul>
				</section>
			)}

			{sessionReady && !selectedConv && (
				<div style={{ display: "grid", gap: "12px" }}>
					<form
						onSubmit={runConversationSearch}
						style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}
					>
						<label htmlFor={`${baseId}-conv-search`} className="sr-only">
							Filter daftar percakapan
						</label>
						<input
							id={`${baseId}-conv-search`}
							type="search"
							value={convSearchQuery}
							onChange={(e) => setConvSearchQuery(e.target.value)}
							placeholder="Filter status atau referensi..."
							style={{ ...inputStyle, flex: "1 1 12rem" }}
						/>
						<select
							aria-label="Tampilan arsip"
							value={viewFilter}
							onChange={(e) => {
								const v = e.target.value as "active" | "archived" | "all";
								setViewFilter(v);
								void loadConversations(v, statusFilter);
							}}
							style={{ ...inputStyle, width: "auto", flex: "0 1 auto" }}
						>
							<option value="active">Aktif</option>
							<option value="archived">Arsip</option>
							<option value="all">Semua</option>
						</select>
						<select
							aria-label="Filter status percakapan"
							value={statusFilter}
							onChange={(e) => {
								const s = e.target.value;
								setStatusFilter(s);
								void loadConversations(viewFilter, s);
							}}
							style={{ ...inputStyle, width: "auto", flex: "0 1 auto" }}
						>
							<option value="">Semua status</option>
							<option value="open">Terbuka (open)</option>
							<option value="waiting_customer">Menunggu pelanggan</option>
							<option value="resolved">Selesai (resolved)</option>
						</select>
						<button type="submit" style={secondaryBtnStyle}>
							Filter
						</button>
					</form>

					{conversations.length === 0 ? (
						<p style={{ margin: "8px 0", color: "#5b5b63" }}>
							{viewFilter === "archived"
								? "Belum ada percakapan di arsip."
								: "Belum ada percakapan aktif. Klik Mulai chat bantuan untuk bertanya."}
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
							{conversations.map((c) => {
								const unread = Math.max(
									0,
									c.last_message_sequence - c.buyer_last_read_sequence,
								);
								return (
									<li
										key={c.id}
										style={{
											border: "1px solid #d8d8df",
											borderRadius: "12px",
											padding: "12px",
											background: "#fff",
											display: "flex",
											flexWrap: "wrap",
											justifyContent: "space-between",
											alignItems: "center",
											gap: "8px",
										}}
									>
										<div style={{ minWidth: 0 }}>
											<strong>Percakapan #{c.id.slice(0, 8)}</strong>
											<div style={{ fontSize: "0.85rem", color: "#5b5b63" }}>
												Status: {c.status} • Pesan: {c.last_message_sequence}
												{unread > 0 ? ` • ${unread} belum dibaca` : ""}
											</div>
										</div>
										<button
											type="button"
											onClick={() => openThread(c)}
											style={secondaryBtnStyle}
										>
											Buka percakapan
										</button>
									</li>
								);
							})}
						</ul>
					)}
				</div>
			)}

			{selectedConv && (
				<div
					style={{
						border: "1px solid #d8d8df",
						borderRadius: "16px",
						background: "#fff",
						padding: "16px",
						display: "grid",
						gap: "14px",
					}}
				>
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
							<h3 style={{ margin: 0 }}>
								Percakapan #{selectedConv.id.slice(0, 8)} ({selectedConv.status}
								)
							</h3>
							<small style={{ color: "#5b5b63" }}>
								Urutan pesan terakhir: {selectedConv.last_message_sequence} •
								Dibaca CS hingga: {selectedConv.staff_last_read_sequence}
							</small>
						</div>
						<div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
							<button
								type="button"
								onClick={markRead}
								style={secondaryBtnStyle}
							>
								Tandai dibaca
							</button>
							{preference && (
								<>
									<button
										type="button"
										onClick={() => togglePreference("archived")}
										style={secondaryBtnStyle}
									>
										{preference.archived ? "Batal arsipkan" : "Arsipkan"}
									</button>
									<button
										type="button"
										onClick={() => togglePreference("muted")}
										style={secondaryBtnStyle}
									>
										{preference.muted
											? "Bunyikan notifikasi"
											: "Bisukan notifikasi"}
									</button>
								</>
							)}
						</div>
					</div>

					<form
						onSubmit={runThreadSearch}
						style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}
					>
						<label htmlFor={`${baseId}-msg-search`} className="sr-only">
							Cari di percakapan ini
						</label>
						<input
							id={`${baseId}-msg-search`}
							type="search"
							value={threadSearchQuery}
							onChange={(e) => setThreadSearchQuery(e.target.value)}
							placeholder="Cari teks pesan di percakapan ini..."
							style={{ ...inputStyle, flex: "1 1 12rem" }}
						/>
						<button type="submit" style={secondaryBtnStyle}>
							Cari pesan
						</button>
						{threadSearchHits !== null && (
							<button
								type="button"
								onClick={() => {
									setThreadSearchHits(null);
									setThreadSearchQuery("");
								}}
								style={secondaryBtnStyle}
							>
								Reset pencarian
							</button>
						)}
					</form>

					{threadSearchHits !== null && (
						<div
							style={{
								padding: "10px",
								borderRadius: "12px",
								background: "#f7f5fd",
								fontSize: "0.875rem",
							}}
						>
							<strong>Hasil Pencarian ({threadSearchHits.length}):</strong>
							{threadSearchHits.length === 0 ? (
								<p style={{ margin: "4px 0 0" }}>
									Tidak ada pesan publik yang cocok.
								</p>
							) : (
								<ul style={{ margin: "6px 0 0", paddingLeft: "18px" }}>
									{threadSearchHits.map((hit) => (
										<li key={hit.message_id}>
											#{hit.sequence}: {hit.excerpt}
										</li>
									))}
								</ul>
							)}
						</div>
					)}

					{hasOlder && (
						<button
							type="button"
							onClick={loadOlderMessages}
							aria-disabled={loadingOlder}
							aria-controls={`${baseId}-log`}
							style={{ ...secondaryBtnStyle, justifySelf: "start" }}
						>
							{loadingOlder ? "Memuat pesan..." : "Muat pesan sebelumnya"}
						</button>
					)}

					<div
						ref={logRef}
						id={`${baseId}-log`}
						role="log"
						aria-label="Riwayat pesan percakapan"
						aria-busy={loadingOlder}
						// biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable message history must be keyboard-scrollable
						tabIndex={0}
						style={{
							display: "grid",
							gap: "10px",
							maxHeight: "360px",
							overflowY: "auto",
							padding: "8px",
							border: "1px solid #e7e5ed",
							borderRadius: "12px",
							background: "#faf9fc",
						}}
					>
						{messages.length === 0 ? (
							<p style={{ margin: 0, color: "#5b5b63" }}>
								Belum ada pesan terkirim. Tulis pertanyaan Anda di bawah.
							</p>
						) : (
							messages.map((m) => {
								const isReadByCounterparty =
									m.sender === "buyer" &&
									selectedConv.staff_last_read_sequence >= m.sequence;
								return (
									<article
										key={m.id}
										style={{
											padding: "10px 12px",
											borderRadius: "12px",
											border: "1px solid #d8d8df",
											background: m.sender === "buyer" ? "#f3effb" : "#fff",
											overflowWrap: "anywhere",
										}}
									>
										<div
											style={{
												display: "flex",
												flexWrap: "wrap",
												justifyContent: "space-between",
												gap: "8px",
												fontSize: "0.8rem",
												color: "#5b5b63",
												marginBottom: "4px",
											}}
										>
											<strong>
												#{m.sequence} •{" "}
												{m.sender === "buyer"
													? "Anda"
													: "Layanan pelanggan (CS)"}
											</strong>
											<span>
												{m.sender === "buyer"
													? isReadByCounterparty
														? "Terkirim, dibaca CS"
														: "Terkirim"
													: "Diterima"}
											</span>
										</div>

										{m.reply && (
											<blockquote
												style={{
													margin: "4px 0 8px",
													padding: "6px 10px",
													borderLeft: "3px solid #5b35d5",
													background: "#fff",
													fontSize: "0.85rem",
												}}
											>
												{m.reply.state === "visible"
													? `Membalas: ${m.reply.excerpt}`
													: "[Pesan asli telah dihapus atau tidak tersedia]"}
											</blockquote>
										)}

										{m.context && (
											<div
												style={{
													margin: "4px 0 8px",
													padding: "8px 10px",
													borderRadius: "8px",
													border: "1px solid #c9c7d3",
													background: "#fff",
													fontSize: "0.85rem",
												}}
											>
												<strong>
													Kartu Konteks (
													{m.context.kind === "product" ? "Produk" : "Pesanan"}
													):
												</strong>{" "}
												{m.context.title} ({m.context.availability})
											</div>
										)}

										<p style={{ margin: "4px 0", whiteSpace: "pre-wrap" }}>
											{m.text}
										</p>

										{m.attachments.length > 0 && (
											<div
												style={{
													display: "flex",
													flexWrap: "wrap",
													gap: "8px",
													marginTop: "8px",
												}}
											>
												{m.attachments.map((att) => (
													<button
														key={att.id}
														type="button"
														onClick={(ev) => {
															viewerTriggerRef.current = ev.currentTarget;
															setViewerAttachment(att);
															setViewerZoom(1);
														}}
														style={secondaryBtnStyle}
													>
														Lihat Gambar ({Math.ceil(att.size_bytes / 1024)} KB)
													</button>
												))}
											</div>
										)}

										<div style={{ marginTop: "6px" }}>
											<button
												type="button"
												onClick={() => setReplyTo(m)}
												style={{
													...secondaryBtnStyle,
													minHeight: "44px",
													padding: "6px 10px",
													fontSize: "0.8rem",
												}}
											>
												Balas Pesan #{m.sequence}
											</button>
										</div>
									</article>
								);
							})
						)}
					</div>

					{replyTo && (
						<div
							style={{
								display: "flex",
								flexWrap: "wrap",
								justifyContent: "space-between",
								alignItems: "center",
								gap: "8px",
								padding: "8px 12px",
								borderRadius: "12px",
								background: "#f3effb",
							}}
						>
							<span>
								Membalas pesan #{replyTo.sequence}: {replyTo.text.slice(0, 80)}
							</span>
							<button
								type="button"
								onClick={() => setReplyTo(null)}
								style={secondaryBtnStyle}
							>
								Batal balas
							</button>
						</div>
					)}

					{pendingContext && (
						<div
							style={{
								display: "flex",
								flexWrap: "wrap",
								justifyContent: "space-between",
								alignItems: "center",
								gap: "8px",
								padding: "8px 12px",
								borderRadius: "12px",
								background: "#fff8de",
							}}
						>
							<span>
								Konteks siap dikirim:{" "}
								{pendingContext.kind === "product"
									? `Produk ${pendingContext.product_id}`
									: `Pesanan ${pendingContext.order_id}`}
							</span>
							<button
								type="button"
								onClick={() => setPendingContext(null)}
								style={secondaryBtnStyle}
							>
								Hapus konteks
							</button>
						</div>
					)}

					<form onSubmit={sendMessage} style={{ display: "grid", gap: "10px" }}>
						<label htmlFor={`${baseId}-composer`} style={{ fontWeight: 600 }}>
							Tulis pesan (Enter untuk baris baru, tombol Kirim pesan untuk
							mengirim)
						</label>
						<textarea
							id={`${baseId}-composer`}
							rows={3}
							maxLength={4000}
							value={draftText}
							onChange={(e) => updateDraftText(e.target.value)}
							onCompositionStart={() => {
								isComposingRef.current = true;
							}}
							onCompositionEnd={() => {
								isComposingRef.current = false;
							}}
							onKeyDown={(e) => {
								if (
									(e.ctrlKey || e.metaKey) &&
									e.key === "Enter" &&
									!isComposingRef.current &&
									!e.repeat
								) {
									e.preventDefault();
									void sendMessage();
								}
							}}
							placeholder="Ketik pertanyaan Anda..."
							style={{ ...inputStyle, minHeight: "88px", resize: "vertical" }}
						/>
						<div
							style={{
								display: "flex",
								flexWrap: "wrap",
								justifyContent: "space-between",
								alignItems: "center",
								gap: "8px",
								fontSize: "0.85rem",
								color: "#5b5b63",
							}}
						>
							<span>
								Sisa karakter: {4000 - Array.from(draftText).length} / 4000
							</span>
							<span>
								Lampiran siap: {uploadedAttachments.length} / 3 (JPEG/PNG/WebP ≤
								5 MiB)
							</span>
						</div>

						{uploadedAttachments.length > 0 && (
							<ul
								style={{
									listStyle: "none",
									padding: 0,
									margin: 0,
									display: "grid",
									gap: "6px",
								}}
							>
								{uploadedAttachments.map((att) => (
									<li
										key={att.id}
										style={{
											display: "flex",
											flexWrap: "wrap",
											justifyContent: "space-between",
											alignItems: "center",
											gap: "8px",
											fontSize: "0.85rem",
										}}
									>
										<span>
											Lampiran {att.media_type} ({att.status})
										</span>
										<button
											type="button"
											onClick={() =>
												setUploadedAttachments((prev) =>
													prev.filter((x) => x.id !== att.id),
												)
											}
											style={secondaryBtnStyle}
										>
											Hapus lampiran
										</button>
									</li>
								))}
							</ul>
						)}

						<div
							style={{
								display: "flex",
								flexWrap: "wrap",
								gap: "10px",
								alignItems: "center",
							}}
						>
							<label
								htmlFor={`${baseId}-file`}
								style={{ ...secondaryBtnStyle, cursor: "pointer" }}
							>
								Unggah gambar
								<input
									id={`${baseId}-file`}
									type="file"
									accept="image/jpeg,image/png,image/webp"
									onChange={handleFileSelect}
									style={{ display: "none" }}
								/>
							</label>
							<button type="submit" disabled={sending} style={btnStyle}>
								{sending ? "Mengirim..." : "Kirim pesan"}
							</button>
						</div>
					</form>
				</div>
			)}

			{viewerAttachment && selectedConv && (
				<div
					role="dialog"
					aria-modal="true"
					aria-label="Peninjau gambar lampiran"
					onKeyDown={(e) => {
						if (e.key === "Escape") {
							setViewerAttachment(null);
							viewerTriggerRef.current?.focus();
						}
					}}
					style={{
						marginTop: "12px",
						padding: "16px",
						border: "2px solid #5b35d5",
						borderRadius: "16px",
						background: "#fff",
					}}
				>
					<div
						style={{
							display: "flex",
							flexWrap: "wrap",
							gap: "8px",
							marginBottom: "12px",
						}}
					>
						<button
							type="button"
							onClick={() =>
								setViewerZoom((z) => Math.min(3, Number((z + 0.25).toFixed(2))))
							}
							style={secondaryBtnStyle}
						>
							Perbesar (+)
						</button>
						<button
							type="button"
							onClick={() =>
								setViewerZoom((z) =>
									Math.max(0.5, Number((z - 0.25).toFixed(2))),
								)
							}
							style={secondaryBtnStyle}
						>
							Perkecil (-)
						</button>
						<button
							type="button"
							onClick={() => setViewerZoom(1)}
							style={secondaryBtnStyle}
						>
							Reset ukuran (100%)
						</button>
						<button
							type="button"
							onClick={() => {
								setViewerAttachment(null);
								viewerTriggerRef.current?.focus();
							}}
							style={btnStyle}
						>
							Tutup peninjau
						</button>
					</div>
					<div style={{ overflow: "auto", maxWidth: "100%" }}>
						{/* biome-ignore lint/performance/noImgElement: private cookie-authenticated attachment endpoint */}
						<img
							src={`/api/v1/support/conversations/${selectedConv.id}/attachments/${viewerAttachment.id}`}
							alt={`Lampiran percakapan ${viewerAttachment.id}`}
							style={{
								maxWidth: `${Math.round(viewerZoom * 100)}%`,
								height: "auto",
								display: "block",
							}}
						/>
					</div>
				</div>
			)}
		</section>
	);
}
