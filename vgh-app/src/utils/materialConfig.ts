import type { Material } from '../lib/supabase'

export interface SizeOption {
  label: string    // Display label, e.g. "10'"
  factor: number   // sqft/sheet for drywall (e.g. 32); 1 for lnft materials
}

export interface MaterialCategoryConfig {
  sizeLabel: string         // Form field label ("Sheet Size", "Piece Length", …)
  sizes: SizeOption[]
  defaultSizeLabel: string  // Pre-selected option when a material is first chosen
}

// ─── Codes that use the tile-style size selector (2'x2' / 2'x4') in QuoteBuilder
export const TILE_CODES = new Set(['ct', 'DWT'])

// ─── Named configs ────────────────────────────────────────────────────────────

const DRYWALL_CONFIG: MaterialCategoryConfig = {
  sizeLabel: 'Sheet Size',
  defaultSizeLabel: "8'",
  sizes: [
    { label: "8'",  factor: 32 },
    { label: "9'",  factor: 36 },
    { label: "10'", factor: 40 },
    { label: "12'", factor: 48 },
  ],
}

const STEEL_TRACK_CONFIG: MaterialCategoryConfig = {
  sizeLabel: 'Piece Length',
  defaultSizeLabel: "10'",
  sizes: [
    { label: "8'",  factor: 1 },
    { label: "10'", factor: 1 },
    { label: "12'", factor: 1 },
    { label: "14'", factor: 1 },
    { label: "16'", factor: 1 },
    { label: "20'", factor: 1 },
    { label: "25'", factor: 1 },
  ],
}

const STEEL_STUD_CONFIG: MaterialCategoryConfig = {
  sizeLabel: 'Piece Length',
  defaultSizeLabel: "8'",
  sizes: [
    { label: "8'",  factor: 1 },
    { label: "9'",  factor: 1 },
    { label: "10'", factor: 1 },
    { label: "12'", factor: 1 },
    { label: "14'", factor: 1 },
    { label: "16'", factor: 1 },
    { label: "20'", factor: 1 },
    { label: "25'", factor: 1 },
  ],
}


// Beads, moulds, T-bar grid — sold in linear lengths
const LINEAR_CONFIG: MaterialCategoryConfig = {
  sizeLabel: 'Piece Length',
  defaultSizeLabel: "10'",
  sizes: [
    { label: "8'",  factor: 1 },
    { label: "10'", factor: 1 },
    { label: "12'", factor: 1 },
    { label: "14'", factor: 1 },
    { label: "16'", factor: 1 },
  ],
}

// Codes for bead / mould / T-bar grid materials
const LINEAR_CODES = new Set([
  '12ppj', '12pl', '12pj',
  '58ppj', '58pl', '58pj',
  'ta', 'Wm', 'flWm',
  'DWGMT', 'flmt', 'mt', 'shm',
  'cb',
])

// Materials with a single fixed piece length (pcs × length = lnft)
const CROSS_T_CONFIG: Record<string, MaterialCategoryConfig> = {
  '4ct': {
    sizeLabel: 'Piece Length',
    defaultSizeLabel: "4'",
    sizes: [{ label: "4'", factor: 1 }],
  },
  '2ct': {
    sizeLabel: 'Piece Length',
    defaultSizeLabel: "2'",
    sizes: [{ label: "2'", factor: 1 }],
  },
  'HW': {
    sizeLabel: 'Piece Length',
    defaultSizeLabel: "12'",
    sizes: [{ label: "12'", factor: 1 }],
  },
}

// ─── Lookup ───────────────────────────────────────────────────────────────────

export function getMaterialConfig(material: Material): MaterialCategoryConfig | null {
  const unit = (material.unit || '').toLowerCase()
  const name = (material.name || '').toLowerCase()
  const cat  = (material.category || '').toLowerCase()
  const code = (material.code || '')

  // Tile-style selector (ct, DWT) handled separately in QuoteBuilder
  if (TILE_CODES.has(code)) return null

  // Cross tees — fixed piece length (4' or 2')
  if (CROSS_T_CONFIG[code]) return CROSS_T_CONFIG[code]

  // Beads, moulds, T-bar grid — by code
  if (LINEAR_CODES.has(code)) return LINEAR_CONFIG

  if (cat.includes('t-bar') || name.includes('ceiling tile')) return null
  if (name.includes('insul') || cat.includes('insul') || name.includes('batt')) return null

  if (unit === 'sqft' || unit === 'sq ft' || unit === 'sf') return DRYWALL_CONFIG
  if (name.includes('track') || cat.includes('track'))        return STEEL_TRACK_CONFIG
  if (
    name.includes('stud')    || cat.includes('stud')    ||
    name.includes('framing') || cat.includes('framing') ||
    name.includes('lumber')  || cat.includes('lumber')  ||
    name.includes('channel') || cat.includes('channel') ||
    name.includes('furring') || cat.includes('furring')
  ) return STEEL_STUD_CONFIG
  return null
}

// ─── Transaction coverage calculation ────────────────────────────────────────

const TILE_SQFT_MAP: Record<string, number> = { "2'x2'": 4, "2'x4'": 8 }

/**
 * Given a transaction's physical piece count and size label, returns the
 * coverage in the material's base unit (sqft for drywall/tiles, lnft for framing).
 *
 * Used by the detail drawer to compute TOTAL IN / TOTAL OUT.
 */
export function computeTransactionCoverage(
  material: { code: string; unit?: string | null },
  sizeLabel: string | null,
  physicalCount: number,
): number {
  if (physicalCount <= 0) return 0
  if (!sizeLabel) return physicalCount

  // Tile materials: pieces × tile area (sqft)
  if (TILE_CODES.has(material.code)) {
    return physicalCount * (TILE_SQFT_MAP[sizeLabel] ?? 1)
  }

  // Use the size config to determine the factor
  const config = getMaterialConfig(material as Parameters<typeof getMaterialConfig>[0])
  if (!config) return physicalCount

  const opt = config.sizes.find(s => s.label === sizeLabel)
  if (!opt) return physicalCount

  // Drywall / sqft materials: factor > 1 (e.g. 32 sqft per 8' sheet)
  if (opt.factor > 1) return physicalCount * opt.factor

  // Linear materials: factor = 1, but sizeLabel encodes feet (e.g. "10'" → 10)
  const feet = parseFloat(sizeLabel.replace(/['"]/g, ''))
  return isNaN(feet) ? physicalCount : physicalCount * feet
}

// ─── Quote quantity calculation ───────────────────────────────────────────────

/**
 * Compute the total **base-unit** quantity for a quote line item.
 *
 * - Drywall / sqft materials:  pieces × factor  (e.g. 10 sheets × 32 = 320 sqft)
 * - Linear materials (lnft):  pieces × feet     (e.g. 10 pcs × 10' = 100 lnft)
 * - No config / unknown:       returns pieces as-is
 *
 * Returns 0 for invalid inputs to prevent NaN in cost calculations.
 */
export function computeQuoteQuantity(
  material: Material,
  sizeLabel: string,
  pieces: number,
): number {
  if (!sizeLabel || pieces <= 0 || !isFinite(pieces)) return 0

  const config = getMaterialConfig(material)
  if (!config) return pieces

  const sizeOpt = config.sizes.find(s => s.label === sizeLabel)
  if (!sizeOpt) return pieces

  // Drywall: factor encodes actual sqft/sheet
  if (sizeOpt.factor > 1) return pieces * sizeOpt.factor

  // Linear: factor === 1 in the DB system (each piece = 1 lnft),
  // but in quotes we want actual linear feet (10 pcs × 10' = 100 lnft).
  // Strip trailing ' or " before parsing (e.g. "4'" → 4, "10'" → 10).
  const feet = parseFloat(sizeLabel.replace(/['"]/g, ''))
  return isNaN(feet) ? pieces : pieces * feet
}
