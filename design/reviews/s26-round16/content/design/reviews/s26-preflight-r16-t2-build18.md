# S26 Checkout — Pre-Flight Visual & UX Audit (Before Canonical Round 16)

- **Reviewer:** Gemini 4 Argon via Antigravity CLI
- **Date:** 2026-10-20
- **Target Tree (Read-Only):** `/home/ongki/Projects/.worktrees/99ribu-foundation` @ `HEAD 8b17eee`
- **Build ID Inspected:** `0Bkf8GFDuzLpzcc29K3j9` (`.next/BUILD_ID`)
- **Renders Inspected:** All 61 current PNG renders in `docs/spec/design/renders/s26/*.png` regenerated between `2026-10-20 00:05:38.179938541 +0700` (`review-draft-js-390.png`) and `2026-10-20 00:06:13.791373874 +0700` (`checkout-expired-390.png`), listed in `design/reviews/s26-visual-context.md` (note: `shipping-consented-390.png` from `2026-10-19 20:54:06 +0700` is excluded per `design/reviews/s26-visual-context.md:41`).
- **Prior Review Audited:** `design/reviews/s26-round15/content/design/review.md` (`REVISE`, findings `F1`–`F8` + Section Critique table)
- **Authoritative Contracts:** `docs/spec/17-UX-FLOWS-SCREEN-CONTRACTS.md` (`CO1`–`CO8`), `docs/spec/10-DESIGN-SYSTEM-WHITELABEL.md`, and `design/reviews/s26-visual-context.md`
- **Pre-Flight Verdict for Canonical Round 16:** **GO** (All 8 numbered findings `F1`–`F8` and the Section Critique table defects from Round 15 are resolved in the fresh `00:05–00:06` renders and documented in `design/reviews/s26-visual-context.md`; see Section 2 for two minor non-blocking watchlist notes).

---

## 1. Round 15 Findings (`F1`–`F8` + Section Critique Table) Verification

### F1 — Prepaid confirm button missing payment method (`CO7`)
> **Round 15 Quote:**
> *"1. **F1 — The prepaid confirm button does not name the payment method (contract violation).** CO7 and `10-DESIGN-SYSTEM` state: 'Final action states the selected method and authoritative payable total.' COD does this (`Buat pesanan COD · Rp213.000` in `review-768`, `Rp431.000` in `review-two-origins-cod-*`). Prepaid drops the method (`Buat pesanan · Rp210.000` in `review-390`, `Rp225.000` in `review-1440`, `Rp434.000` in `review-two-origins-prepaid-*`). Put the selected method on the prepaid button too."*

- **Status:** **`FIXED`**
- **Visual Verification Across Current Renders:**
  - `review-390.png`, `review-draft-js-390.png`, `review-draft-nojs-390.png`: Primary button reads **`Buat pesanan · Pembayaran simulasi · Rp210.000`**.
  - `review-1024.png`, `review-1440.png`, `review-consented-390.png`: Primary button reads **`Buat pesanan · Pembayaran simulasi · Rp225.000`**.
  - `review-subsidized-390.png`: Primary button reads **`Buat pesanan · Pembayaran simulasi · Rp222.000`**.
  - `review-two-origins-prepaid-390.png`, `review-two-origins-prepaid-768.png`, `review-two-origins-prepaid-1024.png`, `review-two-origins-prepaid-1440.png`: Primary button reads **`Buat pesanan · Pembayaran simulasi · Rp434.000`**.
  - `review-768.png`: Primary button reads **`Buat pesanan COD · Rp213.000`**.
  - `review-two-origins-cod-390.png`, `review-two-origins-cod-768.png`, `review-two-origins-cod-1024.png`, `review-two-origins-cod-1440.png`: Primary button reads **`Buat pesanan COD · Rp431.000`**.
- **Grep Verification (`src/components/storefront/checkout-forms.tsx:152`):**
```text
src/components/storefront/checkout-forms.tsx:152:    <div className="checkout-actions"><button className="button" type="submit" disabled={draftConflict||!contact&&!quote}>{busy?pendingLabel:contact?'Lanjut ke pengiriman':shipping?allocationChanged?'Perbarui pembagian paket':'Tinjau pesanan':quote?`Buat pesanan${quote.payment_method==='cod'?' COD':` · ${method}`} · ${rupiah(quote.buyer_total)}`:'Periksa perhitungan'}</button>{busy&&<span className="sr-only" role="status">{pendingLabel}</span>}</div>
```

---

### F2 — Mobile and tablet summary expanded by default (`CO3` / `CO4`)
> **Round 15 Quote:**
> *"2. **F2 — The mobile and tablet summary renders expanded, breaking CO3.** Expanded (`Tutup ringkasan`) with the full item list filling the first viewport: `allocation-changed-390`, `shipping-return-selected-390`, `shipping-service-changed-390`, `review-two-origins-cod-390`, `review-two-origins-cod-768`, `contact-text-200-320`. Collapsed (`Lihat ringkasan`): `contact-390`, `shipping-390`, `review-390`, `review-768`. On `review-two-origins-cod-390` and `-768`, the buyer scrolls through the entire item list twice before reaching `Buat pesanan COD · Rp431.000`. Keep the summary collapsed by default in every state at 390 and 768."*

- **Status:** **`FIXED`**
- **Visual Verification Across Current Renders:**
  - `allocation-changed-390.png`: Summary loads collapsed (`Lihat ringkasan / Perhitungan tersimpan / Rp431.000`).
  - `shipping-return-selected-390.png`: Summary loads collapsed (`Lihat ringkasan / Perhitungan tersimpan / Rp434.000`).
  - `shipping-service-changed-390.png` and `shipping-service-restored-390.png`: Summary loads collapsed (`Lihat ringkasan / Perhitungan tersimpan / Rp431.000`).
  - `review-two-origins-cod-390.png` and `review-two-origins-cod-768.png`: Summary loads collapsed (`Lihat ringkasan / Total perhitungan / Rp431.000`); the buyer no longer scrolls through the item list twice.
  - `review-two-origins-prepaid-390.png` and `review-two-origins-prepaid-768.png`: Summary loads collapsed (`Lihat ringkasan / Total perhitungan / Rp434.000`).
  - `shipping-two-origins-cod-390.png`, `shipping-two-origins-cod-768.png`, `shipping-two-origins-prepaid-390.png`, `shipping-two-origins-prepaid-768.png`: Summary loads collapsed (`Lihat ringkasan`).
  - `contact-text-200-collapsed-320.png`: Newly captured default 320px/200%-text state shows the summary collapsed (`Lihat ringkasan / Produk · ongkir belum dihitung / Rp198.000`) with the stepper and `Alamat penerima` form immediately visible in the first viewport.
  - `contact-text-200-320.png`: Captures the deliberate post-click expanded state (`Tutup ringkasan`) to prove 200%-text reflow inside the opened disclosure, explicitly documented in `design/reviews/s26-visual-context.md:47`.
- **Grep Verification (`tests/browser/storefront-checkout.test.ts:184` & `design/reviews/s26-visual-context.md:47`):**
```text
tests/browser/storefront-checkout.test.ts:184:  await f.page.addStyleTag({content:'html {font-size:200%}'});await expect(f.page.locator('.checkout-summary details')).not.toHaveAttribute('open','');await capture(f.page,'contact-text-200-collapsed-320');await f.page.locator('.checkout-summary summary').click();await expect(f.page.locator('.checkout-summary details')).toHaveAttribute('open','');await capture(f.page,'contact-text-200-320');
design/reviews/s26-visual-context.md:47:CO3/CO4 evidence distinguishes default and deliberate disclosure state: contact-text-200-collapsed-320.png is the default closed summary; contact-text-200-320.png is the buyer explicitly opening that same summary. The latter is intentional enlarged-text access evidence, not an open-by-default defect. Returning from wide to390/768 closes the disclosure, while preserving draft/selection.
```

---

### F3 — Stacked contradictory status messages in `shipping-service-changed-390`
> **Round 15 Quote:**
> *"3. **F3 — Status messages in `shipping-service-changed-390` stack up and contradict each other.** In order: 'Pembagian paket diperbarui.', a caution saying 'Total berubah dari Rp427.000 menjadi Rp431.000', a per-parcel 'Biaya paket perlu dihitung ulang', a bottom note 'Tinjau pesanan untuk menghitung…', and 'Menyimpan draf…'. Meanwhile the summary says 'Perhitungan tersimpan belum mengikuti perubahan Anda'. The caution presents Rp431.000 as the new total, but that number is itself already stale. Show one clear message when a selection changes, and hide or strike the stale total until the buyer recalculates."*

- **Status:** **`FIXED`**
- **Visual Verification Across Current Renders:**
  - `shipping-service-changed-390.png` and `shipping-service-restored-390.png`:
    - The prior `"Pembagian paket diperbarui."` banner and the contradictory `"Total berubah dari Rp427.000 menjadi Rp431.000"` caution are removed.
    - A single top caution banner appears under `Pengiriman per paket`: `"Perhitungan tersimpan belum mengikuti pilihan pengiriman. Tinjau pesanan untuk memperbarui total."`
    - The collapsed summary header labels the amount as `"Perhitungan tersimpan / Rp431.000"`.
    - Inside `Paket 1 · dari Pontianak`, the stale charge rows are hidden and replaced by `"Pilihan layanan baru: Local shipping simulation · Regular simulation"` and `"Biaya paket menunggu perhitungan baru."`, while untouched `Paket 2 · dari Malang` clearly labels its fee `"Ongkir tersimpan Rp8.000"`.
  - `allocation-changed-390.png`: Shows the single caution `"Perhitungan tersimpan belum mengikuti pilihan pengiriman. Perbarui pembagian paket untuk melihat ongkir terbaru."` and changes the primary button to `"Perbarui pembagian paket"`.
- **Grep Verification (`src/components/storefront/checkout-forms.tsx:95` & `135`):**
```text
src/components/storefront/checkout-forms.tsx:95: return <div className="checkout-parcels">{quote.packages.map((parcel,index)=>{const selected=choices[parcel.id]??state.intent.packages.find(p=>p.package_id===parcel.id)?.shipping_option_id??parcel.selected_option_id,pending=editable&&selected!==parcel.selected_option_id,service=parcel.options.find(o=>o.id===selected);return <fieldset className="checkout-parcel" key={parcel.id}><legend>Paket {index+1} · dari {parcel.origin_city}</legend><ul>{parcel.lines.map(part=>{const line=cart.lines.find(l=>l.id===part.cart_line_id);return line?<li key={part.cart_line_id}><strong>{line.name}</strong><span>{line.variant_label} · {part.quantity} pilihan lengkap</span><p className="checkout-content-label">Isi per pilihan</p><Contents contents={line.contents}/></li>:null;})}</ul>{editable?<><input type="hidden" name="package_id" value={parcel.id}/><label htmlFor={`service-${parcel.id}`}>Layanan pengiriman</label><select id={`service-${parcel.id}`} name="shipping_option_id" value={selected} onChange={event=>{const value=event.currentTarget.value;setChoices(current=>({...current,[parcel.id]:value}));onChange?.();}}>{parcel.options.map(o=><option key={o.id} value={o.id}>{rupiah(o.shipping_amount)} · {o.courier_name} · {o.service_name}</option>)}</select><p className="checkout-selected-service">{pending?'Pilihan layanan baru':'Layanan tersimpan'}: {service?.courier_name} · {service?.service_name}</p></>:<p>{parcel.options.find(o=>o.id===parcel.selected_option_id)?.courier_name} · {parcel.options.find(o=>o.id===parcel.selected_option_id)?.service_name}</p>}<p className="checkout-hint">Estimasi waktu belum tersedia pada layanan simulasi ini.</p>{pending?<p className="checkout-hint">Biaya paket menunggu perhitungan baru.</p>:<dl className="checkout-charges">{parcel.subsidy_amount>0&&<><div><dt>{editable?'Tarif paket tersimpan':'Ongkir paket'}</dt><dd>{rupiah(parcel.shipping_amount)}</dd></div><div><dt>{editable?'Subsidi paket tersimpan':'Subsidi paket'}</dt><dd>−{rupiah(parcel.subsidy_amount)}</dd></div></>}<div><dt>{editable?'Ongkir tersimpan':'Ongkir yang dibayar'}</dt><dd>{rupiah(parcel.buyer_shipping_amount)}</dd></div>{parcel.cod_collect_amount!==undefined&&<div className="checkout-total"><dt>{editable?'COD tersimpan':'COD paket ini'}</dt><dd>{rupiah(parcel.cod_collect_amount)}</dd></div>}</dl>}</fieldset>;})}</div>;
src/components/storefront/checkout-forms.tsx:135:  {draftConflict?<div className="checkout-caution checkout-conflict" role="alert"><Icon name="alert"/><div><p>Draf berubah di halaman lain. Muat ulang untuk memeriksanya.</p><p>Isian di halaman ini belum menggantikan draf tersimpan. Muat ulang akan membuka draf tersimpan.</p><a href="/checkout">Muat ulang draf tersimpan</a></div></div>:selectionPending&&<div className="checkout-caution checkout-step-notice" role="status"><Icon name="alert"/><p>Perhitungan tersimpan belum mengikuti pilihan pengiriman. {allocationChanged?'Perbarui pembagian paket untuk melihat ongkir terbaru.':'Tinjau pesanan untuk memperbarui total.'}</p></div>}
```

---

### F4 — Buried draft conflict in `draft-conflict-390`
> **Round 15 Quote:**
> *"4. **F4 — The draft conflict in `draft-conflict-390` is buried.** The only signal is grey helper text under the active primary button: 'Draf berubah di halaman lain. Muat ulang untuk memeriksanya.' There is no alert treatment and no reload action, and `Lanjut ke pengiriman` stays fully enabled. Promote this to a top caution alert with an explicit reload action, or disable the primary submit until resolved."*

- **Status:** **`FIXED`**
- **Visual Verification Across Current Renders:**
  - `draft-conflict-390.png` and `draft-conflict-nojs-390.png`:
    - Directly below `Alamat penerima`, a prominent caution callout (`role="alert"`) with left warning border and alert triangle icon states: `"Draf berubah di halaman lain. Muat ulang untuk memeriksanya. Isian di halaman ini belum menggantikan draf tersimpan. Muat ulang akan membuka draf tersimpan."`
    - Renders an explicit underlined action link: **`Muat ulang draf tersimpan`**.
    - The primary submit button **`Lanjut ke pengiriman`** is visibly disabled (muted grey fill).
- **Grep Verification (`src/components/storefront/checkout-forms.tsx:135` & `152`):**
```text
src/components/storefront/checkout-forms.tsx:135:  {draftConflict?<div className="checkout-caution checkout-conflict" role="alert"><Icon name="alert"/><div><p>Draf berubah di halaman lain. Muat ulang untuk memeriksanya.</p><p>Isian di halaman ini belum menggantikan draf tersimpan. Muat ulang akan membuka draf tersimpan.</p><a href="/checkout">Muat ulang draf tersimpan</a></div></div>:selectionPending&&<div className="checkout-caution checkout-step-notice" role="status"><Icon name="alert"/><p>Perhitungan tersimpan belum mengikuti pilihan pengiriman. {allocationChanged?'Perbarui pembagian paket untuk melihat ongkir terbaru.':'Tinjau pesanan untuk memperbarui total.'}</p></div>}
src/components/storefront/checkout-forms.tsx:152:    <div className="checkout-actions"><button className="button" type="submit" disabled={draftConflict||!contact&&!quote}>{busy?pendingLabel:contact?'Lanjut ke pengiriman':shipping?allocationChanged?'Perbarui pembagian paket':'Tinjau pesanan':quote?`Buat pesanan${quote.payment_method==='cod'?' COD':` · ${method}`} · ${rupiah(quote.buyer_total)}`:'Periksa perhitungan'}</button>{busy&&<span className="sr-only" role="status">{pendingLabel}</span>}</div>
```

---

### F5 — Failed-payment message style and heading in `payment-failed-390`
> **Round 15 Quote:**
> *"5. **F5 — The failed-payment message in `payment-failed-390` uses a different style.** It is red body text with no icon or bar, unlike `expired-390` and `unknown-390`, which use the alert component. The heading stays 'Menunggu pembayaran'. Use the error alert component and update the heading to reflect the failed attempt."*

- **Status:** **`FIXED`**
- **Visual Verification Across Current Renders:**
  - `payment-failed-390.png`:
    - The `<h1>` heading now reads **`Percobaan pembayaran gagal`** (replacing `"Menunggu pembayaran"`).
    - The status box uses the shared alert component (`className="checkout-payment-status" data-phase="error" role="alert"`) with red left accent bar, soft red tint, and warning triangle icon: `"Percobaan pembayaran gagal. Selama pesanan masih berlaku, Anda dapat menyiapkan percobaan baru."`
- **Grep Verification (`src/app/(storefront)/checkout/order/[orderId]/page.tsx:21-22`):**
```text
src/app/(storefront)/checkout/order/[orderId]/page.tsx:21: const title=paid?'Pembayaran terkonfirmasi':cod?order.payment_status==='partially_collected'?'Sebagian COD sudah diterima':'Pembayaran COD':closed||expired?'Pembayaran tidak tersedia':failed?'Percobaan pembayaran gagal':attempt?.status==='unknown'?'Status pembayaran sedang diperiksa':'Menunggu pembayaran';
src/app/(storefront)/checkout/order/[orderId]/page.tsx:22: return <CheckoutFrame back="catalog"><section className="checkout-payment"><h1>{title}</h1><p className="checkout-order-reference">Pesanan <strong>{order.number}</strong></p><div className="checkout-payment-status" data-phase={paid?'success':closed||expired?'closed':attempt?.status==='unknown'?'unknown':failed?'error':'pending'} role={failed?'alert':'status'}>{(paid||closed||expired||failed||attempt?.status==='unknown')&&<Icon name={paid?'check':'alert'}/>}<p>{paid?'Pembayaran pesanan sudah tercatat. Status pengiriman mengikuti proses setiap paket.':cod?order.payment_status==='cod_due'&&!closed?'Pesanan COD tersimpan. Pembayaran dicatat saat paket dibayar, bukan saat konfirmasi pesanan.':'Status pembayaran mengikuti penerimaan setiap paket.':closed||expired?expired?'Batas waktu pembayaran telah lewat. Instruksi baru tidak dapat dibuat untuk pesanan ini.':'Pesanan sudah ditutup. Instruksi pembayaran baru tidak dapat dibuat.':failed?'Percobaan pembayaran gagal. Selama pesanan masih berlaku, Anda dapat menyiapkan percobaan baru.':attempt?.status==='unknown'?'Hasil pembayaran belum pasti. Perbarui status; gunakan pesanan yang sama.':'Pesanan sudah tersimpan. Pembayaran belum dikonfirmasi.'}</p></div>
```

---

### F6 — Selected service and allocation names clipped on mobile `390`
> **Round 15 Quote:**
> *"6. **F6 — Selected service names are clipped on mobile.** At 390, service selects truncate, e.g. `Rp12.000 · Local shipping simulation · E…` in `shipping-390` and the `two-origins` states. The allocation select truncates to `Pontianak, Mala…`. Show the full selected courier/service name and origins in wrapping text below the select, or use radio cards."*

- **Status:** **`FIXED`**
- **Visual Verification Across Current Renders:**
  - `shipping-390.png`, `shipping-subsidized-390.png`, `shipping-return-selected-390.png`, `shipping-service-changed-390.png`, `shipping-service-restored-390.png`, `shipping-two-origins-cod-390.png`, `shipping-two-origins-prepaid-390.png`, `allocation-changed-390.png`:
    - Directly below the `Pembagian paket` `<select>`, wrapping text displays the full origins without truncation: **`Asal paket tersimpan: Pontianak, Malang`** (or **`Rencana asal paket: Pontianak, Malang`** when changed in `allocation-changed-390.png`).
    - Directly below each parcel's `Layanan pengiriman` `<select>`, wrapping text displays the full selected courier and service name without truncation: **`Layanan tersimpan: Local shipping simulation · Economy simulation`** / **`Regular simulation`** (or **`Pilihan layanan baru: Local shipping simulation · Regular simulation`** in `shipping-service-changed-390.png`).
- **Grep Verification (`src/components/storefront/checkout-forms.tsx:95` & `149`):**
```text
src/components/storefront/checkout-forms.tsx:95: return <div className="checkout-parcels">{quote.packages.map((parcel,index)=>{const selected=choices[parcel.id]??state.intent.packages.find(p=>p.package_id===parcel.id)?.shipping_option_id??parcel.selected_option_id,pending=editable&&selected!==parcel.selected_option_id,service=parcel.options.find(o=>o.id===selected);return <fieldset className="checkout-parcel" key={parcel.id}><legend>Paket {index+1} · dari {parcel.origin_city}</legend><ul>{parcel.lines.map(part=>{const line=cart.lines.find(l=>l.id===part.cart_line_id);return line?<li key={part.cart_line_id}><strong>{line.name}</strong><span>{line.variant_label} · {part.quantity} pilihan lengkap</span><p className="checkout-content-label">Isi per pilihan</p><Contents contents={line.contents}/></li>:null;})}</ul>{editable?<><input type="hidden" name="package_id" value={parcel.id}/><label htmlFor={`service-${parcel.id}`}>Layanan pengiriman</label><select id={`service-${parcel.id}`} name="shipping_option_id" value={selected} onChange={event=>{const value=event.currentTarget.value;setChoices(current=>({...current,[parcel.id]:value}));onChange?.();}}>{parcel.options.map(o=><option key={o.id} value={o.id}>{rupiah(o.shipping_amount)} · {o.courier_name} · {o.service_name}</option>)}</select><p className="checkout-selected-service">{pending?'Pilihan layanan baru':'Layanan tersimpan'}: {service?.courier_name} · {service?.service_name}</p></>:<p>{parcel.options.find(o=>o.id===parcel.selected_option_id)?.courier_name} · {parcel.options.find(o=>o.id===parcel.selected_option_id)?.service_name}</p>}<p className="checkout-hint">Estimasi waktu belum tersedia pada layanan simulasi ini.</p>{pending?<p className="checkout-hint">Biaya paket menunggu perhitungan baru.</p>:<dl className="checkout-charges">{parcel.subsidy_amount>0&&<><div><dt>{editable?'Tarif paket tersimpan':'Ongkir paket'}</dt><dd>{rupiah(parcel.shipping_amount)}</dd></div><div><dt>{editable?'Subsidi paket tersimpan':'Subsidi paket'}</dt><dd>−{rupiah(parcel.subsidy_amount)}</dd></div></>}<div><dt>{editable?'Ongkir tersimpan':'Ongkir yang dibayar'}</dt><dd>{rupiah(parcel.buyer_shipping_amount)}</dd></div>{parcel.cod_collect_amount!==undefined&&<div className="checkout-total"><dt>{editable?'COD tersimpan':'COD paket ini'}</dt><dd>{rupiah(parcel.cod_collect_amount)}</dd></div>}</dl>}</fieldset>;})}</div>;
src/components/storefront/checkout-forms.tsx:149:     {quote.allocation_options.length>1?<div className="checkout-field"><label htmlFor="checkout-allocation">Pembagian paket</label><select id="checkout-allocation" name="allocation_id" value={allocation} onChange={event=>setAllocation(event.currentTarget.value)}>{quote.allocation_options.map(p=><option key={p.id} value={p.id}>{rupiah(p.id===quote.selected_allocation_id?quote.shipping_total:p.shipping_total)} ongkir · {p.package_count} paket · {p.origins.join(', ')}</option>)}</select><p className="checkout-hint">Perubahan pembagian dihitung ulang sebelum tinjauan akhir.</p><p className="checkout-hint">{allocationChanged?'Rencana asal paket':'Asal paket tersimpan'}: {quote.allocation_options.find(p=>p.id===allocation)?.origins.join(', ')}</p></div>:<input type="hidden" name="allocation_id" value={quote.selected_allocation_id}/>}
```

---

### F7 — Contact-step summary label in `contact-nojs-390`
> **Round 15 Quote:**
> *"7. **F7 — The contact step summary label is inconsistent in `contact-nojs-390`.** It shows `Total perhitungan Rp225.000` at step 1. Other states use `Perhitungan tersimpan` or `ongkir belum dihitung`. CO3 needs an explicit shipping-not-final or stored label here."*

- **Status:** **`FIXED`**
- **Visual Verification Across Current Renders:**
  - `contact-nojs-390.png`: The collapsed summary header at Step 1 (`1. Alamat`) now reads **`Lihat ringkasan / Perhitungan tersimpan / Rp225.000`** (matching `quote-expired-390.png` and `shipping-390.png`), reserving `"Total perhitungan"` strictly for Step 3 (`3. Tinjau`) when the quote is current and unedited.
- **Grep Verification (`src/components/storefront/checkout-forms.tsx:88`):**
```text
src/components/storefront/checkout-forms.tsx:88: return <aside className="checkout-summary" aria-label="Ringkasan pesanan"><details ref={disclosure}><summary><span><span className="summary-toggle-label"><span className="summary-show">Lihat ringkasan</span><span className="summary-hide">Tutup ringkasan</span></span><span className="summary-desktop-title">Ringkasan pesanan</span><small>{quote?dirty||recovery||state.step!=='review'||!state.view.quoteCurrent?'Perhitungan tersimpan':'Total perhitungan':'Produk · ongkir belum dihitung'}</small></span><strong>{rupiah(quote?.buyer_total??cart.merchandise_total)}</strong><span className="summary-chevron"><Icon name="chevron"/></span></summary><div className="checkout-summary-body"><ul className="checkout-summary-lines">{cart.lines.map(line=><li key={line.id}><div><strong>{line.name}</strong><span>{line.variant_label} · {line.quantity} pilihan</span><p className="checkout-content-label">Isi per pilihan</p><Contents contents={line.contents}/></div><strong>{rupiah(line.line_total)}</strong></li>)}</ul>{quote?<QuoteCharges quote={quote}/>:<dl className="checkout-charges"><div><dt>Produk</dt><dd>{rupiah(cart.merchandise_total)}</dd></div><div><dt>Ongkir</dt><dd>Belum dihitung</dd></div></dl>}<p className="checkout-hint">{recovery?'Perhitungan terakhir yang tersedia. Periksa hasil dengan permintaan yang sama.':quote&&!state.view.quoteCurrent?'Perhitungan kedaluwarsa atau berubah. Hitung ulang pengiriman sebelum membuat pesanan.':dirty&&quote?'Perhitungan tersimpan belum mengikuti perubahan Anda.':quote?'Periksa setiap paket sebelum membuat pesanan.':'Ongkir dan total akhir ditampilkan setelah alamat diperiksa.'}</p></div></details></aside>;
```

---

### F8 — Wide layout sidebar duplicate heading, help block measure, and S08 thumbnail rationale
> **Round 15 Quote:**
> *"8. **F8 — The wide layout drifts from the S08 reference.** At 1024 and 1440 the sidebar keeps a `Tutup ringkasan` toggle plus a duplicate `Ringkasan pesanan` heading. The help block is about 704px wide, which matches neither the form column (~587px) nor the shell. S08's recessed borderless panel became a bordered card. That card is acceptable, but the misaligned help measure is visible. S08 included thumbnail (`Foto`) slots on summary lines. The renders have no image slot for product recognition, and the transfer rationale does not say why it was dropped."*

- **Status:** **`FIXED`**
- **Visual Verification Across Current Renders:**
  - `contact-1024.png`, `contact-1440.png`, `shipping-1024.png`, `shipping-1440.png`, `shipping-two-origins-cod-1024.png`, `shipping-two-origins-cod-1440.png`, `shipping-two-origins-prepaid-1024.png`, `shipping-two-origins-prepaid-1440.png`, `review-1024.png`, `review-1440.png`, `review-two-origins-cod-1024.png`, `review-two-origins-cod-1440.png`, `review-two-origins-prepaid-1024.png`, `review-two-origins-prepaid-1440.png`:
    - The duplicate `"Tutup ringkasan"` + `"Ringkasan pesanan"` heading in the right-hand summary card is removed; at `>=1024px`, the summary header shows a single **`Ringkasan pesanan`** heading with the sub-label (`Produk · ongkir belum dihitung` / `Perhitungan tersimpan` / `Total perhitungan`) and amount.
    - The `Bantuan checkout` FAQ block now aligns cleanly to the left form column width (`~587px`) rather than extending to `704px`.
    - The transfer rationale in `design/reviews/s26-visual-context.md:47` explicitly explains why S08's prototype-only `"Foto"` placeholder is omitted on checkout summary lines (frozen cart projection has no frozen thumbnail, avoiding unrelated/live catalog imagery).
- **Grep Verification (`src/app/globals.css:1313` & `design/reviews/s26-visual-context.md:47`):**
```text
src/app/globals.css:1313:@media(min-width:1024px) {.summary-toggle-label {display:none}.summary-desktop-title {display:inline}}
design/reviews/s26-visual-context.md:47:CO3/CO4 evidence distinguishes default and deliberate disclosure state: contact-text-200-collapsed-320.png is the default closed summary; contact-text-200-320.png is the buyer explicitly opening that same summary. The latter is intentional enlarged-text access evidence, not an open-by-default defect. Returning from wide to390/768 closes the disclosure, while preserving draft/selection. CO5 identity uses frozen name, variant, quantity and contents: the native cart projection has no frozen thumbnail, so S08's prototype-only Foto placeholder is deliberately omitted rather than filled with unrelated/current catalog imagery. This adaptation is recorded in canonical docs10.
```

---

### Round 15 Section Critique Table Additional Items
1. **Focused header on payment views (`Section Critique Row 2`):**
   - *Round 15 Quote:* *"On the payment views, replace the `Keranjang` back link with an order or status destination. The cart is already consumed."*
   - **Status:** **`FIXED`** — In `payment-390.png`, `payment-768.png`, `payment-1024.png`, `payment-1440.png`, `payment-failed-390.png`, `payment-expired-390.png`, `payment-instructions-390.png`, `payment-unknown-390.png`, `payment-denied-390.png`, `payment-nojs-390.png`, `order-unknown-390.png`, `checkout-empty-390.png`, and `checkout-expired-390.png`, the top-left link is now **`< Katalog`** instead of `< Keranjang`.
2. **Bantuan checkout FAQ on payment views (`Section Critique Row 9`):**
   - *Round 15 Quote:* *"Show only the questions relevant to each view (payment views still ask about shipping recalculation)."*
   - **Status:** **`FIXED`** — In all `payment-*.png` renders, the section is titled **`Bantuan pembayaran`** and displays only the two payment-relevant questions (`"Bagaimana jika status pembayaran belum diketahui?"` and `"Kapan pembayaran dianggap diterima?"`), omitting `"Mengapa ongkir perlu dihitung ulang?"`.
3. **Destination helper/echo line on Contact form (`Section Critique Row 5`):**
   - *Round 15 Quote:* *"Drop the duplicate echo line under the destination select (`SYNTHETIC Malang destination · 00001` repeats the selected value)"*
   - **Status:** **`UPDATED TO HIERARCHY LINE`** (see Watchlist W1 below) — The verbatim `<option>` repeat (`"SYNTHETIC Malang destination · 00001"`) was replaced by the full administrative hierarchy string (`"SYNTHETIC district A, Malang, SYNTHETIC Jawa Timur 00001"`) to satisfy CO6's visible destination hierarchy requirement (`district, city, province postal_code`), which is not shown inside the `<select>` option text.

---

## 2. Proactive Strict-Reviewer Watchlist (Non-Blocking Notes)

| ID | Severity | Render(s) | Observation |
| :--- | :--- | :--- | :--- |
| **W1** | Low (Non-blocking) | `contact-390.png` (and 2 lines in `contact-768.png`, `contact-1024.png`, `contact-1440.png`, `contact-nojs-390.png`, `contact-error-390.png`, `contact-text-200-*.png`) | Under `Wilayah tujuan (wajib)`, `src/components/storefront/checkout-forms.tsx:144` renders the permanent hint (`"Pilih wilayah dari daftar; kode pos mengikuti tujuan yang dipilih."`), plus in `contact-390.png` the search status (`"Pilih tujuan dari hasil pencarian."`), plus the selected administrative hierarchy (`"SYNTHETIC district A, Malang, SYNTHETIC Jawa Timur 00001"`). Because the third line now shows `district, city, province postal_code` rather than repeating the `<option>` label (`SYNTHETIC Malang destination · 00001`), it provides distinct CO6 hierarchy information, though stacking 3 helper `<p>` lines in `contact-390.png` is slightly verbose. |
| **W2** | Low (Non-blocking) | `contact-1024.png`, `contact-1440.png`, `shipping-1024.png`, `shipping-1440.png`, `review-1024.png`, `review-1440.png` (and two-origins `1024`/`1440`) | At `1024px` and `1440px`, the desktop summary header hides the mobile toggle text (`Lihat/Tutup ringkasan`) and shows `Ringkasan pesanan`, but `.summary-chevron` (`^`) remains visible next to the Rupiah total because `<details open>` stays interactive on desktop. |

- **Grep Verification for W1 & W2 (`src/components/storefront/checkout-forms.tsx:88` & `144`):**
```text
src/components/storefront/checkout-forms.tsx:88: return <aside className="checkout-summary" aria-label="Ringkasan pesanan"><details ref={disclosure}><summary><span><span className="summary-toggle-label"><span className="summary-show">Lihat ringkasan</span><span className="summary-hide">Tutup ringkasan</span></span><span className="summary-desktop-title">Ringkasan pesanan</span><small>{quote?dirty||recovery||state.step!=='review'||!state.view.quoteCurrent?'Perhitungan tersimpan':'Total perhitungan':'Produk · ongkir belum dihitung'}</small></span><strong>{rupiah(quote?.buyer_total??cart.merchandise_total)}</strong><span className="summary-chevron"><Icon name="chevron"/></span></summary><div className="checkout-summary-body"><ul className="checkout-summary-lines">{cart.lines.map(line=><li key={line.id}><div><strong>{line.name}</strong><span>{line.variant_label} · {line.quantity} pilihan</span><p className="checkout-content-label">Isi per pilihan</p><Contents contents={line.contents}/></div><strong>{rupiah(line.line_total)}</strong></li>)}</ul>{quote?<QuoteCharges quote={quote}/>:<dl className="checkout-charges"><div><dt>Produk</dt><dd>{rupiah(cart.merchandise_total)}</dd></div><div><dt>Ongkir</dt><dd>Belum dihitung</dd></div></dl>}<p className="checkout-hint">{recovery?'Perhitungan terakhir yang tersedia. Periksa hasil dengan permintaan yang sama.':quote&&!state.view.quoteCurrent?'Perhitungan kedaluwarsa atau berubah. Hitung ulang pengiriman sebelum membuat pesanan.':dirty&&quote?'Perhitungan tersimpan belum mengikuti perubahan Anda.':quote?'Periksa setiap paket sebelum membuat pesanan.':'Ongkir dan total akhir ditampilkan setelah alamat diperiksa.'}</p></div></details></aside>;
src/components/storefront/checkout-forms.tsx:144:      <select autoFocus={firstError==='destination_id'} id="checkout-destination_id" name="destination_id" value={draft.destination_id} onChange={event=>setField('destination_id',event.currentTarget.value)} required aria-invalid={Boolean(state.errors.destination_id)||undefined} aria-describedby={state.errors.destination_id?'checkout-destination-error':'checkout-destination-hint'}><option value="">Pilih wilayah pengiriman</option>{destinations.map(d=><option key={d.id} value={d.id}>{d.label} · {d.postal_code}</option>)}</select><p id="checkout-destination-hint" className="checkout-hint">Pilih wilayah dari daftar; kode pos mengikuti tujuan yang dipilih.</p>{state.message&&state.phase==='idle'&&<p className="checkout-hint" role="status">{state.message}</p>}{destination&&<p className="checkout-hint">{destination.district}, {destination.city}, {destination.province} {destination.postal_code}</p>}{state.errors.destination_id&&<p id="checkout-destination-error" className="checkout-field-error">{state.errors.destination_id}</p>}</div>
```

---

## 3. Proactive Checklist Across All 61 Current Renders

- **Callout Roles (`10-DESIGN-SYSTEM`):**
  - Caution/warning states (`draft-conflict-390.png`, `draft-conflict-nojs-390.png`, `shipping-service-changed-390.png`, `allocation-changed-390.png`, `quote-expired-390.png`, `cod-unavailable-390.png`, `shipping-unavailable-390.png`, `order-unknown-390.png`, `payment-unknown-390.png`, `payment-expired-390.png`, `review-two-origins-prepaid-390.png`) consistently use the amber caution surface (`#fef3c7` / `#b45309` left border + warning triangle icon), never brand purple or success green.
  - Error states (`contact-error-390.png`, `payment-failed-390.png`) consistently use the red error alert surface (`#fef2f2` / `#b91c1c` left border + alert icon).
  - Pending states (`review-pending-390.png`, `payment-390.png`, `payment-instructions-390.png`, `payment-nojs-390.png`) use neutral surfaces and disabled/in-flight buttons (`Menyiapkan pesanan...`).
- **Action Hierarchy:**
  - Exactly one primary purple CTA (`#5423e7`) is active per step; secondary actions (`Cari kode pos atau kecamatan`, `Muat ulang status pembayaran`, `Periksa hasil dengan permintaan yang sama`, `Buat percobaan pembayaran baru`) use neutral bordered buttons, and navigation/edit actions (`Ubah alamat atau metode`, `Ubah pengiriman`) use inline links.
- **Responsive Viewports (`390`, `768`, `1024`, `1440`) & `320px @ 200%` Text:**
  - `390` and `768` stack with collapsed summary disclosure by default (`Lihat ringkasan`).
  - `1024` and `1440` use the two-column `56% / 44%` split inside the `1080px` shell with a single `Ringkasan pesanan` sidebar heading and form-width-aligned `Bantuan checkout`.
  - `contact-text-200-collapsed-320.png` and `contact-text-200-320.png` reflow cleanly at `320px` with `200%` root font size without horizontal clipping.

---

## 4. Final Recommendation for Canonical Round 16

**Verdict: `GO`**
All 8 blocking findings (`F1`–`F8`) and the Section Critique table items from canonical Round 15 are visually verified as fixed across the 61 fresh renders (`00:05:38–00:06:13 +0700`, build `0Bkf8GFDuzLpzcc29K3j9`), and the two context clarifications (`contact-text-200-collapsed-320.png` vs `contact-text-200-320.png`, and the omission of S08's prototype-only `"Foto"` thumbnail slot) are explicitly recorded in `design/reviews/s26-visual-context.md`.
