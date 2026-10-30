import { EMAIL_HINT, WHATSAPP_HINT } from "../../modules/storefront/contact.ts";
// Sign-in outcome → copy, shared by the JS form (sign-in-form.tsx), the no-JS form post
// (masuk/kirim/route.ts) and the server-rendered /masuk page. Messages never say whether an email exists:
// only a credential rejection says the email, password or code did not match.
export type SignInStep = "password" | "totp" | "backup";
export type SignInFailure = "origin" | "limit" | "disabled" | "network" | "credential";

export function failureKind(status: number, code: unknown): SignInFailure {
	if (status === 403 && code === "INVALID_ORIGIN") return "origin";
	if (status === 429) return "limit";
	if (status === 503) return "disabled";
	if (status === 0 || status >= 500) return "network";
	return "credential";
}

export function failureMessage(kind: SignInFailure, step: SignInStep, retry: number | null) {
	if (kind === "origin") return "Halaman ini dibuka dari alamat yang tidak diizinkan. Buka toko dari alamat resminya lalu coba lagi.";
	if (kind === "limit") return limitMessage(retry);
	if (kind === "disabled") return "Layanan masuk sedang dinonaktifkan sementara. Coba lagi nanti.";
	if (kind === "network") return "Tidak bisa terhubung. Coba lagi.";
	if (step === "password") return "Email atau kata sandi tidak cocok. Periksa kembali lalu coba lagi.";
	return "Kode tidak cocok atau verifikasi sudah kedaluwarsa. Coba kode terbaru, atau mulai ulang dari email dan kata sandi.";
}

// Input checks before anything is sent. A backup code may be typed with or without its hyphen.
export function codeInput(step: SignInStep, raw: string) {
	const value = raw.replace(/\s+/g, "");
	const backup = step === "backup";
	const code = backup && /^[A-Za-z0-9]{10}$/.test(value) ? `${value.slice(0, 5)}-${value.slice(5)}` : value;
	const ok = backup ? /^[A-Za-z0-9]{5}-[A-Za-z0-9]{5}$/.test(code) : /^\d{6}$/.test(code);
	return ok ? { code, error: null } : { code: null, error: backup ? "Masukkan kode cadangan 10 karakter, contoh: abcde-12345." : "Masukkan 6 digit kode dari aplikasi autentikator." };
}

// URL words for the no-JS round trip (/masuk?langkah=…&galat=…&tunggu=…).
export const STEP_PARAM: Record<SignInStep, string | null> = { password: null, totp: "kode", backup: "cadangan" };
export const stepFromParam = (value: unknown): SignInStep => (value === "kode" ? "totp" : value === "cadangan" ? "backup" : "password");
// `base`: /masuk (buyers) or /portal (owner and staff, sign-in only; owner 2026-10-30).
export const PORTAL_PATH = "/portal";
export const signInHref = (next: string | null, step: SignInStep = "password", base = "/masuk") => {
	const query = new URLSearchParams();
	if (STEP_PARAM[step]) query.set("langkah", STEP_PARAM[step]);
	if (next) query.set("next", next);
	const text = query.toString();
	return text ? `${base}?${text}` : base;
};

// Waits of an hour or more come from the daily email budget (S123 review L1) and read in hours.
const limitMessage = (retry: number | null) =>
	!retry ? "Terlalu banyak percobaan. Coba lagi dalam beberapa menit."
	: retry >= 3600 ? `Terlalu banyak permintaan email untuk alamat ini. Coba lagi dalam ${Math.ceil(retry / 3600)} jam.`
	: `Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil(retry / 60)} menit.`;

// S123 sign-up. `/masuk?langkah=daftar` is the form, `langkah=cek-email` the uniform "check your email"
// state (also where the no-JS post lands); both keep `next`, which the verification link carries on.
export type AuthMode = "masuk" | "daftar" | "cek-email";
export const modeFromParam = (value: unknown): AuthMode => (value === "daftar" ? "daftar" : value === "cek-email" ? "cek-email" : "masuk");
export const authHref = (next: string | null, mode: AuthMode) => {
	if (mode === "masuk") return signInHref(next);
	const query = new URLSearchParams({ langkah: mode });
	if (next) query.set("next", next);
	return `/masuk?${query}`;
};
export const PASSWORD_MIN = 12, PASSWORD_MAX = 128, NAME_MAX = 100;
export const RESEND_COOLDOWN = 60;

// Sign-up and resend outcomes. A new and an already registered email get the same 200 (Better Auth
// mails the existing owner instead), so nothing here can tell them apart.
export type SignUpFailure = "origin" | "limit" | "closed" | "network" | "empty" | "password" | "email" | "domain" | "whatsapp" | "test-email" | "input";
export const SIGN_UP_FAILURES: SignUpFailure[] = ["origin", "limit", "closed", "network", "empty", "password", "email", "domain", "whatsapp", "test-email", "input"];

export function signUpFailureKind(status: number, code: unknown): SignUpFailure {
	if (status === 403 && code === "INVALID_ORIGIN") return "origin";
	if (status === 429) return "limit";
	if (status === 503 && code === "NOTIFICATION_DISABLED") return "closed";
	if (status === 0 || status >= 500) return "network";
	if (code === "PASSWORD_TOO_SHORT" || code === "PASSWORD_TOO_LONG") return "password";
	if (code === "INVALID_EMAIL") return "email";
	if (code === "EMAIL_DOMAIN_UNREACHABLE") return "domain";
	if (code === "INVALID_WHATSAPP") return "whatsapp";
	if (code === "SYNTHETIC_EMAIL_REQUIRED") return "test-email";
	return "input";
}

export function signUpFailureMessage(kind: SignUpFailure, retry: number | null) {
	if (kind === "origin") return failureMessage("origin", "password", null);
	if (kind === "limit") return limitMessage(retry);
	if (kind === "closed") return "Pendaftaran belum dibuka. Belanja tetap bisa tanpa akun.";
	if (kind === "network") return "Tidak bisa terhubung. Coba lagi.";
	if (kind === "empty") return "Isi nama, email, dan nomor WhatsApp.";
	if (kind === "password") return `Kata sandi minimal ${PASSWORD_MIN} karakter.`;
	if (kind === "email") return EMAIL_HINT;
	if (kind === "domain") return "Domain email ini tidak bisa menerima email. Periksa penulisannya.";
	if (kind === "whatsapp") return WHATSAPP_HINT;
	if (kind === "test-email") return "Profil lokal hanya menerima email uji yang berakhiran .test atau .invalid.";
	return "Pendaftaran belum bisa diproses. Periksa isian lalu coba lagi.";
}

// The field a failure points at (aria-invalid and the focus target after it).
export const signUpFailureField = (kind: SignUpFailure): "name" | "email" | "phone" | "password" | null =>
	kind === "password" ? "password" : kind === "whatsapp" ? "phone" : kind === "email" || kind === "domain" || kind === "test-email" ? "email" : null;

// Live password hint under the field.
export const passwordHint = (length: number) =>
	length >= PASSWORD_MIN ? "Panjang kata sandi sudah cukup." : `Minimal ${PASSWORD_MIN} karakter${length ? `, kurang ${PASSWORD_MIN - length} lagi` : ""}.`;

export const cooldownLabel = (seconds: number) =>
	seconds >= 3600 ? `Kirim ulang dalam ${Math.ceil(seconds / 3600)} jam` : `Kirim ulang dalam ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
