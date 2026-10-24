import assert from "node:assert/strict";
import test from "node:test";
import { authHref, cooldownLabel, failureKind, modeFromParam, passwordHint, signUpFailureField, signUpFailureKind, signUpFailureMessage } from "../src/components/storefront/sign-in-copy.ts";
import { isVerificationCallback, safeReturnPath, VERIFIED_PATH, verificationCallback } from "../src/modules/access/return-to.ts";

// S123 sign-up: pure URL and copy rules shared by the forms, /masuk/kirim and handleAuth.

test("the verification callback only returns to the landing page with a validated next", () => {
	assert.equal(verificationCallback(null), VERIFIED_PATH);
	assert.equal(verificationCallback("/pesanan/abc?x=1"), "/masuk/verifikasi?next=%2Fpesanan%2Fabc%3Fx%3D1");
	for (const next of [null, "/akun", "/pesanan/0b1c2d3e-0000-4000-8000-000000000000", "/produk/kaos-1?offer=2#top"]) {
		assert.ok(isVerificationCallback(verificationCallback(next)), String(next));
	}
	for (const hostile of [
		undefined, null, 42, "", "/", "/akun", "https://evil.invalid/masuk/verifikasi", "//evil.invalid/masuk/verifikasi",
		"/masuk/verifikasi?next=https%3A%2F%2Fevil.invalid", "/masuk/verifikasi?next=%2F%2Fevil.invalid", "/masuk/verifikasi?next=%2Fmasuk",
		"/masuk/verifikasi?next=%2Fakun&error=x", "/masuk/verifikasi?next=/akun", "/masuk/verifikasi/../admin", "/masuk/verifikasix",
	]) assert.equal(isVerificationCallback(hostile), false, String(hostile));
	// /masuk and everything under it is never a sign-in destination (no loops through the landing page).
	for (const path of ["/masuk", "/masuk/verifikasi", "/masuk/kirim", "/masuk/verifikasi?next=%2Fakun"]) assert.equal(safeReturnPath(path), null, path);
	assert.equal(safeReturnPath("/masukan"), "/masukan");
});

test("sign-up URLs keep next and never carry form values", () => {
	assert.equal(authHref(null, "daftar"), "/masuk?langkah=daftar");
	assert.equal(authHref("/pesanan/abc", "cek-email"), "/masuk?langkah=cek-email&next=%2Fpesanan%2Fabc");
	assert.equal(authHref("/akun", "masuk"), "/masuk?next=%2Fakun");
	assert.deepEqual(["daftar", "cek-email", "kode", undefined, ["daftar"]].map(modeFromParam), ["daftar", "cek-email", "masuk", "masuk", "masuk"]);
});

test("sign-up and resend failures are named by cause; production's closed gate reads as not open yet", () => {
	const cases: [number, unknown, string][] = [
		[403, "INVALID_ORIGIN", "origin"], [429, undefined, "limit"], [503, "NOTIFICATION_DISABLED", "closed"], [503, "SERVICE_UNAVAILABLE", "network"],
		[0, null, "network"], [400, "PASSWORD_TOO_SHORT", "password"], [400, "PASSWORD_TOO_LONG", "password"], [400, "INVALID_EMAIL", "email"],
		[400, "SYNTHETIC_EMAIL_REQUIRED", "test-email"], [400, "INVALID_INPUT", "input"], [413, "BODY_TOO_LARGE", "input"],
	];
	for (const [status, code, kind] of cases) assert.equal(signUpFailureKind(status, code), kind, `${status} ${code}`);
	assert.equal(signUpFailureMessage("closed", null), "Pendaftaran belum dibuka. Belanja tetap bisa tanpa akun.");
	assert.equal(signUpFailureMessage("limit", 120), "Terlalu banyak percobaan. Coba lagi dalam 2 menit.");
	assert.equal(signUpFailureMessage("limit", 30), "Terlalu banyak percobaan. Coba lagi dalam 1 menit.");
	assert.equal(signUpFailureField("password"), "password");
	assert.equal(signUpFailureField("test-email"), "email");
	assert.equal(signUpFailureField("limit"), null);
	// Only a matched password reaches EMAIL_NOT_VERIFIED; every other sign-in rejection stays "credential".
	assert.equal(failureKind(403, "EMAIL_NOT_VERIFIED"), "unverified");
	assert.equal(failureKind(401, "INVALID_CREDENTIALS"), "credential");
	assert.equal(failureKind(403, "FORBIDDEN"), "credential");
});

test("the password hint counts down to 12 and the resend label shows the wait", () => {
	assert.equal(passwordHint(0), "Minimal 12 karakter.");
	assert.equal(passwordHint(5), "Minimal 12 karakter, kurang 7 lagi.");
	assert.equal(passwordHint(12), "Panjang kata sandi sudah cukup.");
	assert.equal(cooldownLabel(60), "Kirim ulang dalam 1:00");
	assert.equal(cooldownLabel(9), "Kirim ulang dalam 0:09");
	// The daily email budget (10 per address) answers with waits of hours.
	assert.equal(cooldownLabel(80000), "Kirim ulang dalam 23 jam");
	assert.equal(signUpFailureMessage("limit", 80000), "Terlalu banyak permintaan email untuk alamat ini. Coba lagi dalam 23 jam.");
});
