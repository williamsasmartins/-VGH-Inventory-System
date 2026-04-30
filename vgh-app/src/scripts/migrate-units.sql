-- ============================================================
-- VGH Material – Unit Migration Script
-- Run once in Supabase SQL Editor to normalize all legacy unit
-- values to the new canonical set:
--   Lnft | Sqft | Pcs | Boxes | Tubes | Cans | Pails | Hrs | Weeks | Custom
-- ============================================================

-- 1. Sqft (Drywall, Insulation, sqft-unit steel items)
UPDATE materials
SET unit = 'Sqft'
WHERE unit IN ('sqft', 'sq ft', 'sf')
   OR (category IN ('Drywall', 'Insulation') AND unit NOT IN (
        'Lnft','Sqft','Pcs','Boxes','Tubes','Cans','Pails','Hrs','Weeks','Custom'));

-- 2. Lnft (Steel Framing, T-bar rails)
UPDATE materials
SET unit = 'Lnft'
WHERE unit IN ('lnft', 'ln ft', 'linft');

-- 3. Pcs  (each / roll / individual accessories)
UPDATE materials
SET unit = 'Pcs'
WHERE unit IN ('ea', 'each', 'roll', 'pcs');

-- 4. Boxes (box / bag / bags / fastener packs)
UPDATE materials
SET unit = 'Boxes'
WHERE unit IN ('box', 'bag', 'bags', 'boxes');

-- 5. Tubes (adhesive tubes)
UPDATE materials
SET unit = 'Tubes'
WHERE unit IN ('tube', 'tubes');

-- 6. Cans (spray cans)
UPDATE materials
SET unit = 'Cans'
WHERE unit IN ('can', 'cans');

-- 7. Pails (mud pails)
UPDATE materials
SET unit = 'Pails'
WHERE unit IN ('pail', 'pails');

-- 8. Hrs (labour)
UPDATE materials
SET unit = 'Hrs'
WHERE unit IN ('hour', 'hr', 'hrs');

-- 9. Weeks (equipment – day/week)
UPDATE materials
SET unit = 'Weeks'
WHERE unit IN ('day', 'days', 'week', 'weeks');

-- 10. Custom – catch everything else that is still non-canonical
UPDATE materials
SET unit = 'Custom'
WHERE unit NOT IN ('Lnft','Sqft','Pcs','Boxes','Tubes','Cans','Pails','Hrs','Weeks','Custom');

-- Verify: should return 0 rows after migration
SELECT id, code, name, unit
FROM materials
WHERE unit NOT IN ('Lnft','Sqft','Pcs','Boxes','Tubes','Cans','Pails','Hrs','Weeks','Custom');
