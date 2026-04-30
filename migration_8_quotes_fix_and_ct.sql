-- ============================================================
-- Migration 8 – Fix quotes table schema + single ct material
-- ============================================================

-- ── 1. Rebuild quotes table with correct schema ──────────────
-- The original migration_1 created quotes with store_name/total
-- which doesn't match the app payload (store/grand_total/mat_items/lab_items).
-- quotes has no FK dependents, so DROP + recreate is safe.

DROP TABLE IF EXISTS public.quotes CASCADE;

CREATE TABLE public.quotes (
  id           uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  project_name text          NOT NULL DEFAULT '',
  description  text          NOT NULL DEFAULT '',
  store        text          NOT NULL DEFAULT 'Kenroc',
  mat_items    jsonb         NOT NULL DEFAULT '[]',
  lab_items    jsonb         NOT NULL DEFAULT '[]',
  grand_total  numeric(10,2) NOT NULL DEFAULT 0,
  created_at   timestamptz   DEFAULT now()
);

ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all_quotes"
  ON public.quotes FOR ALL TO anon
  USING (true) WITH CHECK (true);

GRANT ALL ON TABLE public.quotes TO anon, authenticated;


-- ── 2. Single ct material (Ceiling Tile) ────────────────────
-- Remove any stale variants created by previous migrations.

DELETE FROM public.material_prices
  WHERE material_code IN ('ct2', 'ct4', 'ct-2x2', 'ct-2x4');

DELETE FROM public.materials
  WHERE code IN ('ct2', 'ct4', 'ct-2x2', 'ct-2x4');

-- Ensure exactly one clean ct row exists.
INSERT INTO public.materials
  (code, name, category, unit, current_stock, min_stock_alert)
VALUES
  ('ct', 'Ceiling Tile', 'T-bar Ceiling', 'pcs', 0, 5)
ON CONFLICT (code) DO UPDATE SET
  name     = 'Ceiling Tile',
  unit     = 'pcs',
  category = 'T-bar Ceiling';
