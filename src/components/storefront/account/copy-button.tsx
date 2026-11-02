"use client";

import { useEffect, useRef, useState } from "react";

// Copies one value (the tracking number). The result is announced in a polite live region; when the
// clipboard is unavailable (insecure context, denied permission) the value opens in a selected, read-only
// field so the buyer can copy it by hand.
export function CopyButton({ value, label }: { value: string; label: string }) {
	const [state, setState] = useState<"idle" | "copied" | "manual">("idle");
	const field = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (state === "manual") field.current?.select();
		if (state !== "copied") return;
		const timer = setTimeout(() => setState("idle"), 4000);
		return () => clearTimeout(timer);
	}, [state]);

	async function copy() {
		try {
			await navigator.clipboard.writeText(value);
			setState("copied");
		} catch {
			setState("manual");
		}
	}

	return (
		<span className="account-copy">
			<button className="account-copy-button" type="button" onClick={copy} aria-label={`Salin ${label} ${value}`}>
				<svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
					<rect x="9" y="9" width="13" height="13" rx="2" />
					<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
				</svg>
				Salin
			</button>
			{state === "manual" && <input ref={field} className="account-copy-field" readOnly value={value} aria-label={`${label}, pilih lalu salin manual`} onFocus={(event) => event.currentTarget.select()} />}
			<span className="account-copy-status" role="status" aria-live="polite" aria-atomic="true">
				{state === "copied" ? `${label} disalin.` : state === "manual" ? `Tidak bisa menyalin otomatis. Pilih ${label} lalu salin.` : ""}
			</span>
		</span>
	);
}
