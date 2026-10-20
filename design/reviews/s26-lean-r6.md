# S26 selected-allocation amount correction review

Builder review before the bounded independent correction review. Read all allocation-option render callers, native projectQuote/selectQuote/persistQuote and the review-to-shipping action. The native selected_plan is re-priced while alternative plans retain issued default-service totals; they are different projections and must not be conflated.

The current allocation uses the existing quote.shipping_total. Other alternatives retain their native plan.shipping_total. No client pricing calculation, DTO/API/native/schema change, helper or dependency was added. The word ongkir follows the amount so the amount remains first at narrow widths.

The browser regression uses the existing native quote endpoint and shared currency formatter, returns from final review through the actual Ubah pengiriman control, checks the selected allocation amount and per-parcel amounts, then explicitly reviews and submits through native handlers. It adds no fake quote or status response. The exact two-case diagnostic first executes the existing genuine COD768 stock hold, then prepaid two-origin path: RED-r2 proves expected Rp37.000 versus displayed Rp35.000. The earlier single-case RED-r1 stops before this invariant because the full-file fixture had not yet retained that COD stock and could use one origin; it is not claimed as the P2 reproduction. Full registered selection remains the acceptance command.

The Back assertion now uses web-first waiting for the same native formatted amount, without a weaker predicate or arbitrary delay. The first post-fix registered19/20 failure has no stack and remains retained; a full direct20 passed, and the current web-first registry20 passed. No claim is made that the unobserved assertion cause was proved.

The original full24-source review r5 found only this P2. The other22 sources remain fingerprint-identical for the bounded correction review; final current-union R3 still requires full source/evidence coverage. All earlier failures, source reviews and advisory preflights stay intact. This is builder lean review, not independent approval.
