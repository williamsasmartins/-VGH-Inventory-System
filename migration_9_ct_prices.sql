-- Migration 9: Ceiling Tile (ct) price stored as price/sqft.
-- The UI multiplies by tile area (4 sqft for 2'x2', 8 sqft for 2'x4')
-- to get the per-piece price automatically.

INSERT INTO public.material_prices (material_code, store_name, price) VALUES
  ('ct', 'Kenroc',       0.90),
  ('ct', 'Pacific West', 0.90),
  ('ct', 'Dryco',        0.90)
ON CONFLICT (material_code, store_name) DO UPDATE SET price = EXCLUDED.price;
