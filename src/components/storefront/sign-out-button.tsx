"use client";

import { useState } from "react";

// Ends this browser's session through the existing auth handler (Origin-checked POST), then reloads `to`.
export function SignOutButton({ className = "button button-secondary", to = "/", children = "Keluar" }: { className?: string; to?: string; children?: React.ReactNode }) {
	const [state, setState] = useState<"idle" | "pending" | "failed">("idle");
	async function signOut() {
		setState("pending");
		const response = await fetch("/api/auth/sign-out", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => null);
		if (response?.ok) window.location.assign(to);
		else setState("failed");
	}
	return (
		<>
			<button type="button" className={className} onClick={signOut} disabled={state === "pending"} data-testid="sign-out-button">
				{state === "pending" ? "Sedang keluar…" : children}
			</button>
			{state === "failed" && <span role="alert">Gagal keluar. Coba lagi.</span>}
		</>
	);
}
