"use client";

import { useEffect, useRef, useState } from "react";

function Icon({ children }: { children: React.ReactNode }) {
	return (
		<svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			{children}
		</svg>
	);
}

// Share link and code with a copy button. The field stays selectable, so when the clipboard is blocked the
// text is already selected and the confirmation says how to copy it by hand.
export function AffiliateLinkTools({ url, code }: { url: string; code: string }) {
	const [message, setMessage] = useState("");
	const [canShare, setCanShare] = useState(false);
	const urlField = useRef<HTMLInputElement>(null);
	const codeField = useRef<HTMLInputElement>(null);
	useEffect(() => setCanShare(typeof navigator.share === "function"), []);

	async function copy(ref: React.RefObject<HTMLInputElement | null>, value: string, what: string) {
		try {
			await navigator.clipboard.writeText(value);
			setMessage(`${what} disalin.`);
		} catch {
			ref.current?.focus();
			ref.current?.select();
			setMessage(`${what} belum bisa disalin otomatis. Teks sudah dipilih, salin dengan Ctrl+C atau tahan lalu pilih Salin.`);
		}
	}

	async function share() {
		try {
			await navigator.share({ title: "99ribu", text: "Produk 99ribu, harga maksimal Rp99.000.", url });
		} catch {
			// Closing the share sheet is not an error.
		}
	}

	return (
		<div className="aff-link-tools">
			<div className="aff-field">
				<label htmlFor="aff-url">Tautan bagikan</label>
				<div className="aff-copy-row">
					<input id="aff-url" ref={urlField} readOnly value={url} onFocus={(e) => e.currentTarget.select()} data-testid="affiliate-referral-url" />
					<button type="button" className="button" onClick={() => copy(urlField, url, "Tautan")}>
						<Icon><rect width="14" height="14" x="8" y="8" rx="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></Icon>
						Salin tautan
					</button>
				</div>
			</div>
			<div className="aff-field">
				<label htmlFor="aff-code">Kode rujukan</label>
				<div className="aff-copy-row">
					<input id="aff-code" ref={codeField} readOnly value={code} onFocus={(e) => e.currentTarget.select()} data-testid="affiliate-referral-code" />
					<button type="button" className="button button-secondary" onClick={() => copy(codeField, code, "Kode")}>
						Salin kode
					</button>
				</div>
			</div>
			{canShare ? (
				<button type="button" className="button button-secondary aff-share" onClick={share}>
					<Icon><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" /></Icon>
					Bagikan lewat aplikasi lain
				</button>
			) : null}
			<p className="aff-live" role="status" aria-live="polite">{message}</p>
		</div>
	);
}
