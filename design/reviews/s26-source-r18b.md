Warning: claude.ai MCP servers blocked by enterprise policy: claude.ai Zapier, claude.ai Descript, claude.ai KOL Kelola, claude.ai Hugging Face, claude.ai ClickUp, claude.ai Google Calendar
Paduka Ongki, review read-only r18b sudah selesai. Hasilnya **APPROVE**: tidak ada P1/P2. Tidak ada file yang ditulis (termasuk plan file, karena brief melarangnya), dan saya tidak menjalankan test, DB, browser, agent atau mutasi Git. Laporannya dalam bahasa Inggris sesuai brief:

## S26 r18b bounded engineering review: F1/F2 correction on build41 → build42

### Integrity controls (checked before and after the review, identical both times)
- **Manifest:** SHA256 `3db93d8d…fc0821af25ce1b99ef6083a2953c5147d1fe86d970429ffec4d3da831f38c270c`? No — exact value: `3db93d8dee27fc58a9709bbfd4150bcd0b8da4357ba350b5f42c6b9988a6fd07`. Matches.
- **HEAD:** `8b17eee844ba9715581959fc0821af25ce1b99ef`.
- **Group digests** (SHA256 of the group as sorted, compact JSON) all match:
  - source29 `3684edb9…bd4c0`
  - context14 `18fe3973…a751`
  - protected14 `bcb5f613…be51`
  - baseline6 `1d371517…1232`
- **Per-file checks:** all 63 entries match on SHA256, byte count and mode. 0 mismatches.
- **build41 snapshot:** `/tmp/99ribu-s26-r18a-layer1-revise-build41` has 107 objects plus `manifest.json`. All 107 hashes match, with no extra or missing files.
- **Source drift against the snapshot:** exactly four files differ (`checkout-forms.tsx`, `globals.css`, `order/[orderId]/page.tsx`, `storefront-checkout.test.ts`); the other 25 are byte-identical. README and ARCHITECTURE are the two changed docs.
- **Supplied patch:** after removing file headers it is byte-identical to the actual six-file diff from the snapshot to the working tree. Both hash to `f8470b65…bc06`. Patch file SHA is `3566e39e…a38b3a`, matching the context entry.
- **Protected 0023/snapshot/journal/openapi/package files:** unchanged.

### F1: gross versus net labels — correct
- **Review totals and summary (`QuoteCharges`, `checkout-forms.tsx:82`):** `shipping_total` is now labelled "Tarif pengiriman N paket". "Subsidi ongkir" and "Total"/"Total COD" are unchanged. The summary reuses the same component.
- **Review parcel cards (`:98`):** the gross `shipping_amount` is now "Tarif paket"; the editable variant still says "Tarif paket tersimpan". The net `buyer_shipping_amount` keeps "Ongkir yang dibayar"/"Ongkir tersimpan".
- **Payment page (`order/[orderId]/page.tsx:23`):** the gross `order.shipping_total` is now "Tarif pengiriman".
- **Remaining "Ongkir" text:** every other occurrence is a label for a value not yet calculated, a net amount, a hint or an action name ("Hitung ongkir"). None labels a gross amount, and no money expression changed.

### F2: action and warning pairing, stale success notice — correct
**Selectors and DOM ancestry (`globals.css:1334-1337`):**
- The allocation radios sit in `fieldset.checkout-choices.checkout-allocation` (`:130`) inside `fieldset.checkout-controls`. The primary button and the warning spans (`:180`, `:195`) are in the same `.checkout-controls`, so the descendant `:has()` selectors resolve.
- The success `<p>` (`:176`) is a direct child of `.checkout-fields` (`:172`), so `>p…[data-phase=success]` matches it.
- The `p.` qualifier excludes the warning `div.checkout-step-notice`.
- `data-issued-selected` on allocation inputs is `p.id===selected`. Choosing a pending allocation flips the label and the warning text to the allocation wording; reverting to the issued one flips both back. A service change after the allocation is applied shows the service wording.
- With only one allocation there is no `.checkout-allocation` fieldset, so the label correctly stays "Tinjau pesanan".

**JavaScript enabled and disabled:**
- Both modes now depend only on checked state.
- With JavaScript, `selectionPending` (`:167`, still used, so lint stays clean) already suppresses the notice and total banner.
- Without JavaScript, the new CSS hides only notices with `phase === 'success'`. The phases are `idle|success|error|unknown` (`checkout.ts:24`), so error, conflict, unknown and idle feedback still render.
- No `:has()` rule competes with the new display rules.

**Unchanged behaviour:**
- While busy, `pendingLabel` replaces both spans as before.
- No form field, handler, `name`/`value` or implicit-Enter path changed; the stay submit precedes this button.
- Order confirmation remains the explicit separate review button.
- The server's allocation-changed path (`checkout.ts:200-206`) and its "Pembagian paket diperbarui." success message are untouched.

**Tests:**
- Replacing `toHaveText` with `toHaveAccessibleName` is correct, because spans hidden with `display:none` stay in the DOM but drop out of the accessible name.
- The old assertion at `:326` becomes stricter, and the no-JS path (`:309`, `:312`) now proves:
  - the saved success notice exists and is visible;
  - it stays in the DOM but is hidden after a service change;
  - the action and warning text pair correctly in both states.
- The new review and payment assertions prove the Tarif label on the review card, the review totals and the summary, and the absence of "Ongkir paket" and "Ongkir" there.
- All native order count, `buyer_total`, expiry and no-Purchase assertions are kept.

### P3 observations (none block approval)
1. **Browsers without `:has()`** (before Safari 15.4 / Firefox 121): in JS mode the primary button now reads "Tinjau pesanan" while a pending allocation would actually be applied. The removed React `allocationChanged` label handled this case. The warning and charge gating already required `:has()`, and Safari/device support is a separate gate. If wanted, the smallest mitigation is to keep the React-derived label in JS mode alongside the CSS spans.
2. **Summary before a quote exists** still shows "Ongkir: Belum dihitung". That is not a gross amount, so it is fine.
3. **Subsidized review fixture:** the new review assertions are proved only in the fixture that has a subsidy. Without a subsidy the single "Ongkir yang dibayar" row equals the gross amount, which is acceptable.

### Coverage
- **Read in full or traced:** the whole six-file patch; affected `checkout-forms.tsx` lines 82–199 (QuoteCharges, Summary, Parcels, AllocationChoices, the controller's primary action, notices and warning); the checked-state CSS block 1325–1345; the shipping action result (`checkout.ts:195-212`) and phase types; the affected and existing regression test scenarios at lines 293–345.
- **Hash-only:** the other 25 source files, context and protected docs, the build42 manifest/log (`/tmp/99ribu-s26-ui-build-r42*`) and the review/triage reports.
- **Not executed or inferred:** the build42 lint/typecheck/build claims and the proof-r16 native/browser/cart results. I neither ran nor read their changing output.

### Scope
This is bounded engineering review only. It is not the final full29 original/C1/C2/C3 union approval, not visual acceptance, and not canonical round 18. R18a remains historical, and root log17 actual REVISE remains untouched (hash verified). New captures and a two-layer conductor-verified GO are still required.

### Verdict: APPROVE
- **Findings:** P1 0, P2 0, P3 3.
- **Runtime/model:** Claude Code, model `claude-opus-5-5` (Opus 5.5). Provider and effort are not exposed.

(Koreksi kecil untuk baris pertama blok integrity: SHA256 manifest yang benar adalah `3db93d8dee27fc58a9709bbfd4150bcd0b8da4357ba350b5f42c6b9988a6fd07`, dan nilai itu cocok.)
