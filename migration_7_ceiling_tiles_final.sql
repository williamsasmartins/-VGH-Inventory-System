-- ============================================================
-- Migration 7 – Ceiling Tile Final Fix
-- Corrects the typo "Ceiling Tite" and establishes two clean
-- SKUs with codes ct-2x2 and ct-2x4.
-- Safe: no ALTER COLUMN TYPE, no DROP of columns with triggers.
-- ============================================================

-- Step 1: Remove any price entries that reference the old codes
-- (must happen before deleting/renaming the material rows)
DELETE FROM public.material_prices WHERE material_code IN ('ct', 'ct2', 'ct4');

-- Step 2: Remove old ceiling tile rows entirely
DELETE FROM public.materials WHERE code IN ('ct', 'ct2', 'ct4');

-- Step 3: Insert the two correct ceiling tile SKUs
INSERT INTO public.materials
  (code, name, category, unit, current_stock, min_stock_alert, width, length, thickness)
VALUES
  ('ct-2x2', 'Ceiling Tile 2''x2''', 'T-bar Ceiling', 'pcs', 0, 5, 2, 2, NULL),
  ('ct-2x4', 'Ceiling Tile 2''x4''', 'T-bar Ceiling', 'pcs', 0, 5, 4, 2, NULL)
ON CONFLICT (code) DO UPDATE SET
  name     = EXCLUDED.name,
  category = EXCLUDED.category,
  unit     = EXCLUDED.unit;
