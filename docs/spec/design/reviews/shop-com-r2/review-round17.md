Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/shop-com-r2-20261022/cart-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/cart-390.png, docs/spec/design/renders/shop-com-r2-20261022/cart-768.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-390.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-768.png, docs/spec/design/renders/shop-com-r2-20261022/categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/categories-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/categories-390.png, docs/spec/design/renders/shop-com-r2-20261022/categories-768.png, docs/spec/design/renders/shop-com-r2-20261022/help-1440.png, docs/spec/design/renders/shop-com-r2-20261022/help-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/help-390.png, docs/spec/design/renders/shop-com-r2-20261022/help-768.png, docs/spec/design/renders/shop-com-r2-20261022/home-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-768.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-1440.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-390.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-768.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-1440.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-390.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-768.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-1440.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-390.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-768.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-768.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-768.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-open-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-open-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/search-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-768.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-768.png, docs/spec/design/renders/shop-com-r2-20261022/search-filters-open-390.png
References: docs/spec/design/references/shop-com/2026-10-22-cart/1440.png, docs/spec/design/references/shop-com/2026-10-22-cart/390.png, docs/spec/design/references/shop-com/2026-10-22-help/1440.png, docs/spec/design/references/shop-com/2026-10-22-help/390.png, docs/spec/design/references/shop-com/2026-10-22-home/1440.png, docs/spec/design/references/shop-com/2026-10-22-home/390.png, docs/spec/design/references/shop-com/2026-10-22-pdp-1440.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390-scrolled.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390.png, docs/spec/design/references/shop-com/2026-10-22-search-1440.png, docs/spec/design/references/shop-com/2026-10-22-search-390.png, docs/spec/design/references/shop-com/2026-10-22-search-filters-390.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: 43ccc597e4242932
Images-SHA: 65627a1329f30ff3
Output-SHA: a70eaf35e10e6628

Paduka Ongki, saya sudah buka ke-176 gambarnya, semua lebar dan semua state. Tidak ada file repo yang saya ubah. Review lengkap plus rencana perbaikan ada di `/home/ongki/.claude/plans/you-review-a-web-declarative-pascal.md`.

**Per section**

| Section | generic / authored | Look matched | One concrete fix |
|---|---|---|---|
| Banner + header (omnibox, chips) | authored | shop.com: pill omnibox putih + submit ungu bulat, chip hairline, fade di ujung | — |
| Home hero + kartu harga | authored (deviasi round-1 yang sudah diterima) | value card shop.com, sebagian | Di 1440, H1 ~28px kalah berat dari "Rp99.000"; tidak dibuka ulang karena sudah diterima |
| Home "Kategori ›" | authored, rusak di HP | tile kategori shop.com | 390: nama ditumpuk di atas foto (seperti 768) atau 1 tile per baris |
| Shelf "Terbaru ›" / departemen | authored | shelf produk satu baris shop.com | 1440: tampilkan ~6,5 kartu (kartu ke-8 kelihatan sebagian) atau tombol "›" |
| Product card | authored | media putih 20px, judul regular, harga 600 | — |
| Listing + panel filter | authored (deviasi R4 yang diterima) | chip row → panel select native | Di 768 panel mendorong foto produk ke ~y650; sudah diterima kontrak |
| Grid + pagination | authored | grid full-width 5/3/2 kolom | — |
| PDP media + buy box | authored | media 24px + buy box sempit + pill 52px | — |
| PDP isi bundle (dibuka) | authored | pola accordion | Tombol "Sembunyikan barang lainnya" membelah list di antara item 3 dan 4 (minor) |
| Cart kosong / not-found | authored | empty cart shop.com: satu pill terisi | — |
| Cart berisi | authored | R7: baris tanpa box + summary 20px | — |
| Help + kartu chat | authored | help.shop.app: kolom tengah + kartu 2-up | — |
| /masuk normal + error | authored | kartu putih 20px di tengah | — |
| Footer + dock | authored | R9 / R10 | — |

**Masalah yang masih ada**
1. **Tile kategori di HP (material):** `666bf4a073b7caba-categories-390-01.png` dan `b2fa7d0934f1b0da-home-390-01/02.png`. Foto 56px di samping nama cuma menyisakan ~80px untuk teks. Hasilnya nama patah jadi 3–4 baris dan ada "&" sendirian satu baris ("Kecantikan / & / Perawatan / Diri"). Round 17 sudah membereskan ini di tablet, tapi belum di 390.
2. **Shelf desktop tidak kelihatan bisa di-scroll (material):** `894181cd6f0102a7-home-1440-01.png`. Tujuh kartu pas mengisi tepi konten, jadi kartu ke-8 tersembunyi tanpa petunjuk apa pun. Di 768 ada kartu yang terpotong sebagai petunjuk; referensi shop.com 1440 pakai tombol "›".
3. **Shelf di 320/200% (sedang):** `f9ad8c3bad0b98a7-home-320-text200-04/05/06.png`. Satu kartu memenuhi lebar layar, jadi tidak ada petunjuk scroll. Ada juga ruang kosong ~60–80px antara judul dan harga.
4. **Foto tile kategori kecil di 768 (minor):** `3520b8885dc9ebf5-categories-768-01.png`. Foto 64px di pojok bawah kanan meninggalkan bagian tengah lavender kosong, dan gambar merchant yang banyak teks jadi tidak terbaca.

**Yang sudah oke:** tidak ada sinyal template: tidak ada hero gelap, eyebrow pill, deretan kartu ikon, label monospace, panah di semua tombol, atau klaim tanpa sumber. Tidak ada yang terpotong atau overflow di lebar mana pun. Transfer dari referensi shop.com untuk search, PDP, cart, dan help kelihatan jelas dan elemen yang memang harus dikecualikan tetap tidak ada (rating, badge, Buy now, Save/Share).

**Bukti yang kurang:** referensi home yang diberikan cuma capture 2026-10-22, dan shelf di situ masih skeleton (belum termuat). File `2026-10-23-home-*-full.png` yang dirujuk peta section round 16 tidak ada di daftar gambar. Jadi ukuran tile kategori dan kepadatan shelf belum bisa dibandingkan dengan referensi yang benar-benar saya lihat. Tampilan option pill untuk produk multi-opsi masih UNVERIFIED karena datanya belum ada.

Most important change: on phones, stack each category tile's name above its photo (or go 1-up) so department names stop breaking into 3–4 narrow lines with orphaned "&", and give the 1440 shelves a visible scroll cue.
Verdict: REVISE