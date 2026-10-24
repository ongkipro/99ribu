import assert from "node:assert/strict";
import test from "node:test";
import { domainReceivesMail, emailDomainReceives } from "../src/modules/access/email-domain.ts";
import { normalizePhone, normalizeWhatsApp } from "../src/modules/shipping/address.ts";
import { displayPhone, emailSuggestion, isValidEmail, isWhatsAppNumber, looksLikeWhatsApp, maskedPhone, normalizeEmailInput, phoneInput, waDigits } from "../src/modules/storefront/contact.ts";

// S123 contact inputs (owner 2026-10-25): the shared phone and email rules behind every storefront form.

test("phone fields keep digits only and show a pasted +62/62 number as 08…", () => {
	assert.equal(phoneInput("0812-3456 7890"), "081234567890");
	assert.equal(phoneInput("+62 812 3456 7890"), "081234567890");
	assert.equal(phoneInput("6281234567890"), "081234567890");
	assert.equal(phoneInput("abc0812x"), "0812");
	assert.equal(phoneInput("081234567890123456"), "08123456789012", "at most 14 digits");
	assert.equal(displayPhone("+6281234567890"), "081234567890");
	assert.equal(displayPhone(null), "");
	assert.equal(maskedPhone("+6281234567890"), "08••••••7890");
	assert.equal(waDigits("+6281234567890"), "6281234567890", "wa.me takes digits only");
});

test("stored phones stay E.164 +62…; the WhatsApp field accepts only mobile numbers", () => {
	for (const typed of ["081234567890", "+6281234567890", "6281234567890", "81234567890"]) {
		assert.equal(normalizePhone(typed), "+6281234567890", typed);
		assert.equal(normalizeWhatsApp(typed), "+6281234567890", typed);
	}
	assert.equal(normalizePhone("0215550123"), "+62215550123", "a landline is still a valid recipient phone");
	assert.throws(() => normalizeWhatsApp("0215550123"), (error: { code?: string }) => error.code === "INVALID_WHATSAPP");
	assert.throws(() => normalizeWhatsApp("08123"), (error: { code?: string }) => error.code === "INVALID_INDONESIAN_PHONE");
	assert.ok(isWhatsAppNumber("+628123456789") && !isWhatsAppNumber("+62215550123") && !isWhatsAppNumber("081234567890"));
	assert.ok(looksLikeWhatsApp("081234567890") && !looksLikeWhatsApp("0812345") && !looksLikeWhatsApp("021555012345"));
});

test("email syntax: a dotted domain, no spaces or doubled dots; the domain is lowercased", () => {
	for (const ok of ["nama@email.com", "Nama.Belakang+toko@Contoh.CO.ID", "a@toko-ku.id", "buyer@example.test"]) assert.ok(isValidEmail(ok), ok);
	for (const bad of ["a@b", "a b@c.com", "a@b..com", "a..b@c.com", ".a@c.com", "a.@c.com", "a@-c.com", "a@c.c", "@c.com", "a@", "a@c.com.", `${"a".repeat(65)}@c.com`]) {
		assert.equal(isValidEmail(bad), false, bad);
	}
	assert.equal(normalizeEmailInput("  Nama@Gmail.COM "), "Nama@gmail.com");
});

test("typo suggestions are a one-tap fix, never a block, and leave business domains alone", () => {
	assert.equal(emailSuggestion("rina@gmial.com"), "rina@gmail.com");
	assert.equal(emailSuggestion("rina@gmail.co"), "rina@gmail.com");
	assert.equal(emailSuggestion("rina@gmai.com"), "rina@gmail.com");
	assert.equal(emailSuggestion("rina@yaho.com"), "rina@yahoo.com");
	assert.equal(emailSuggestion("rina@yahoo.co"), "rina@yahoo.com");
	assert.equal(emailSuggestion("rina@hotmial.com"), "rina@hotmail.com");
	assert.equal(emailSuggestion("rina@outlok.com"), "rina@outlook.com");
	assert.equal(emailSuggestion("Rina@GMIAL.COM"), "Rina@gmail.com");
	for (const fine of ["rina@gmail.com", "rina@tokoku.co.id", "rina@yahoo.co.id", "rina"]) assert.equal(emailSuggestion(fine), null, fine);
	assert.ok(isValidEmail("rina@gmial.com"), "a typo domain is still a valid address");
});

test("production domain check: null MX and missing domains refuse, DNS trouble fails open", async () => {
	const nx = Object.assign(new Error("nx"), { code: "ENOTFOUND" }), none = Object.assign(new Error("none"), { code: "ENODATA" });
	const busy = Object.assign(new Error("busy"), { code: "ETIMEOUT" });
	const fake = (mx: () => unknown, a: () => unknown = () => { throw none; }, aaaa: () => unknown = () => { throw none; }) =>
		({ mx: async () => mx(), a: async () => a(), aaaa: async () => aaaa() }) as unknown as Parameters<typeof domainReceivesMail>[1];
	assert.equal(await domainReceivesMail("toko.id", fake(() => [{ exchange: "mx.toko.id", priority: 10 }])), true);
	assert.equal(await domainReceivesMail("toko.id", fake(() => [{ exchange: ".", priority: 0 }])), false, "RFC 7505 null MX");
	assert.equal(await domainReceivesMail("toko.id", fake(() => { throw nx; })), false);
	assert.equal(await domainReceivesMail("toko.id", fake(() => { throw none; }, () => ["192.0.2.1"])), true, "A record fallback");
	assert.equal(await domainReceivesMail("toko.id", fake(() => { throw none; })), false);
	assert.equal(await domainReceivesMail("toko.id", fake(() => { throw busy; })), true, "fails open");
	assert.equal(await emailDomainReceives("a@toko.id", 20, fake(() => new Promise(() => {}))), true, "a timeout fails open");
});
