-- migration_13_material_orders.sql
-- Creates the material_orders table for the DRT ORDER SHEET feature

CREATE TABLE IF NOT EXISTS public.material_orders (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  project_name  text        NOT NULL,
  address       text,
  delivery_date date,
  site_contact  text,
  notes         text,
  items         jsonb       NOT NULL DEFAULT '[]'::jsonb,
  total_cost    numeric(10, 2),
  created_at    timestamptz DEFAULT now()
);

-- Index for filtering by project name and date
CREATE INDEX IF NOT EXISTS idx_material_orders_project
  ON public.material_orders (project_name);

CREATE INDEX IF NOT EXISTS idx_material_orders_created
  ON public.material_orders (created_at DESC);

-- RLS: allow all authenticated and anonymous access (same pattern as rest of app)
ALTER TABLE public.material_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all" ON public.material_orders
  FOR ALL USING (true) WITH CHECK (true);
