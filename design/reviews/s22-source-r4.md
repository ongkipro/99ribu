Warning: claude.ai MCP servers blocked by enterprise policy: claude.ai Zapier, claude.ai Descript, claude.ai KOL Kelola, claude.ai Hugging Face, claude.ai ClickUp, claude.ai Google Calendar
Paduka Ongki, verdict complete current engineering preflight S22/T33/PR17 (source-r4): **CHANGES REQUIRED**, karena ada satu P2 yang terverifikasi. Ini preflight source baca-saja: bukan verdict visual, bukan design-gate, bukan approval final-union, SQL, atau S22.

**Fingerprint (saya hitung ulang sendiri)**
- SHA256 dan bytes cocok semua, di worktree maupun di snapshot r4: source 24/24, context 45/45, evidence 61/61. Tidak ada yang beda atau hilang.
- Ketiga digest cocok:
  - source `b844b6fa…74c1c`
  - context `6a4ae1b6…fac09`
  - evidence `a31bcbc3…a279fa9a`
- Dibanding r3, ada 11 file source yang berubah. Semua caller runtime di context byte-identik dengan r3.

**Cakupan**
- Ke-24 file source saya baca penuh: seluruh `globals.css`, ke-16 kasus browser purchase, filter-recovery, 4 file integration, dan registry `check-tests.ts` (25 kasus di 4 file).
- Saya juga baca wrapper discovery, halaman help (copy shipping/returns cocok kata per kata), semua caller Media/OfferPicker/CartMutations, laporan r3, lean-r4, review round10, dan tabel aksi cart di 17-UX.
- Caller runtime yang tidak berubah tidak saya baca ulang. Status coverage-nya: hash sama + sudah dibaca penuh di r3, bukan dibaca semantik lagi di ronde ini.

**P2-1: tombol "Setujui isi terbaru" bisa mengirim jumlah draft lama**
- **Lokasi:** `src/components/storefront/cart-forms.tsx:65`. Setelah ada error, form tetap membawa jumlah draft, padahal form persetujuan publikasi tidak punya input jumlah (`quantity={false}` di `cart/page.tsx:23`). Hidden field di `cart-forms.tsx:70` lalu mengirim draft itu.
- **Skenario gagal:**
  1. Keranjang dimuat dengan jumlah 1, lalu owner menerbitkan revisi baru.
  2. Buyer mengetik 2 dan menekan "Perbarui jumlah". Server menolak dengan `PUBLICATION_REVIEW_REQUIRED`, lalu halaman di-revalidate.
  3. Baris itu sekarang tampil "Persetujuan mempertahankan jumlah 1 pilihan", tanpa input jumlah, tapi hidden quantity-nya = 2.
  4. Buyer menekan "Setujui isi terbaru", dan jumlah diam-diam berubah jadi 2 (Rp198.000).
- **Kenapa test sekarang tidak menangkap:** test publikasi menerbitkan revisi sebelum keranjang dimuat, jadi jalur ini tidak pernah lewat.
- **Fix terkecil:** bawa draft hanya kalau form memang menampilkan input jumlah, yaitu `error&&quantity?{...base,quantity:own.intent.quantity}:base`. Replay exact untuk bootstrap/unknown tetap sama.
- **Check yang perlu ditinggalkan:** muat `/cart` sebelum `publishProduct`, kirim draft 2, lalu setujui. Assert jumlah tetap 1 dan publication_id sudah yang baru.

**Sudah saya cek, aman (tidak ada P1/P2 lain)**
- **Harga:** 20/28 di mobile dan 24/32 di layar lebar, tanpa token ukuran baru.
- **Pilihan opsi:** radio GET native tanpa navigasi otomatis, dan identitas pilihan untuk keranjang tetap eksplisit.
- **Spesifikasi:** atribut opsi menimpa fakta produk dengan key yang sama. Spesifikasi dan kebijakan yang belum ada ditulis eksplisit.
- **Feedback:** pesan global hanya untuk success/bootstrap/unknown atau baris yang hilang. Error yang dikenal tetap di field-nya.
- **Retry unknown:** pakai intent dan key yang persis sama, jumlah readonly.
- **Pending:** lokal per form, dan draft di baris lain tetap bertahan.
- **Keranjang closed/expired:** input readonly, salinan quote dan "Checkout sedang disiapkan" disembunyikan, dan badge hanya muncul untuk keranjang open yang belum kedaluwarsa (pakai clock bisnis yang sama). Count di tablet tetap terlihat.
- **Keranjang kosong:** satu link pemulihan, tanpa Rp0.
- **Sesi ditolak:** aksi aman (muat ulang, lihat produk) ada sebelum tombol akhiri sesi.
- **Invariant otoritas:** `handleCheckout` tetap satu-satunya writer, fence origin/cookie/replay utuh, dan tidak ada credential di UI.
- **Catatan r3 #1** (`query.size`) sudah diperbaiki dan ada test-nya.

**Nonblocking**
- Ada dua CSS lama yang tidak berefek: `.offer-picker .button{flex}` (sudah dicatat di lean-r4) dan `.detail-layout>.photo-slot`. Hapus saja saat koreksi source berikutnya, tidak perlu rebuild khusus untuk ini.
- `.cart-feedback` memasang `role=alert` bersamaan dengan `aria-live=polite`. Ini cuma polish.
- Ruang lingkup S61 dan status S26/S27 masih sesuai deklarasi.

**Disclosure**
- Runtime Claude Code, model claude-opus-5-5. Provider dan reasoning tidak terekspos ke saya.
- Tidak ada scratch write di luar file laporan. Tidak ada edit repo, test, build, server, DB, network, atau gambar yang saya jalankan atau buka.
- Laporan lengkap ada di `/home/ongki/.claude/plans/perform-a-real-independent-happy-wozniak.md`.
CROSS_CLI_EXIT=0
