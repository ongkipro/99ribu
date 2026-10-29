"use client";

import { Clock, Search } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	isValidEmail,
	looksLikeWhatsApp,
	normalizeEmailInput,
	phoneInput,
} from "@/modules/storefront/contact";
import { describeFailure, failureText, readFailure } from "./admin-errors";
import { DataTable } from "./data-table";
import { formatWib } from "./format";
import { FormField, SegmentedControl } from "./form";
import {
	ORDER_STATUS,
	ORDER_TONE,
	PAYMENT_STATUS,
	PAYMENT_TONE,
} from "./order-model";
import { DeniedState, EmptyState, ErrorState, LoadingState } from "./states";
import { OrderNumberLink, StatusBadge } from "./status";

// S138 / spec 17 B29, DEC-018 Q5: CS finds a buyer account by one exact phone or email. The API masks the contact,
// returns no address or payment data, rate-limits per staff user and audits every lookup; this screen only asks.
// What was typed stays in component state: it never enters the address bar, history or a storage area, and the
// inputs have no `name`, so a native submit before hydration cannot put it in a URL.

type Kind = "phone" | "email";
type Order = {
	id: string;
	admin_no: number;
	number: string;
	status: string;
	payment_status: string;
	created_at: string;
};
type Ticket = {
	id: string;
	status: string;
	priority: string;
	created_at: string;
	last_message_at: string | null;
};
type Account = {
	id: string;
	display_name: string;
	phone_masked: string | null;
	phone_verified: boolean;
	email_masked: string | null;
	email_verified: boolean;
	created_at: string;
	orders: Order[];
	orders_truncated: boolean;
	tickets: Ticket[];
	tickets_truncated: boolean;
};
type Result = {
	lookup: { kind: Kind };
	order_access: "all" | "scoped" | "none";
	accounts: Account[];
	accounts_truncated: boolean;
};
type View =
	| { kind: "idle" }
	| { kind: "loading" }
	| { kind: "done"; result: Result }
	| { kind: "error"; message: string }
	| { kind: "denied"; reason: "session" | "role" }
	| { kind: "limited"; message: string };

const KINDS = [
	["phone", "Nomor HP"],
	["email", "Email"],
] as const;
const TICKET_STATUS: Record<string, string> = {
	open: "Terbuka",
	waiting_customer: "Menunggu pembeli",
	resolved: "Selesai",
};
const TICKET_TONE: Record<string, "open" | "problem" | "done"> = {
	open: "open",
	waiting_customer: "problem",
	resolved: "done",
};
const PRIORITY: Record<string, string> = {
	low: "Rendah",
	normal: "Normal",
	high: "Tinggi",
};

function validate(kind: Kind, raw: string) {
	if (kind === "phone")
		return looksLikeWhatsApp(raw)
			? null
			: "Masukkan nomor HP lengkap diawali 08 (10 sampai 13 digit). Pencarian sebagian tidak tersedia.";
	return isValidEmail(raw)
		? null
		: "Masukkan alamat email lengkap, misalnya nama@contoh.com. Pencarian sebagian tidak tersedia.";
}

async function lookup(kind: Kind, value: string): Promise<View> {
	try {
		const res = await fetch("/api/v1/admin/customers/lookup", {
			method: "POST",
			credentials: "include",
			cache: "no-store",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ kind, value }),
		});
		if (res.ok) return { kind: "done", result: (await res.json()) as Result };
		if (res.status === 429) {
			const wait = Number(res.headers.get("retry-after"));
			return {
				kind: "limited",
				message: `Terlalu banyak pencarian dalam waktu singkat. ${
					Number.isFinite(wait) && wait > 0
						? `Coba lagi dalam ${wait} detik.`
						: "Coba lagi sebentar lagi."
				}`,
			};
		}
		if (res.status === 401) return { kind: "denied", reason: "session" };
		if (res.status === 403) return { kind: "denied", reason: "role" };
		return { kind: "error", message: failureText(await readFailure(res)) };
	} catch {
		return { kind: "error", message: failureText(describeFailure(0)) };
	}
}

function Contact({
	label,
	value,
	verified,
	empty,
}: {
	label: string;
	value: string | null;
	verified: boolean;
	empty: string;
}) {
	return (
		<div className="flex min-w-0 flex-col gap-0.5">
			<dt className="text-xs text-muted-foreground">{label}</dt>
			<dd className="flex flex-wrap items-center gap-2 text-sm">
				{value ? (
					<>
						<span className="font-mono break-all tabular-nums">{value}</span>
						<StatusBadge tone={verified ? "success" : "open"}>
							{verified ? "Terverifikasi" : "Belum diverifikasi"}
						</StatusBadge>
					</>
				) : (
					<span className="text-muted-foreground">{empty}</span>
				)}
			</dd>
		</div>
	);
}

function OrdersTable({
	account,
	access,
}: {
	account: Account;
	access: Result["order_access"];
}) {
	return (
		<section aria-label="Pesanan" className="flex flex-col gap-2">
			{/* No count without access: "Pesanan (0)" would read as a buyer with no orders. */}
			<h3 className="text-sm font-semibold">{access === "none" ? "Pesanan" : `Pesanan (${account.orders.length})`}</h3>
			<DataTable
				testId="customer-orders-table"
				caption={`Pesanan akun ${account.display_name}, terbaru di atas`}
				rows={account.orders}
				rowKey={(row) => row.id}
				rowTestId={() => "customer-order-row"}
				status={{ kind: "ready" }}
				loadingLabel="Memuat pesanan…"
				empty={
					access === "none"
						? "Peran Anda belum memegang akses riwayat pesanan, jadi daftar ini kosong."
						: access === "scoped"
							? "Tidak ada pesanan yang seluruh paketnya ada di gudang cakupan Anda."
							: "Akun ini belum punya pesanan."
				}
				emptyTestId="customer-orders-empty"
				stack
				footer={
					<>
						{access === "scoped" && account.orders.length > 0 && (
							<p className="text-xs text-muted-foreground">
								Hanya pesanan yang seluruh paketnya ada di gudang cakupan Anda yang tampil.
							</p>
						)}
						{account.orders_truncated && (
							<p className="text-xs text-muted-foreground">
								20 pesanan terbaru ditampilkan.
							</p>
						)}
					</>
				}
				columns={[
					{
						id: "number",
						header: "Nomor pesanan",
						stack: "title",
						cell: (row) => (
							<OrderNumberLink
								number={row.number}
								adminNo={row.admin_no}
								enabled={access !== "none"}
							/>
						),
					},
					{
						id: "created",
						header: "Dibuat",
						stack: "meta",
						kind: "datetime",
						cell: (row) => formatWib(row.created_at),
					},
					{
						id: "status",
						header: "Status",
						stack: "status",
						cell: (row) => (
							<StatusBadge tone={ORDER_TONE[row.status] ?? "open"}>
								{ORDER_STATUS[row.status] ?? row.status}
							</StatusBadge>
						),
					},
					{
						id: "payment",
						header: "Pembayaran",
						stack: "status",
						cell: (row) => (
							<StatusBadge tone={PAYMENT_TONE[row.payment_status] ?? "open"}>
								{PAYMENT_STATUS[row.payment_status] ?? row.payment_status}
							</StatusBadge>
						),
					},
				]}
			/>
		</section>
	);
}

function TicketsTable({ account }: { account: Account }) {
	return (
		<section aria-label="Tiket layanan" className="flex flex-col gap-2">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h3 className="text-sm font-semibold">
					Tiket layanan ({account.tickets.length})
				</h3>
				{account.tickets.length > 0 && (
					<Button asChild variant="outline" size="sm">
						<Link href="/admin/support">Buka Kotak Masuk</Link>
					</Button>
				)}
			</div>
			<DataTable
				testId="customer-tickets-table"
				caption={`Tiket layanan akun ${account.display_name}, terbaru di atas`}
				rows={account.tickets}
				rowKey={(row) => row.id}
				rowTestId={() => "customer-ticket-row"}
				status={{ kind: "ready" }}
				loadingLabel="Memuat tiket…"
				empty="Akun ini belum pernah menghubungi layanan pelanggan."
				emptyTestId="customer-tickets-empty"
				stack
				footer={
					account.tickets_truncated && (
						<p className="text-xs text-muted-foreground">
							20 tiket terbaru ditampilkan.
						</p>
					)
				}
				// The opening time leads: the ticket id is no link (the inbox has no per-ticket address yet), so it is reference only.
				columns={[
					{
						id: "created",
						header: "Dibuka (WIB)",
						stack: "title",
						kind: "datetime",
						cell: (row) => formatWib(row.created_at),
					},
					{
						id: "status",
						header: "Status",
						stack: "status",
						cell: (row) => (
							<StatusBadge tone={TICKET_TONE[row.status] ?? "open"}>
								{TICKET_STATUS[row.status] ?? row.status}
							</StatusBadge>
						),
					},
					{
						id: "priority",
						header: "Prioritas",
						cell: (row) => PRIORITY[row.priority] ?? row.priority,
					},
					{
						id: "last",
						header: "Pesan terakhir (WIB)",
						kind: "datetime",
						cell: (row) => formatWib(row.last_message_at),
					},
					{
						id: "ticket",
						header: "ID tiket",
						hideBelow: "6xl",
						cellClassName: "whitespace-normal",
						cell: (row) => (
							<span className="font-mono text-xs break-all text-muted-foreground">{row.id}</span>
						),
					},
				]}
			/>
		</section>
	);
}

function AccountCard({
	account,
	access,
}: {
	account: Account;
	access: Result["order_access"];
}) {
	return (
		<article
			data-testid="customer-account"
			className="flex flex-col gap-4 rounded-lg border bg-card p-4"
		>
			<header className="flex min-w-0 flex-col gap-3">
				<h2 className="text-base font-semibold break-words">
					{account.display_name}
				</h2>
				<dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
					<Contact
						label="Nomor HP"
						value={account.phone_masked}
						verified={account.phone_verified}
						empty="Belum diisi"
					/>
					<Contact
						label="Email"
						value={account.email_masked}
						verified={account.email_verified}
						empty="Belum diisi"
					/>
					<div className="flex min-w-0 flex-col gap-0.5">
						<dt className="text-xs text-muted-foreground">Akun dibuat</dt>
						<dd className="text-sm tabular-nums">{formatWib(account.created_at)}</dd>
					</div>
				</dl>
			</header>
			<OrdersTable account={account} access={access} />
			<TicketsTable account={account} />
		</article>
	);
}

export function CustomerLookupClient() {
	const [kind, setKind] = useState<Kind>("phone");
	const [value, setValue] = useState("");
	const [problem, setProblem] = useState<string | null>(null);
	const [view, setView] = useState<View>({ kind: "idle" });
	const latest = useRef(0);
	const pending = view.kind === "loading";

	const submit = async () => {
		const cleaned =
			kind === "phone" ? phoneInput(value) : normalizeEmailInput(value);
		const found = validate(kind, cleaned);
		setProblem(found);
		if (found) return;
		const ticket = ++latest.current;
		setView({ kind: "loading" });
		const next = await lookup(kind, cleaned);
		if (ticket === latest.current) setView(next);
	};

	return (
		<div className="flex flex-col gap-4">
			<search aria-label="Cari akun pembeli">
				<form
					noValidate
					data-testid="customer-form"
					className="flex max-w-2xl flex-col gap-3"
					onSubmit={(event) => {
						event.preventDefault();
						if (!pending) void submit();
					}}
				>
					<SegmentedControl
						legend="Cari berdasarkan"
						value={kind}
						options={KINDS}
						testId={(key) => `customer-kind-${key}`}
						onChange={(next) => {
							setKind(next);
							setValue("");
							setProblem(null);
							latest.current++;
							setView({ kind: "idle" });
						}}
					/>
					<FormField
						id="customer-value"
						label={kind === "phone" ? "Nomor HP pembeli" : "Email pembeli"}
						invalid={!!problem}
						hint={
							problem ??
							(kind === "phone"
								? "Nomor yang sama persis, misalnya 081234567890."
								: "Alamat email yang sama persis.")
						}
					>
						<Input
							id="customer-value"
							data-testid="customer-input"
							value={value}
							maxLength={kind === "phone" ? 24 : 254}
							inputMode={kind === "phone" ? "tel" : "email"}
							autoComplete="off"
							autoCapitalize="off"
							spellCheck={false}
							aria-invalid={problem ? true : undefined}
							aria-describedby="customer-value-hint"
							onChange={(event) =>
								setValue(
									kind === "phone"
										? phoneInput(event.target.value)
										: event.target.value.trim(),
								)
							}
						/>
					</FormField>
					<Button
						type="submit"
						data-testid="customer-submit"
						disabled={pending}
						className="max-md:w-full md:self-start"
					>
						<Search aria-hidden="true" />
						{pending ? "Mencari…" : "Cari akun"}
					</Button>
				</form>
			</search>
			<div data-testid="customer-result" className="flex flex-col gap-4">
				{view.kind === "idle" && (
					<EmptyState
						title="Belum ada pencarian"
						testId="customer-idle"
					>
						Cari dengan satu nomor HP atau satu email yang sama persis. Daftar akun
						tidak bisa dijelajahi, dan setiap pencarian tercatat di log audit.
					</EmptyState>
				)}
				{view.kind === "loading" && (
					<LoadingState label="Mencari akun…" lines={2} className="h-24 w-full" />
				)}
				{view.kind === "error" && (
					<ErrorState message={view.message} onRetry={() => void submit()} />
				)}
				{view.kind === "limited" && (
					// A rate limit is a wait, not a missing permission: the typed value stays for the retry.
					<Alert data-testid="customer-limited" className="border-warning/40 bg-warning-surface">
						<Clock aria-hidden="true" />
						<AlertDescription className="text-foreground">{view.message}</AlertDescription>
					</Alert>
				)}
				{view.kind === "denied" && (
					<DeniedState>
						{view.reason === "session"
							? "Sesi staf Anda berakhir. Masuk lagi dengan kode autentikator, lalu ulangi pencarian."
							: "Peran Anda tidak membuka pencarian akun pembeli. Fitur ini untuk Super Admin dan staf layanan pelanggan dengan verifikasi dua langkah (MFA) aktif; minta Super Admin menambahkan peran bila perlu."}
					</DeniedState>
				)}
				{view.kind === "done" &&
					(view.result.accounts.length === 0 ? (
						<EmptyState
							title="Tidak ada akun yang cocok"
							testId="customer-empty"
						>
							Tidak ada akun pembeli dengan{" "}
							{view.result.lookup.kind === "phone" ? "nomor HP" : "email"} itu.
							Periksa penulisannya. Pembeli yang memesan sebagai tamu tidak punya
							akun; cari pesanannya lewat halaman Pesanan.
						</EmptyState>
					) : (
						<>
							<p role="status" className="text-sm text-muted-foreground">
								{view.result.accounts.length} akun ditemukan
								{view.result.accounts_truncated
									? "; hanya 5 pertama yang ditampilkan"
									: ""}
								.
							</p>
							{view.result.accounts.map((account) => (
								<AccountCard
									key={account.id}
									account={account}
									access={view.result.order_access}
								/>
							))}
						</>
					))}
			</div>
		</div>
	);
}
