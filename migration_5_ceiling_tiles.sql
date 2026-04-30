-- Migration 5: Ceiling Tile data correction
-- Renames ct2 → ct and splits into two distinct SKUs

-- Step 1: Rename code ct2 → ct
UPDATE materials
SET code = 'ct'
WHERE code = 'ct2';

-- Step 2: Rename the existing entry to the 2'x2' variant
UPDATE materials
SET name = 'Ceiling Tile 2''x2'''
WHERE code = 'ct';

-- Step 3: Insert the new 2'x4' variant (inherits same category/unit/alert from the 2'x2' row)
INSERT INTO materials (code, name, category, unit, current_stock, min_stock_alert, width, length, thickness)
SELECT
  'ct4',
  'Ceiling Tile 2''x4''',
  category,
  unit,
  0,
  min_stock_alert,
  4,
  2,
  thickness
FROM materials
WHERE code = 'ct';
