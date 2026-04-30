-- ===== VGH INVENTORY SYSTEM - STEP 1: SCHEMA =====

CREATE TABLE IF NOT EXISTS public.materials (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'ea',
  current_stock NUMERIC NOT NULL DEFAULT 0,
  min_stock_alert NUMERIC NOT NULL DEFAULT 5,
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

CREATE TABLE IF NOT EXISTS public.quotes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_name TEXT,
  description TEXT,
  store_name TEXT DEFAULT 'Kenroc',
  total NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.quote_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  quote_id UUID REFERENCES public.quotes(id) ON DELETE CASCADE,
  section TEXT NOT NULL CHECK (section IN ('Material','Labour')),
  material_code TEXT,
  description TEXT,
  quantity NUMERIC,
  unit TEXT,
  rate NUMERIC,
  cost NUMERIC,
  sort_order INTEGER DEFAULT 0
);

ALTER TABLE public.materials        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_prices  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_items      ENABLE ROW LEVEL SECURITY;

CREATE POLICY allow_all_materials       ON public.materials       FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY allow_all_material_prices ON public.material_prices FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY allow_all_transactions    ON public.transactions    FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY allow_all_quotes          ON public.quotes          FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY allow_all_quote_items     ON public.quote_items     FOR ALL TO anon USING (true) WITH CHECK (true);
