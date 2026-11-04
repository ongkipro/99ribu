"use client";

import { useRef, useState } from "react";
import type { BuyerAddressListResponse, BuyerAddressResponse, BuyerProfileResponse } from "@/modules/accounts/service";
import { displayPhone, looksLikeWhatsApp, WHATSAPP_HINT } from "@/modules/storefront/contact";
import type { Destination } from "../profile-completion";
import { filterContact } from "../ui/contact-fields";

// The list read and the default switch return at most this many rows, so the book stops here.
export const MAX_ADDRESSES = 20;

type Editing = { kind: "new" } | { kind: "edit"; id: string } | null;

const send = (path: string, body: unknown) =>
	fetch(path, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify(body) });
const problemCode = async (res: Response) => ((await res.json().catch(() => null)) as { code?: string } | null)?.code;

// One place for the whole address book: add, edit, delete and set the main address. Each action reloads
// the list, so what is shown is what the server holds.
export function AddressBook({
	profile,
	addresses,
	destinations,
	onAddresses,
	onStatus,
}: {
	profile: BuyerProfileResponse;
	addresses: BuyerAddressListResponse | null;
	destinations: Destination[];
	onAddresses: (list: BuyerAddressListResponse) => void;
	onStatus: (message: string) => void;
}) {
	const [editing, setEditing] = useState<Editing>(null);
	const [confirmId, setConfirmId] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const busyRef = useRef(false);
	const list = addresses?.data ?? [];

	function run(task: () => Promise<void>) {
		if (busyRef.current) return;
		busyRef.current = true;
		setBusy(true);
		void task()
			.catch(() => onStatus("Tidak bisa terhubung. Periksa koneksi lalu coba lagi."))
			.finally(() => {
				busyRef.current = false;
				setBusy(false);
			});
	}
	const reload = async () => {
		const res = await fetch(`/api/v1/me/addresses?limit=${MAX_ADDRESSES}`);
		if (res.ok) onAddresses((await res.json()) as BuyerAddressListResponse);
	};
	const failure = async (res: Response, fallback: string) => {
		const code = await problemCode(res);
		onStatus(code === "INVALID_INDONESIAN_PHONE" ? WHATSAPP_HINT : code?.endsWith("VERSION_CONFLICT") ? "Alamat berubah di tab lain. Muat ulang halaman lalu coba lagi." : fallback);
	};

	function makeDefault(item: BuyerAddressResponse) {
		if (!addresses) return;
		run(async () => {
			const res = await send("/api/v1/me/address-default", { expected_book_version: addresses.book_version, address_id: item.id });
			if (!res.ok) return failure(res, "Gagal mengubah alamat utama. Muat ulang halaman lalu coba lagi.");
			onAddresses((await res.json()) as BuyerAddressListResponse);
			onStatus("Alamat utama diperbarui.");
		});
	}

	function remove(item: BuyerAddressResponse) {
		if (!addresses) return;
		// Deleting the main address hands that role to the next saved one; the deleted row keeps no personal data.
		const replacement = item.is_default ? (list.find((other) => other.id !== item.id) ?? null) : null;
		run(async () => {
			const res = await send(`/api/v1/me/addresses/${item.id}/deletions`, { expected_version: item.version, expected_book_version: addresses.book_version, replacement_default_id: replacement?.id ?? null });
			if (!res.ok) return failure(res, "Gagal menghapus alamat. Muat ulang halaman lalu coba lagi.");
			setConfirmId(null);
			await reload();
			onStatus(replacement ? "Alamat dihapus. Alamat lain menjadi alamat utama." : "Alamat dihapus.");
		});
	}

	const target = editing?.kind === "edit" ? (list.find((item) => item.id === editing.id) ?? null) : null;
	return (
		<div className="account-address-book" data-testid="address-book">
			{list.length > 0 ? (
				<ul className="account-address-list" data-testid="address-book-list">
					{list.map((item) => (
						<li className="account-address" key={item.id} data-testid={`address-card-${item.id}`} data-default={item.is_default}>
							<div className="account-address-head">
								<strong>{item.address.label || "Alamat"} · {item.address.recipient_name}</strong>
								{item.is_default && <span className="receipt-badge" data-testid="default-address-badge">Utama</span>}
							</div>
							<p className="account-meta">
								{displayPhone(item.address.phone)} · {item.address.street}, {item.address.district}, {item.address.city}, {item.address.province} {item.address.postcode}
							</p>
							{confirmId === item.id ? (
								<div className="account-address-confirm" role="alert">
									<p>Hapus alamat ini?{item.is_default && list.length > 1 ? " Alamat lain akan menjadi alamat utama." : ""}</p>
									<div className="account-actions">
										<button className="button" type="button" disabled={busy} onClick={() => remove(item)} data-testid={`confirm-delete-${item.id}`}>Ya, hapus</button>
										<button className="button button-secondary" type="button" disabled={busy} onClick={() => setConfirmId(null)}>Batal</button>
									</div>
								</div>
							) : (
								<div className="account-actions">
									<button className="button button-secondary" type="button" disabled={busy} onClick={() => setEditing({ kind: "edit", id: item.id })} aria-label={`Ubah alamat ${item.address.label || item.address.recipient_name}`}>Ubah</button>
									{!item.is_default && <button className="button button-secondary" type="button" disabled={busy} onClick={() => makeDefault(item)} data-testid={`make-default-${item.id}`} aria-label={`Jadikan alamat ${item.address.label || item.address.recipient_name} utama`}>Jadikan utama</button>}
									<button className="button button-secondary" type="button" disabled={busy} onClick={() => setConfirmId(item.id)} data-testid={`delete-address-${item.id}`} aria-label={`Hapus alamat ${item.address.label || item.address.recipient_name}`}>Hapus</button>
								</div>
							)}
						</li>
					))}
				</ul>
			) : (
				<p className="checkout-hint">Belum ada alamat tersimpan.</p>
			)}
			{editing ? (
				<AddressForm
					key={target ? `${target.id}-${target.version}` : "new"}
					target={target}
					first={list.length === 0}
					profile={profile}
					destinations={destinations}
					busy={busy}
					onCancel={() => setEditing(null)}
					onSubmit={(address, makeMain) =>
						run(async () => {
							const res = target
								? await send(`/api/v1/me/addresses/${target.id}`, { expected_version: target.version, address })
								: await send("/api/v1/me/addresses", { address, make_default: makeMain, expected_book_version: addresses?.book_version ?? 0 });
							if (!res.ok) return failure(res, "Gagal menyimpan alamat.");
							await reload();
							setEditing(null);
							onStatus(target ? "Alamat diperbarui." : "Alamat ditambahkan.");
						})
					}
					onStatus={onStatus}
				/>
			) : list.length >= MAX_ADDRESSES ? (
				<p className="checkout-hint">Alamat tersimpan sudah penuh ({MAX_ADDRESSES}). Hapus satu alamat untuk menambah yang baru.</p>
			) : (
				<button className="button" type="button" disabled={busy || !addresses} onClick={() => setEditing({ kind: "new" })} data-testid="address-add-button">Tambah alamat</button>
			)}
		</div>
	);
}

function AddressForm({
	target,
	first,
	profile,
	destinations,
	busy,
	onCancel,
	onSubmit,
	onStatus,
}: {
	target: BuyerAddressResponse | null;
	first: boolean;
	profile: BuyerProfileResponse;
	destinations: Destination[];
	busy: boolean;
	onCancel: () => void;
	onSubmit: (address: Record<string, string>, makeDefault: boolean) => void;
	onStatus: (message: string) => void;
}) {
	const [label, setLabel] = useState(target?.address.label ?? "");
	const [recipient, setRecipient] = useState(target?.address.recipient_name ?? profile.display_name);
	const [phone, setPhone] = useState(displayPhone(target?.address.phone ?? profile.phone));
	const [destination, setDestination] = useState(destinations.find((d) => d.id === target?.address.destination_code)?.id ?? "");
	// S176: with the real area catalogue (Mengantar or local provider mode) the page sends no list; the buyer searches
	// by kelurahan, kecamatan or postal code, exactly like checkout (GET /api/v1/destinations).
	const search = destinations.length === 0;
	// A fixture id (not a 24-hex catalogue area) from before the catalogue: the buyer picks the area again.
	const saved = target?.address.destination_code && /^[0-9a-f]{24}$/.test(target.address.destination_code)
		? { id: target.address.destination_code, province: target.address.province ?? "", city: target.address.city ?? "", district: target.address.district ?? "", postal_code: target.address.postcode ?? "", subdistrict: target.address.subdistrict ?? "", label: [target.address.subdistrict, target.address.district, target.address.city, target.address.province].filter(Boolean).join(", ") + (target.address.postcode ? ` ${target.address.postcode}` : "") }
		: null;
	const [picked, setPicked] = useState<(Destination & { label: string; subdistrict?: string }) | null>(saved);
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<(Destination & { label: string; subdistrict?: string })[]>([]);
	const [searching, setSearching] = useState(false);

	async function find() {
		const q = query.trim();
		if (q.length < 2) return onStatus("Ketik minimal 2 huruf nama kelurahan, kecamatan, atau kode pos.");
		setSearching(true);
		try {
			const res = await fetch(`/api/v1/destinations?q=${encodeURIComponent(q)}&limit=20`);
			if (!res.ok) return onStatus("Wilayah belum bisa dicari. Coba lagi sebentar lagi.");
			// The address book needs a five-digit postal code; an area without one cannot be saved here.
			const items = ((await res.json()) as { items: (Destination & { label: string; subdistrict?: string })[] }).items.filter((d) => /^\d{5}$/.test(d.postal_code));
			setResults(items);
			// An empty message hides the page notice, so a stale "not found" never sits above a result list.
			onStatus("");
			if (items.length === 0) onStatus("Wilayah tidak ditemukan. Coba nama kelurahan, kecamatan, atau kode pos lain.");
		} catch {
			onStatus("Wilayah belum bisa dicari. Coba lagi sebentar lagi.");
		} finally {
			setSearching(false);
		}
	}
	const [street, setStreet] = useState(target?.address.street ?? "");
	const [makeMain, setMakeMain] = useState(false);

	function submit(event: React.FormEvent) {
		event.preventDefault();
		const chosen = search ? picked : destinations.find((d) => d.id === destination);
		if (!recipient.trim() || !street.trim() || !chosen) return onStatus("Isi nama penerima, wilayah, dan alamat lengkap.");
		if (!looksLikeWhatsApp(phone)) return onStatus("Nomor HP penerima diawali 08 (nomor seluler).");
		onSubmit({ label: label.trim(), recipient_name: recipient.trim(), phone, street: street.trim(), district: chosen.district, city: chosen.city, province: chosen.province, postcode: chosen.postal_code, destination_code: chosen.id, ...("subdistrict" in chosen && chosen.subdistrict ? { subdistrict: String(chosen.subdistrict) } : {}) }, makeMain);
	}

	return (
		<form className="account-address-form" onSubmit={submit} noValidate data-testid="main-address-form">
			<h3>{target ? "Ubah alamat" : "Tambah alamat"}</h3>
			<label>
				Nama alamat (opsional)
				<input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} placeholder="Rumah, kantor" />
			</label>
			<label>
				Nama penerima
				<input value={recipient} onChange={(e) => setRecipient(e.target.value)} maxLength={120} autoComplete="shipping name" />
			</label>
			<label>
				Nomor HP penerima
				<input type="tel" inputMode="numeric" maxLength={24} autoComplete="shipping tel" placeholder="08…" value={phone} onChange={(e) => setPhone(filterContact(e))} />
			</label>
			{search ? (
				<div className="account-destination-search">
					<label>
						Kelurahan atau kode pos
						<input type="search" value={query} onChange={(e) => setQuery(e.target.value)} maxLength={100} autoComplete="off" data-testid="main-address-query"
							onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void find(); } }} />
					</label>
					<button type="button" className="button button-secondary account-destination-find" disabled={searching} onClick={() => void find()}>{searching ? "Mencari wilayah…" : "Cari wilayah"}</button>
					{results.length > 0 && (
						<ul className="account-destination-results" aria-label="Saran wilayah">
							{results.map((d) => (
								<li key={d.id}>
									<button type="button" aria-pressed={picked?.id === d.id} onClick={() => { setPicked(d); setResults([]); }}>{d.label}</button>
								</li>
							))}
						</ul>
					)}
					<p className="account-destination-picked" data-testid="main-address-destination" role="status">{picked ? `Wilayah: ${picked.label}` : target?.address.destination_code ? "Pilih ulang wilayah dari pencarian." : "Belum ada wilayah dipilih."}</p>
				</div>
			) : (
				<label>
					Wilayah pengiriman
					<select value={destination} onChange={(e) => setDestination(e.target.value)} data-testid="main-address-destination">
						<option value="">Pilih wilayah</option>
						{destinations.map((d) => (
							<option key={d.id} value={d.id}>{d.district}, {d.city}, {d.province} {d.postal_code}</option>
						))}
					</select>
				</label>
			)}
			<label>
				Alamat lengkap
				<textarea rows={3} maxLength={240} autoComplete="shipping street-address" value={street} onChange={(e) => setStreet(e.target.value)} data-testid="main-address-street" />
			</label>
			{!target && !first && (
				<label className="account-check">
					<input type="checkbox" checked={makeMain} onChange={(e) => setMakeMain(e.target.checked)} />
					Jadikan alamat utama
				</label>
			)}
			<div className="account-actions">
				<button type="submit" className="button" disabled={busy} data-testid="main-address-save">{target ? "Simpan perubahan" : "Simpan alamat"}</button>
				<button type="button" className="button button-secondary" disabled={busy} onClick={onCancel}>Batal</button>
			</div>
		</form>
	);
}
