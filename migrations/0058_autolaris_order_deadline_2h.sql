-- Owner 2026-11-10 ("2 jam"): an AutoLaris order lives 2 hours, the life AutoLaris itself gives a `submit` bill (it has no
-- expiry field; both 2026-11-09 probes expired exactly 2 hours after creation). With 30 minutes, a buyer paying the still-valid
-- bill between minute 30 and 120 hit an already cancelled order (recovery), and after the bounded advice window no read at all.
-- Only the deadline CHECK widens: existing rows keep satisfying it (30 minutes and manual-bank 24 hours are unchanged), no data
-- moves. Stock holds have no upper bound; promotion holds allow up to 24 hours. ORDER_DEADLINE_SECONDS in
-- src/modules/payments/methods.ts is the code-side twin of these values.
-- Rollback: the old code still writes only 30 minutes for every channel except manual-bank, which this CHECK keeps
-- accepting; so a code rollback needs no schema change. Reverting the CHECK itself is a forward migration (0059), and only
-- after no autolaris order with a 2-hour deadline remains pending.
ALTER TABLE "app"."commerce_order" DROP CONSTRAINT "commerce_order_deadline_check";--> statement-breakpoint
ALTER TABLE "app"."commerce_order" ADD CONSTRAINT "commerce_order_deadline_check" CHECK ("app"."commerce_order"."expires_at"="app"."commerce_order"."created_at"+interval '30 minutes' OR ("app"."commerce_order"."payment_channel"='manual-bank' AND "app"."commerce_order"."expires_at"="app"."commerce_order"."created_at"+interval '24 hours') OR ("app"."commerce_order"."payment_channel"='autolaris' AND "app"."commerce_order"."expires_at"="app"."commerce_order"."created_at"+interval '2 hours'));