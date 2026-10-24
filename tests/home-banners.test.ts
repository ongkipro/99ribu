import assert from "node:assert/strict";
import test from "node:test";
import { bannerHref, bannerPhase, isCurrentBanner } from "../src/modules/storefront/banner-rules.ts";
import { wibInputToIso } from "../src/modules/storefront/format.ts";
import { bannerContent, createInput, orderInput, retireInput, reviseInput } from "../src/modules/storefront/home-banners.ts";

// S110 home banners: link validation, WIB scheduling and closed input parsing (no database).

test("S110 banner links accept only internal storefront listing, category, search and product paths", () => {
	for (const [input, expected] of [
		["/promo", "/promo"],
		["/kategori", "/kategori"],
		["/kategori/otomotif", "/kategori/otomotif"],
		["/kategori/otomotif?sort=newest", "/kategori/otomotif?sort=newest"],
		["/cari?q=kaos polos", "/cari?q=kaos+polos"],
		["/cari?q=kaos&filter.warna=hitam", "/cari?q=kaos&filter.warna=hitam"],
		["/produk/kaos-polos-2b0c9d6e-6c1f-4a43-9b51-7f5c3d1a2e40", "/produk/kaos-polos-2b0c9d6e-6c1f-4a43-9b51-7f5c3d1a2e40"],
	] as const)
		assert.equal(bannerHref(input), expected, input);
	for (const value of [
		undefined,
		null,
		"",
		"promo",
		"https://evil.example/promo",
		"//evil.example/promo",
		"/\\evil.example",
		"javascript:alert(1)",
		"/checkout",
		"/akun",
		"/admin",
		"/api/v1/products",
		"/masuk?next=/admin",
		"/promo?utm_source=x",
		"/cari?q=a&gclid=1",
		"/cari?cursor=abc",
		"/cari?q=",
		"/cari?q=a%0Ab",
		"/cari?q=‮",
		"/kategori/Otomotif",
		"/kategori/a/b",
		"/promo#x",
		"/promo/../admin",
		"/%2e%2e/admin",
		"/ promo",
		`/cari?q=${"x".repeat(400)}`,
	])
		assert.equal(bannerHref(value), null, String(value));
});

test("S110 scheduling reads the admin's WIB wall-clock window as absolute instants (start inclusive, end exclusive)", () => {
	const starts = wibInputToIso("2026-11-01T00:00");
	const ends = wibInputToIso("2026-11-08T00:00");
	assert.equal(starts, "2026-10-31T17:00:00.000Z");
	assert.equal(ends, "2026-11-07T17:00:00.000Z");
	const banner = { active: true, retired: false, starts_at: starts as string, ends_at: ends as string };
	assert.equal(isCurrentBanner(banner, new Date("2026-10-31T16:59:59.999Z")), false);
	assert.equal(bannerPhase(banner, new Date("2026-10-31T16:59:59.999Z")), "scheduled");
	assert.equal(isCurrentBanner(banner, new Date("2026-10-31T17:00:00.000Z")), true);
	assert.equal(bannerPhase(banner, new Date("2026-11-03T05:00:00.000Z")), "live");
	assert.equal(isCurrentBanner(banner, new Date("2026-11-07T16:59:59.999Z")), true);
	assert.equal(isCurrentBanner(banner, new Date("2026-11-07T17:00:00.000Z")), false);
	assert.equal(bannerPhase(banner, new Date("2026-11-07T17:00:00.000Z")), "ended");
	assert.equal(isCurrentBanner({ ...banner, active: false }, new Date("2026-11-03T05:00:00.000Z")), false);
	assert.equal(bannerPhase({ ...banner, active: false }, new Date("2026-11-03T05:00:00.000Z")), "paused");
	assert.equal(bannerPhase({ ...banner, active: false, retired: true }, new Date("2026-11-03T05:00:00.000Z")), "retired");
	// Impossible WIB dates never become a window.
	assert.equal(wibInputToIso("2026-02-30T10:00"), null);
});

test("S110 banner input is closed JSON with bounded text, a valid link and a future window", () => {
	const now = Date.parse("2026-10-25T00:00:00.000Z");
	const content = {
		title: "Paket dapur",
		subtitle: null,
		action_label: "Lihat paket",
		href: "/promo",
		image_sha256: "a".repeat(64),
		image_alt: "Pisau dapur pastel di atas alas putih",
		tint: "slate",
		starts_at: "2026-10-24T17:00:00.000Z",
		ends_at: "2026-11-24T17:00:00.000Z",
		active: true,
	};
	assert.deepEqual(bannerContent(content, now), content);
	const code = (patch: Record<string, unknown>) => {
		try {
			bannerContent({ ...content, ...patch }, now);
			return "accepted";
		} catch (error) {
			return (error as { code: string }).code;
		}
	};
	assert.equal(code({ href: "https://evil.example" }), "INVALID_BANNER_LINK");
	assert.equal(code({ href: "/cari?q=kaos polos" }), "INVALID_BANNER_LINK");
	assert.equal(code({ ends_at: content.starts_at }), "BANNER_WINDOW_INVALID");
	assert.equal(code({ starts_at: "2026-10-01T00:00:00.000Z", ends_at: "2026-10-24T23:59:59.999Z" }), "BANNER_ALREADY_ENDED");
	assert.equal(code({ starts_at: "2027-12-01T00:00:00.000Z", ends_at: "2027-12-02T00:00:00.000Z" }), "BANNER_SCHEDULE_TOO_DISTANT");
	for (const patch of [
		{ title: "" },
		{ title: " Paket" },
		{ title: "x".repeat(61) },
		{ title: "Paket‮dapur" },
		{ subtitle: "" },
		{ subtitle: "x".repeat(141) },
		{ action_label: "x".repeat(25) },
		{ image_alt: "" },
		{ image_sha256: "A".repeat(64) },
		{ tint: "red" },
		{ active: "yes" },
		{ starts_at: "2026-10-25 00:00" },
	])
		assert.equal(code(patch), "INVALID_INPUT", JSON.stringify(patch));
	const proof = { reason: "Kampanye November", reauthentication_proof: "proof_123" };
	assert.throws(() => createInput({ ...content, ...proof, starts_at: "2099-01-01T00:00:00.000Z" }));
	assert.throws(() => createInput({ ...content, ...proof, position: 1 }), /INVALID_INPUT/);
	assert.throws(() => reviseInput({ ...content, ...proof }), /INVALID_INPUT/);
	assert.throws(() => retireInput({ expected_version: 0, ...proof }), /INVALID_INPUT/);
	assert.throws(() => retireInput({ expected_version: 1, reason: "x", reauthentication_proof: "bad proof" }), /INVALID_INPUT/);
	const id = "2b0c9d6e-6c1f-4a43-9b51-7f5c3d1a2e40";
	assert.equal(orderInput({ banners: [{ id: id.toUpperCase(), expected_version: 2 }], ...proof }).banners[0].id, id);
	assert.throws(() => orderInput({ banners: [{ id, expected_version: 1 }, { id, expected_version: 1 }], ...proof }), /INVALID_INPUT/);
	assert.throws(() => orderInput({ banners: [], ...proof }), /INVALID_INPUT/);
});
