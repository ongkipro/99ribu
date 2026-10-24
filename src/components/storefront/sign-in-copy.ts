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
	if (kind === "limit") return retry ? `Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil(retry / 60)} menit.` : "Terlalu banyak percobaan. Coba lagi dalam beberapa menit.";
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
export const signInHref = (next: string | null, step: SignInStep = "password") => {
	const query = new URLSearchParams();
	if (STEP_PARAM[step]) query.set("langkah", STEP_PARAM[step]);
	if (next) query.set("next", next);
	const text = query.toString();
	return text ? `/masuk?${text}` : "/masuk";
};
