-- ===== VGH INVENTORY SYSTEM - SCHEMA (SAFE / IDEMPOTENT) =====

-- Tables
CREATE TABLE IF NOT EXISTS public.materials (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'ea',
  current_stock NUMERIC NOT NULL DEFAULT 0,
  min_stock_alert NUMERIC NOT NULL DEFAULT 5,
  width NUMERIC,
  length NUMERIC,
  thickness TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.material_prices (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  material_code TEXT NOT NULL REFERENCES public.materials(code) ON DELETE CASCADE,
  store_name TEXT NOT NULL,
  price NUMERIC NOT NULL DEFAULT 0,
  UNIQUE (material_code, store_name)
);

CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  material_code TEXT NOT NULL REFERENCES public.materials(code) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('in','out')),
  quantity NUMERIC NOT NULL,
  notes TEXT,
  project_name TEXT,
  unit_price NUMERIC,
  store_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add missing columns if they don't exist yet
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS width     NUMERIC;
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS length    NUMERIC;
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS thickness TEXT;

-- Quotes table (correct schema)
DROP TABLE IF EXISTS public.quote_items CASCADE;
DROP TABLE IF EXISTS public.quotes CASCADE;

CREATE TABLE public.quotes (
  id           UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  project_name TEXT          NOT NULL DEFAULT '',
  description  TEXT          NOT NULL DEFAULT '',
  store        TEXT          NOT NULL DEFAULT 'Kenroc',
  mat_items    JSONB         NOT NULL DEFAULT '[]',
  lab_items    JSONB         NOT NULL DEFAULT '[]',
  grand_total  NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ   DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.materials       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotes          ENABLE ROW LEVEL SECURITY;

-- Policies (drop first to avoid duplicate errors)
DO $$ BEGIN
  DROP POLICY IF EXISTS allow_all_materials       ON public.materials;
  DROP POLICY IF EXISTS allow_all_material_prices ON public.material_prices;
  DROP POLICY IF EXISTS allow_all_transactions    ON public.transactions;
  DROP POLICY IF EXISTS allow_all_quotes          ON public.quotes;
  DROP POLICY IF EXISTS "Allow all on quotes"     ON public.quotes;
END $$;

CREATE POLICY allow_all_materials       ON public.materials       FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY allow_all_material_prices ON public.material_prices FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY allow_all_transactions    ON public.transactions    FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY allow_all_quotes          ON public.quotes          FOR ALL TO anon USING (true) WITH CHECK (true);

-- Grants
GRANT ALL ON public.materials       TO anon, authenticated;
GRANT ALL ON public.material_prices TO anon, authenticated;
GRANT ALL ON public.transactions    TO anon, authenticated;
GRANT ALL ON public.quotes          TO anon, authenticated;
