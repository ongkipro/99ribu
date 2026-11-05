-- S177 2B performance fix (2026-11-05): the SQL version of app.quote_unit_discounts (0052) was inlined and planned for
-- ~10M rows (default estimates for jsonb_array_elements × generate_series), so every order seal spent seconds building
-- huge sorts and hash tables for a handful of units. Same result, as a plain loop over the quote document: units are
-- numbered per line in package order, then line order, then quantity (TS twin: merchandiseShares in checkout/quotes.ts).
CREATE OR REPLACE FUNCTION app.quote_unit_discounts(document jsonb)
RETURNS TABLE(parcel_id text,line_id text,unit_index int,amount bigint) LANGUAGE plpgsql IMMUTABLE ROWS 50 AS $$
DECLARE amounts jsonb:='{}'::jsonb; quantities jsonb:='{}'::jsonb; counters jsonb:='{}'::jsonb; promotion jsonb; part jsonb; parcel jsonb;
 n int; total numeric; quantity int; position int;
BEGIN
 FOR promotion IN SELECT value FROM jsonb_array_elements(coalesce(document->'promotions','[]'::jsonb)) LOOP
  FOR part IN SELECT value FROM jsonb_array_elements(coalesce(promotion->'lines','[]'::jsonb)) LOOP
   amounts:=jsonb_set(amounts,ARRAY[part->>'line_id'],to_jsonb(coalesce((amounts->>(part->>'line_id'))::numeric,0)+(part->>'amount')::numeric));
  END LOOP;
 END LOOP;
 FOR part IN SELECT value FROM jsonb_array_elements(document->'selected_plan'->'lines') LOOP
  quantities:=jsonb_set(quantities,ARRAY[part->>'line_id'],part->'quantity');
 END LOOP;
 FOR parcel IN SELECT value FROM jsonb_array_elements(document->'selected_plan'->'packages') LOOP
  FOR part IN SELECT value FROM jsonb_array_elements(parcel->'lines') LOOP
   total:=coalesce((amounts->>(part->>'line_id'))::numeric,0); quantity:=(quantities->>(part->>'line_id'))::int;
   FOR n IN 1..(part->>'quantity')::int LOOP
    position:=coalesce((counters->>(part->>'line_id'))::int,0)+1; counters:=jsonb_set(counters,ARRAY[part->>'line_id'],to_jsonb(position));
    parcel_id:=parcel->>'id'; line_id:=part->>'line_id'; unit_index:=position;
    amount:=(floor(total/quantity)+CASE WHEN position<=mod(total,quantity) THEN 1 ELSE 0 END)::bigint;
    RETURN NEXT;
   END LOOP;
  END LOOP;
 END LOOP;
END $$;
