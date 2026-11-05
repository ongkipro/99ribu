# Voucher market research — Indonesia (2026-11-05)

Input for S177 (`S177.md`). Sources are official seller/help pages unless marked; "(snippet)" = search-result text only; "unverified" = not confirmed on a primary page. Retrieved 2026-11-05.

Sources:
- [VTS] Shopee "Voucher Toko Saya" seller PDF — https://cdngarenanow-a.akamaihd.net/shopee/seller/seller_cms/99abb12d2aa5c408c944bd7c8009a615/Voucher%20Toko%20Saya.pdf
- [VIT] Shopee "Voucher Ikuti Toko" seller PDF — https://deo.shopeemobile.com/shopee/seller/seller_cms/6dffc8b1f3825a91af9476ce8a103fb2/Voucher%20Ikuti%20Toko.pdf
- [SCO] Shopee buyer help, vouchers at checkout — https://help.shopee.co.id/portal/4/article/73183
- TikTok Shop | Tokopedia Seller University (ID): [KP] Kode Promo `knowledge_id=7646840506402577`, [NC] New Customer `2963672872027906`, [LV] LIVE voucher `8041831845709570`, [CV] Chat voucher `5533163473782529`, [DO] Diskon Ongkir Seller `6837740662998786` (all at `https://seller-id.tokopedia.com/university/essay?knowledge_id=…`), [VR] Voucher Reguler course `https://seller-id.tokopedia.com/university/course?learning_id=7016789302839056&content_id=4087512650123024`
- Shopify discount codes (non-ID reference) — https://help.shopify.com/en/manual/discounts/discount-methods/discount-codes

## Findings

- **Kinds sellers use most:** a shop-wide voucher on the product subtotal (Shopee Voucher Toko, TikTok/Tokopedia Voucher Reguler/Kode Promo), fixed rupiah or percentage with a maximum discount; a seller-funded shipping discount (TikTok/Tokopedia Diskon Ongkir Seller: min spend, min item count, shipping-method and area filters). Product-scoped vouchers, new-buyer, follow, chat and LIVE vouchers exist but need product targeting, accounts or social features. [VTS][VIT][KP][NC][CV][LV][DO]
- **Fields:** internal name; code (Shopee: 4-letter shop prefix + 1–5 chars; TikTok: 4-char prefix + 2–8 A–Z/0–9, ≤12, unique among active/upcoming codes); fixed or %; a maximum discount (required for % on TikTok, and ≥ % × min spend); min purchase; start/end (Shopee ≤ 3 months, end ≥ start + 1 h; TikTok 10 min–365 days); total quota; per-buyer limit; visibility (shown on shop/product/cart, or hidden code-only). [VTS][KP]
- **Edits after start:** only extend the end or raise the quota; end early instead of delete; a code is reusable only after a while (Shopee 30 days). [VTS][KP]
- **Checkout:** the buyer types a code in a promo field (TikTok) or picks a claimed voucher (Shopee); a shop voucher short of its minimum shows how much to add; when several seller vouchers qualify the platform applies the biggest one. Exact button/error wording: unverified. [SCO][KP][NC]
- **Stacking:** one seller voucher per order; Shopee allows 1 shop voucher + 1 free-shipping voucher + 1 platform voucher. [SCO][LV][KP]
- **COD:** vouchers can be limited by payment method (Shopee labels "COD"); no source says seller vouchers exclude COD by default (unverified). [SCO]
- **Cost:** seller vouchers and seller shipping discounts are seller-funded. [VTS][KP][DO]
- **Abuse controls:** per-buyer limit (Shopee 1× per buyer), total quota, unique codes, new-buyer by order history; quota on cancel: TikTok returns it, legacy Tokopedia kept it (snippet). Per-device limits: not documented. [VTS][KP][NC]

## What 99ribu takes from this (decided 2026-11-05, see S177 "Decisions")

Ship one shared typed code per order covering two kinds: **product-subtotal discount** (fixed or %-with-cap) and **shipping discount** (the existing engine). Defaults: fixed amount preferred; % requires a cap ≥ % × min purchase; per-buyer 1; period ≤ 90 days; running vouchers only extend the end or raise the quota; codes upper-case A–Z/0–9/-; usage and quota released on full cancellation. Leave out for now: cashback/coins, claim/follow/LIVE/chat vouchers, product-scoped vouchers, single-use batches, device fingerprinting.
