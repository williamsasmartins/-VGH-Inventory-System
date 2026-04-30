-- Migration 11: Convert current_stock to PHYSICAL COUNT (pcs / sheets)
--
-- Before this migration, current_stock stored coverage values:
--   • Drywall / ceiling tiles → sqft  (e.g. 10 sheets × 32 sqft = 320)
--   • Steel framing / track   → lnft  (e.g. 10 pcs × 10' = 100)
--
-- After this migration, current_stock stores physical piece count.
-- The frontend now computes sqft / lnft from transaction history.
--
-- NOTE: The exact size mix is not reliably recoverable from current_stock alone.
-- Reset everything to 0 and re-enter stock via the Inventory page.
-- This is safe because the app was in testing / initial setup phase.

UPDATE public.materials SET current_stock = 0;

-- Also ensure all existing transactions have material_id populated
-- from their material_code (in case older rows are missing it).
UPDATE public.transactions t
SET material_id = m.id
FROM public.materials m
WHERE t.material_code = m.code
  AND t.material_id IS NULL;
