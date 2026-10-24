"use client";

import { emailSuggestion, phoneInput } from "../../../modules/storefront/contact";

// S123 contact inputs shared by every storefront form that takes a phone or an email (sign-up, resend,
// checkout contact, /akun profile and guest lookup, receipt link card). Rules live in modules/storefront/contact.ts.

// Phone: digits only while typing or pasting (a pasted +62…/62… shows as 08…), the caret kept after the
// digits that were before it. `mixed` fields (email or phone) filter only while no letter or @ is typed.
export function filterContact(event: React.ChangeEvent<HTMLInputElement>, mixed = false) {
	return filterValue(event.currentTarget, mixed);
}
function filterValue(input: HTMLInputElement, mixed: boolean) {
	const raw = input.value;
	if (mixed && /[A-Za-z@]/.test(raw)) return raw;
	// A mixed field may still become an email that starts with digits, so only a `+…` paste is rewritten there.
	const value = mixed && !raw.trim().startsWith("+") ? raw.replace(/\D/g, "") : phoneInput(raw);
	if (value !== raw) {
		const caret = phoneInput(raw.slice(0, input.selectionStart ?? raw.length)).length;
		requestAnimationFrame(() => { if (document.activeElement === input) input.setSelectionRange(caret, caret); });
	}
	return value;
}

// "Maksud Anda …@gmail.com?" as a one-tap fix under an email field; never blocks the address as typed.
export function EmailSuggestion({ value, onPick, id }: { value: string; onPick: (fixed: string) => void; id?: string }) {
	const fix = /@/.test(value) ? emailSuggestion(value) : null;
	return (
		<p id={id} className="contact-suggest" aria-live="polite" data-testid="email-suggestion" hidden={!fix}>
			{fix && <>Maksud Anda <button type="button" className="contact-suggest-fix" onClick={() => onPick(fix)}>{fix}</button>?</>}
		</p>
	);
}
