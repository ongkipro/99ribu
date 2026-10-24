"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { Icon } from "./ui/icon";

// /masuk opened by client navigation from a storefront page (intercepted route): a modal <dialog> over
// that page, centred from 701px and a bottom sheet on phones. showModal() makes the page inert; Tab is
// kept inside, Escape, the close button and a scrim click go back (closing the modal), and focus returns
// to the control that opened it. A reload or a shared link shows the full /masuk page instead.
export function SignInModal({ children }: { children: React.ReactNode }) {
	const router = useRouter();
	const ref = useRef<HTMLDialogElement>(null);

	useEffect(() => {
		const dialog = ref.current;
		if (!dialog) return;
		const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
		if (!dialog.open) dialog.showModal();
		dialog.querySelector<HTMLElement>("input:not([type=hidden])")?.focus();
		const keys = (event: KeyboardEvent) => {
			if (event.key !== "Tab") return;
			const list = [...dialog.querySelectorAll<HTMLElement>("a[href],button:not(:disabled),input:not([type=hidden]):not(:disabled)")];
			const first = list[0], last = list.at(-1), at = document.activeElement;
			if (event.shiftKey && (at === first || !dialog.contains(at))) { event.preventDefault(); last?.focus(); }
			else if (!event.shiftKey && (at === last || !dialog.contains(at))) { event.preventDefault(); first?.focus(); }
		};
		dialog.addEventListener("keydown", keys);
		return () => {
			dialog.removeEventListener("keydown", keys);
			if (dialog.open) dialog.close();
			if (opener?.isConnected) opener.focus({ preventScroll: true });
		};
	}, []);

	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents: the scrim click is a pointer shortcut; Escape and the close button cover keyboards.
		<dialog ref={ref} className="signin-sheet" aria-label="Masuk" data-testid="signin-modal"
			onCancel={(event) => { event.preventDefault(); router.back(); }}
			onClick={(event) => { if (event.target === event.currentTarget) router.back(); }}>
			<div className="signin-sheet-body">
				<button type="button" className="filter-pop-close signin-close" aria-label="Tutup" onClick={() => router.back()}><Icon name="close" /></button>
				{children}
			</div>
		</dialog>
	);
}
