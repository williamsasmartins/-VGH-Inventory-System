-- Migration 12: Add Red Box (Joint Compound) to Tape & Mud
-- Add material
INSERT INTO public.materials (code, name, category, unit, current_stock, min_stock_alert)
VALUES ('mbr', 'Red Box', 'Tape & Mud', 'Boxes', 0, 5)
ON CONFLICT (code) DO NOTHING;

-- Add price $25.00 for each store
INSERT INTO public.material_prices (material_code, store_name, price)
VALUES
  ('mbr', 'Kenroc',      25.00),
  ('mbr', 'Pacific West', 25.00),
  ('mbr', 'Dryco',       25.00)
ON CONFLICT (material_code, store_name) DO UPDATE SET price = EXCLUDED.price;
