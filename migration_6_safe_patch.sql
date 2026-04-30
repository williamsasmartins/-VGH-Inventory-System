-- ============================================================
-- Migration 6 – Safe Patch
-- Rules:
--   • NO ALTER COLUMN ... TYPE  (breaks triggers)
--   • NO ALTER COLUMN ... SET NOT NULL on existing columns
--   • Only ADD COLUMN IF NOT EXISTS for existing tables
--   • All CREATE TABLE / CREATE POLICY use IF NOT EXISTS
-- ============================================================


-- ── 1. ADD missing columns to transactions (English table) ──
-- Uses ADD COLUMN IF NOT EXISTS – safe even with active triggers.

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS material_id   uuid,
  ADD COLUMN IF NOT EXISTS type          text,
  ADD COLUMN IF NOT EXISTS sheet_size    text,
  ADD COLUMN IF NOT EXISTS sheet_count   numeric,
  ADD COLUMN IF NOT EXISTS project_name  text,
  ADD COLUMN IF NOT EXISTS unit_price    numeric,
  ADD COLUMN IF NOT EXISTS store_name    text;


-- ── 2. ADD missing columns to transacoes (Portuguese/legacy table) ──
-- Same safe approach – never touches tipo or any existing column type.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'transacoes'
  ) THEN
    -- Only ADD new columns; never alter existing ones.
    BEGIN ALTER TABLE public.transacoes ADD COLUMN IF NOT EXISTS project_name text;    EXCEPTION WHEN others THEN NULL; END;
    BEGIN ALTER TABLE public.transacoes ADD COLUMN IF NOT EXISTS unit_price   numeric;  EXCEPTION WHEN others THEN NULL; END;
    BEGIN ALTER TABLE public.transacoes ADD COLUMN IF NOT EXISTS store_name   text;     EXCEPTION WHEN others THEN NULL; END;
    BEGIN ALTER TABLE public.transacoes ADD COLUMN IF NOT EXISTS sheet_size   text;     EXCEPTION WHEN others THEN NULL; END;
    BEGIN ALTER TABLE public.transacoes ADD COLUMN IF NOT EXISTS sheet_count  numeric;  EXCEPTION WHEN others THEN NULL; END;
  END IF;
END $$;


-- ── 3. ADD missing dimension columns to materials ────────────

ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS width     numeric,
  ADD COLUMN IF NOT EXISTS length    numeric,
  ADD COLUMN IF NOT EXISTS thickness text;

-- Same for Portuguese table if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'materiais'
  ) THEN
    BEGIN ALTER TABLE public.materiais ADD COLUMN IF NOT EXISTS width     numeric; EXCEPTION WHEN others THEN NULL; END;
    BEGIN ALTER TABLE public.materiais ADD COLUMN IF NOT EXISTS length    numeric; EXCEPTION WHEN others THEN NULL; END;
    BEGIN ALTER TABLE public.materiais ADD COLUMN IF NOT EXISTS thickness text;    EXCEPTION WHEN others THEN NULL; END;
  END IF;
END $$;


-- ── 4. CREATE stores table (if not already present) ─────────

CREATE TABLE IF NOT EXISTS public.stores (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name       text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'stores' AND policyname = 'allow_all_stores'
  ) THEN
    EXECUTE 'CREATE POLICY allow_all_stores ON public.stores FOR ALL TO anon USING (true) WITH CHECK (true)';
  END IF;
END $$;

GRANT ALL ON TABLE public.stores TO anon, authenticated;

-- Seed the three stores (ignore if already exist)
INSERT INTO public.stores (name) VALUES
  ('Kenroc'),
  ('Pacific West'),
  ('Dryco')
ON CONFLICT (name) DO NOTHING;


-- ── 5. CREATE material_prices table (if not already present) ─

CREATE TABLE IF NOT EXISTS public.material_prices (
  id            uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  material_code text    NOT NULL REFERENCES public.materials(code) ON DELETE CASCADE,
  store_name    text    NOT NULL,
  price         numeric NOT NULL DEFAULT 0,
  UNIQUE (material_code, store_name)
);

ALTER TABLE public.material_prices ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'material_prices' AND policyname = 'allow_all_material_prices'
  ) THEN
    EXECUTE 'CREATE POLICY allow_all_material_prices ON public.material_prices FOR ALL TO anon USING (true) WITH CHECK (true)';
  END IF;
END $$;

GRANT ALL ON TABLE public.material_prices TO anon, authenticated;


-- ── 6. CREATE quotes table (replaces the earlier migration_4) ─
-- Stores the full JSON snapshot of a Quote Builder document.

CREATE TABLE IF NOT EXISTS public.quotes (
  id           uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  project_name text    NOT NULL DEFAULT '',
  description  text    NOT NULL DEFAULT '',
  store        text    NOT NULL DEFAULT 'Kenroc',
  mat_items    jsonb   NOT NULL DEFAULT '[]',
  lab_items    jsonb   NOT NULL DEFAULT '[]',
  grand_total  numeric(10,2) NOT NULL DEFAULT 0,
  created_at   timestamptz DEFAULT now()
);

ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'quotes' AND policyname = 'Allow all on quotes'
  ) THEN
    EXECUTE 'CREATE POLICY "Allow all on quotes" ON public.quotes FOR ALL TO anon USING (true) WITH CHECK (true)';
  END IF;
END $$;

GRANT ALL ON TABLE public.quotes TO anon, authenticated;


-- ── 7. Ceiling Tile data correction ─────────────────────────
-- Rename ct2 → ct, relabel to 2'x2', insert new ct4 (2'x4').

-- Step 1: rename the code
UPDATE public.materials SET code = 'ct'  WHERE code = 'ct2';

-- Step 2: correct the name of the 2'x2' tile
UPDATE public.materials SET name = 'Ceiling Tile 2''x2''' WHERE code = 'ct';

-- Step 3: insert the 2'x4' variant (skip if already exists)
INSERT INTO public.materials (code, name, category, unit, current_stock, min_stock_alert, width, length, thickness)
SELECT
  'ct4',
  'Ceiling Tile 2''x4''',
  category,
  unit,
  0,
  min_stock_alert,
  4,    -- width  (ft)
  2,    -- length (ft)
  thickness
FROM public.materials
WHERE code = 'ct'
ON CONFLICT (code) DO NOTHING;
