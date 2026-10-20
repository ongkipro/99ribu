import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { before, after, test } from "node:test";
import { chromium, expect } from "@playwright/test";

const origin = "http://127.0.0.1:3099";
const path = "/prototypes/index.html";
const output = "docs/spec/design/renders/s08";
const views = [
	"home",
	"search",
	"product",
	"checkout",
	"order",
	"returns",
	"affiliate",
	"warehouse",
	"chat",
];
let browser;
before(async () => {
	browser = await chromium.launch({
		executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
	});
	await mkdir(output, { recursive: true });
});
after(async () => {
	await browser?.close();
});

async function pageAt(width, view, height = 900) {
	const context = await browser.newContext({
		viewport: { width, height },
		reducedMotion: "reduce",
	});
	const errors = [];
	const page = await context.newPage();
	page.setDefaultTimeout(5000);
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("request", (request) => {
		if (
			new URL(request.url()).origin !== origin ||
			request.url().includes("/api/")
		)
			errors.push("Unexpected external/API request");
	});
	const response = await page.goto(`${origin}${path}?view=${view}`);
	assert.equal(response.status(), 200);
	await expect(page.locator("#main")).toBeVisible();
	await page.evaluate(() => document.fonts.ready);
	return { page, context, errors };
}
async function noOverflow(page) {
	const delta = await page.evaluate(
		() =>
			document.documentElement.scrollWidth -
			document.documentElement.clientWidth,
	);
	assert.ok(
		delta <= 1,
		`Horizontal overflow ${delta}px at ${page.viewportSize().width}px on ${page.url()}`,
	);
}

for (const width of [390, 768, 1440]) {
	for (const view of views) {
		test(`${view} composition at ${width}px uses local font, no external/domain calls or page overflow`, async () => {
			const { page, context, errors } = await pageAt(width, view);
			try {
				await noOverflow(page);
				assert.equal(
					await page.evaluate(() => document.fonts.check("16px Inter")),
					true,
				);
				await expect(
					page.getByText("Prototipe · data contoh", { exact: true }),
				).toBeVisible();
				assert.equal(await page.locator("h1").count(), 1);
				const text = await page.locator("body").innerText();
				assert.ok(
					!/\p{Extended_Pictographic}/u.test(text),
					"No emoji/emoticon icon substitution",
				);
				await page.screenshot({
					path: `${output}/${view}-${width}.png`,
					fullPage: true,
				});
				assert.deepEqual(errors, []);
			} finally {
				await context.close();
			}
		});
	}
}

test("mobile search, filter dialog keyboard and Back preserve the public result context", async () => {
	const { page, context, errors } = await pageAt(390, "home");
	try {
		await page.getByRole("searchbox", { name: "Cari produk" }).fill("kemeja");
		await page.getByRole("button", { name: "Cari", exact: true }).click();
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			"Hasil untuk “kemeja”",
		);
		await page.getByRole("link", { name: /Kemeja lengan panjang/ }).click();
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			"Kemeja lengan panjang",
		);
		await page.goBack();
		await expect(
			page.getByRole("searchbox", { name: "Cari produk" }),
		).toHaveValue("kemeja");
		await page.getByRole("button", { name: "Filter", exact: true }).click();
		await expect(
			page.getByRole("dialog", { name: "Filter kategori" }),
		).toBeVisible();
		await page.keyboard.press("Shift+Tab");
		assert.equal(
			await page.evaluate(() =>
				document.querySelector("#preview").contains(document.activeElement),
			),
			true,
		);
		await page.keyboard.press("Escape");
		await expect(
			page.getByRole("button", { name: "Filter", exact: true }),
		).toBeFocused();
		await page.getByRole("searchbox").fill("tidak-ada-produk");
		await page.getByRole("button", { name: "Cari", exact: true }).click();
		await expect(
			page.getByRole("heading", { name: "Produk belum ditemukan" }),
		).toBeVisible();
		await page.getByRole("link", { name: "Lihat semua pilihan" }).click();
		await expect(page.locator(".product-card")).toHaveCount(5);
		assert.deepEqual(errors, []);
	} finally {
		await context.close();
	}
});

test("checkout retains safe input through validation, stale quote, Back and explicit preview", async () => {
	const { page, context, errors } = await pageAt(390, "checkout");
	try {
		await page.getByRole("button", { name: "Lanjut ke pengiriman" }).click();
		await expect(
			page.getByRole("textbox", { name: "Nama lengkap" }),
		).toBeFocused();
		await page.getByRole("textbox", { name: "Nama lengkap" }).fill("Contoh");
		await page.getByRole("textbox", { name: "Nomor HP" }).fill("080000000000");
		await page
			.getByRole("textbox", { name: "Alamat lengkap" })
			.fill("Alamat sintetis untuk pengujian");
		await page.getByRole("button", { name: "Lanjut ke pengiriman" }).click();
		await expect(
			page.getByRole("heading", { name: "Pengiriman dan pembayaran" }),
		).toBeVisible();
		await page
			.getByRole("button", { name: "Lihat contoh ongkir kedaluwarsa" })
			.click();
		await page.getByRole("button", { name: "Tinjau pesanan" }).click();
		await expect(
			page.getByRole("button", { name: "Periksa ongkir lagi" }),
		).toBeFocused();
		await page.getByRole("button", { name: "Periksa ongkir lagi" }).click();
		await page.getByRole("button", { name: "Kembali", exact: true }).click();
		await expect(
			page.getByRole("textbox", { name: "Nama lengkap" }),
		).toHaveValue("Contoh");
		await expect(
			page.getByRole("textbox", { name: "Alamat lengkap" }),
		).toHaveValue("Alamat sintetis untuk pengujian");
		await page.getByRole("button", { name: "Lanjut ke pengiriman" }).click();
		await page.getByRole("button", { name: "Tinjau pesanan" }).click();
		await expect(page.locator("main")).toContainText("Rp113.000");
		await expect(page.locator("main")).toContainText("Rp117.000");
		await page.screenshot({
			path: `${output}/checkout-review-390.png`,
			fullPage: true,
		});
		await page.getByRole("button", { name: "Pratinjau konfirmasi" }).click();
		await expect(page.getByRole("dialog")).toContainText(
			"Tidak ada pesanan dibuat atau pembayaran diproses.",
		);
		assert.deepEqual(errors, []);
	} finally {
		await context.close();
	}
});

test("task screens own their bottom controls; failed chat retains draft across Back and short viewport", async () => {
	const { page, context, errors } = await pageAt(390, "chat", 600);
	try {
		await expect(page.locator(".mobile-nav")).toHaveCount(0);
		await page
			.getByRole("textbox", { name: "Pesan", exact: true })
			.fill("Pertanyaan contoh yang belum terkirim");
		await page.getByRole("button", { name: "Kirim", exact: true }).click();
		await expect(
			page.getByRole("status").filter({ hasText: "Pesan belum dikirim" }),
		).toBeVisible();
		await expect(
			page.getByRole("textbox", { name: "Pesan", exact: true }),
		).toHaveValue("Pertanyaan contoh yang belum terkirim");
		await page.getByRole("link", { name: "Kembali ke pesanan" }).click();
		await page.goBack();
		await expect(
			page.getByRole("textbox", { name: "Pesan", exact: true }),
		).toHaveValue("Pertanyaan contoh yang belum terkirim");
		await page.setViewportSize({ width: 390, height: 400 });
		await page.getByRole("textbox", { name: "Pesan", exact: true }).focus();
		await noOverflow(page);
		const box = await page
			.getByRole("textbox", { name: "Pesan", exact: true })
			.boundingBox();
		assert.ok(
			box.y >= 0 && box.y < 400,
			"Focused composer remains reachable in keyboard-height proxy",
		);
		assert.deepEqual(errors, []);
	} finally {
		await context.close();
	}
});

test("320px reflow and 200% text retain navigation, labels and values without horizontal overflow", async () => {
	for (const view of views) {
		const { page, context } = await pageAt(320, view);
		try {
			await noOverflow(page);
			// Injecting a test stylesheet measures enlargement; it does not alter shipped prototype CSS.
			await page.evaluate(() =>
				document.documentElement.style.setProperty(
					"font-size",
					"200%",
					"important",
				),
			);
			await noOverflow(page);
			await expect(page.locator("h1")).toBeVisible();
		} finally {
			await context.close();
		}
	}
});

test("warehouse filtered-zero and detail distinguish printed label from physical handover", async () => {
	const { page, context, errors } = await pageAt(768, "warehouse");
	try {
		await page.getByLabel("Tampilkan").selectOption("empty");
		await expect(
			page.getByRole("heading", { name: "Tidak ada paket pada filter ini" }),
		).toBeVisible();
		await page.getByRole("button", { name: "Hapus filter" }).click();
		await page.locator('[data-job="CONTOH-02"]').click();
		await expect(page.getByRole("dialog")).toContainText("AWB-CONTOH-02");
		await expect(page.getByRole("dialog")).toContainText("Belum diserahkan");
		await page.keyboard.press("Escape");
		await expect(page.locator('[data-job="CONTOH-02"]')).toBeFocused();
		assert.deepEqual(errors, []);
	} finally {
		await context.close();
	}
});

test("return from a payment handoff remains pending and rechecks the same example order", async () => {
	const { page, context, errors } = await pageAt(
		390,
		"order&state=payment-pending",
	);
	try {
		await expect(
			page.getByRole("heading", { name: "Pembayaran belum terkonfirmasi" }),
		).toBeVisible();
		await page
			.getByRole("button", { name: "Lihat contoh status terbaru" })
			.click();
		await expect(
			page.getByRole("status").filter({ hasText: "masih menunggu konfirmasi" }),
		).toBeVisible();
		await page.screenshot({
			path: `${output}/payment-pending-390.png`,
			fullPage: true,
		});
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.screenshot({
			path: `${output}/payment-pending-1440.png`,
			fullPage: true,
		});
		assert.deepEqual(errors, []);
	} finally {
		await context.close();
	}
});

test("checkout estimate and disclosure stay explicit; parcel progress and variant facts are separate", async () => {
	const { page, context } = await pageAt(390, "checkout");
	try {
		await expect(page.locator("summary")).toContainText(
			"Estimasi · ongkir belum final",
		);
		await expect(page.locator(".summary-content")).toBeHidden();
		await page.locator("summary").click();
		await expect(page.locator(".summary-content")).toBeVisible();
		await expect(page.locator("summary")).toContainText("Tutup ringkasan");
		await page.goto(`${origin}${path}?view=order`);
		await expect(
			page.getByRole("list", { name: "Status paket 1" }),
		).toContainText("Menunggu resi");
		await expect(
			page.getByRole("list", { name: "Status paket 2" }),
		).toContainText("Menunggu resi");
		await expect(
			page.getByRole("region", { name: "Paket 1", exact: true }),
		).toContainText("ukuran M");
		const summaryBox = await page.locator("#order-summary").boundingBox();
		const parcelsBox = await page.locator(".order-parcels").boundingBox();
		assert.ok(
			summaryBox.y < parcelsBox.y,
			"Mobile summary precedes parcel details",
		);
	} finally {
		await context.close();
	}
});

test("mobile shopping navigation, payout categories and warehouse history remain reachable", async () => {
	const { page, context } = await pageAt(390, "home");
	try {
		await page.keyboard.press("Tab");
		await expect(
			page.getByRole("link", { name: "Lewati ke isi" }),
		).toBeFocused();
		await page.keyboard.press("Enter");
		await expect(page.locator("#main")).toBeFocused();
		await page
			.getByRole("navigation", { name: "Navigasi utama" })
			.getByRole("link", { name: "Keranjang" })
			.click();
		await expect(page.getByRole("dialog")).toContainText("2 pilihan");
		await page.keyboard.press("Escape");
		await page.goto(`${origin}${path}?view=affiliate`);
		await expect(
			page.getByText("Menunggu transfer manual", { exact: true }),
		).toBeVisible();
		const balances = await page.locator(".balance-list").boundingBox();
		const referral = await page.locator(".affiliate-referral").boundingBox();
		assert.ok(balances.y < referral.y, "Mobile balances precede referral link");
		await page.goto(`${origin}${path}?view=warehouse`);
		await expect(
			page.getByRole("link", { name: "Riwayat pekerjaan" }),
		).toBeVisible();
		await expect(
			page.getByText("16 Okt, 08.30 WIB", { exact: true }),
		).toBeVisible();
	} finally {
		await context.close();
	}
});

test("browser Back closes overlays; every cart entry and warehouse history opens the correct preview", async () => {
	for (const width of [390, 1440]) {
		const { page, context } = await pageAt(width, "home");
		try {
			const categoryBox = await page
				.getByRole("navigation", { name: "Kategori produk" })
				.getByRole("link", { name: "Elektronik" })
				.boundingBox();
			assert.ok(
				categoryBox.x >= 0 && categoryBox.x + categoryBox.width <= width,
				"Every category stays within the viewport",
			);
			await page.locator(".header-actions [data-cart-preview]").click();
			await expect(
				page.getByRole("dialog", { name: "Contoh keranjang" }),
			).toBeVisible();
			await expect(page.locator("#preview .line-item")).toHaveCount(2);
			await expect(page.locator("#preview .line-item").first()).toContainText(
				"1 pilihan · ukuran M",
			);
			assert.ok(
				(await page.locator(".cart-continue").boundingBox()).height >= 44,
			);
			await page.screenshot({ path: `${output}/cart-preview-${width}.png` });
			await page.goBack();
			await expect(page.getByRole("dialog")).toHaveCount(0);
			await expect(page.getByRole("heading", { level: 1 })).toHaveText(
				"Kebutuhan harian, satu harga.",
			);
			await page.goto(`${origin}${path}?view=product`);
			await page.getByRole("button", { name: "S", exact: true }).click();
			await expect(page.locator("#selected-size")).toHaveText("S");
			await page.getByRole("link", { name: "Keranjang", exact: true }).click();
			await expect(
				page.getByRole("dialog", { name: "Contoh keranjang" }),
			).toBeVisible();
			await page
				.getByRole("link", { name: "Lanjut ke contoh checkout" })
				.click();
			await expect(
				page.getByRole("heading", { name: "Alamat penerima" }),
			).toBeVisible();
			await page.getByRole("button", { name: "Privasi", exact: true }).click();
			await expect(
				page.getByRole("dialog", { name: "Privasi prototipe" }),
			).toContainText("hanya disimpan sementara");
			await page.screenshot({ path: `${output}/privacy-preview-${width}.png` });
			await page.goBack();
			await expect(page.getByRole("dialog")).toHaveCount(0);
			await page.goBack();
			await expect(
				page.getByRole("heading", {
					name: "Kemeja lengan panjang",
					exact: true,
				}),
			).toBeVisible();
			await page.goto(`${origin}${path}?view=warehouse`);
			await page.getByRole("link", { name: "Riwayat pekerjaan" }).click();
			await expect(
				page.getByRole("dialog", { name: "Riwayat pekerjaan Malang" }),
			).toContainText("08.40 · Label CONTOH-02 dicetak");
			await page.screenshot({
				path: `${output}/warehouse-history-${width}.png`,
			});
			await page.goBack();
			await expect(page.getByRole("dialog")).toHaveCount(0);
			await expect(
				page.getByRole("link", { name: "Riwayat pekerjaan" }),
			).toBeFocused();
		} finally {
			await context.close();
		}
	}
});
