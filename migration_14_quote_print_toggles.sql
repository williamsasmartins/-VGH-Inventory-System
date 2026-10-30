-- Migration 14: per-quote print toggles for the Material / Labour sections
-- When a section is off it is left out of the Invoice, the Detailed Quote and
-- the Excel export, and out of the quoted total.

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS print_material boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS print_labour   boolean NOT NULL DEFAULT true;
