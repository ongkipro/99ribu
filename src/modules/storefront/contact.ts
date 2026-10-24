// S123 contact inputs (owner 2026-10-25): one set of pure rules for every storefront field that takes a
// phone or an email, shared by the client forms and the server checks. Stored phones stay E.164 `+62…`
// (shipping/address.ts normalizePhone, unchanged: order search, guest-lookup digests, rate-limit keys and ad
// hashing depend on it); screens show and accept the local `08…` form.

// What a phone field keeps while typing or pasting: digits only (at most 14), a pasted `+62…`/`62…` shown as
// `08…`. Inputs allow 24 characters so a formatted paste ("+62 812-3456-7890") is not cut before filtering.
export function phoneInput(raw: string) {
	const digits = raw.replace(/\D/g, "");
	return (digits.startsWith("62") ? `0${digits.slice(2)}` : digits).slice(0, 14);
}

// A stored `+62…` (or already local) number as the screen shows it.
export const displayPhone = (stored: string | null | undefined) => (stored ? phoneInput(stored) : "");

// Masked except the last 4 digits (the profile until the buyer edits it).
export function maskedPhone(stored: string | null | undefined) {
	const local = displayPhone(stored);
	return local.length > 6 ? `${local.slice(0, 2)}${"•".repeat(local.length - 6)}${local.slice(-4)}` : local;
}

// WhatsApp needs an Indonesian mobile number: `+628` plus 7-11 digits once normalized.
export const isWhatsAppNumber = (e164: string) => /^\+628\d{7,11}$/.test(e164);
export const WHATSAPP_HINT = "Masukkan nomor WhatsApp (diawali 08).";
// Client pre-check of the local form (the server re-validates with normalizePhone + isWhatsAppNumber).
export const looksLikeWhatsApp = (local: string) => /^08\d{8,11}$/.test(local);
// pattern attribute for no-JS forms (the local form above).
export const WHATSAPP_PATTERN = "08[0-9]{8,11}";

// wa.me links take digits only (`62…`).
export const waDigits = (e164: string) => e164.replace(/\D/g, "");

// Email: trimmed, domain lowercased; a dotted domain, no spaces, no empty or doubled dots.
export function normalizeEmailInput(raw: string) {
	const value = raw.trim();
	const at = value.lastIndexOf("@");
	return at < 0 ? value : `${value.slice(0, at)}@${value.slice(at + 1).toLowerCase()}`;
}
export function isValidEmail(raw: string) {
	const value = normalizeEmailInput(raw);
	if (value.length > 254 || /\s/.test(value) || value.includes("..")) return false;
	const match = /^([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+)@([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)$/.exec(value);
	return Boolean(match && !match[1].startsWith(".") && !match[1].endsWith(".") && match[1].length <= 64 && /\.[a-z]{2,}$/.test(match[2]));
}
export const EMAIL_HINT = "Masukkan alamat email yang valid, contoh: nama@email.com.";

// One-tap typo fix for common mail domains; a suggestion only, never a block (any business domain is valid).
const TYPOS: Record<string, string> = {
	"gmial.com": "gmail.com", "gmai.com": "gmail.com", "gmail.co": "gmail.com", "gmail.con": "gmail.com", "gmaill.com": "gmail.com",
	"gamil.com": "gmail.com", "gnail.com": "gmail.com", "gmail.cm": "gmail.com", "gmail.om": "gmail.com", "gmal.com": "gmail.com",
	"yaho.com": "yahoo.com", "yahoo.co": "yahoo.com", "yahooo.com": "yahoo.com", "yhoo.com": "yahoo.com", "yahoo.con": "yahoo.com",
	"yaho.co.id": "yahoo.co.id", "yahoo.co.di": "yahoo.co.id",
	"hotmial.com": "hotmail.com", "hotmal.com": "hotmail.com", "hotmail.co": "hotmail.com", "hotmai.com": "hotmail.com",
	"outlok.com": "outlook.com", "outllook.com": "outlook.com", "outlook.co": "outlook.com", "outloo.com": "outlook.com",
	"icloud.co": "icloud.com", "iclod.com": "icloud.com", "ymail.co": "ymail.com",
};
export function emailSuggestion(raw: string) {
	const value = normalizeEmailInput(raw);
	const at = value.lastIndexOf("@");
	const fix = at > 0 ? TYPOS[value.slice(at + 1)] : undefined;
	return fix ? `${value.slice(0, at)}@${fix}` : null;
}
