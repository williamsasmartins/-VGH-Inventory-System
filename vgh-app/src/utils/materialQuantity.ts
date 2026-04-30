/**
 * materialQuantity.ts
 *
 * current_stock is stored as PHYSICAL COUNT (pcs / sheets / boxes).
 * This utility formats that count for display using the correct physical unit label.
 * Coverage (sqft / lnft) is computed elsewhere from transaction history.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface ConversionRule {
  /** Singular physical unit label, e.g. "sheet", "box", "pc" */
  physicalUnit: string
  /** Plural form — auto-appends "s" if omitted */
  physicalUnitPlural?: string
  /**
   * Default sqft or lnft per physical unit (for reference / optional secondary display).
   * e.g. an 8'×4' drywall sheet = 32 sqft → defaultCoveragePerUnit = 32
   */
  defaultCoveragePerUnit?: number
}

export interface FormattedQuantity {
  /** Primary display — always shown, e.g. "10 sheets" */
  primary: string
  /** Secondary display — shown beneath when relevant, e.g. "≈ 320 sqft" */
  secondary: string | null
  /** Physical count (same as rawQty now that DB stores pcs) */
  physicalCount: number
  /** E.g. "sheets", "pcs", "boxes" */
  unitLabel: string
  /** Original DB value */
  rawQty: number
}

// ── Conversion Map ───────────────────────────────────────────────────────────
// KEY: material.category (exact match, case-sensitive)

export const CONVERSION_MAP: Record<string, ConversionRule> = {
  Drywall: {
    physicalUnit: 'sheet',
    physicalUnitPlural: 'sheets',
    defaultCoveragePerUnit: 32,   // 4×8 reference sheet
  },
  Insulation: {
    physicalUnit: 'sqft',
    physicalUnitPlural: 'sqft',
  },
  'Tape & Mud': {
    physicalUnit: 'pail',
    physicalUnitPlural: 'pails',
  },
  'Steel Framing': {
    physicalUnit: 'pc',
    physicalUnitPlural: 'pcs',
  },
  'Channels & Accessories': {
    physicalUnit: 'pc',
    physicalUnitPlural: 'pcs',
  },
  'T-Bar Ceiling': {
    physicalUnit: 'pc',
    physicalUnitPlural: 'pcs',
  },
  Accessories: {
    physicalUnit: 'pc',
    physicalUnitPlural: 'pcs',
  },
  Fasteners: {
    physicalUnit: 'box',
    physicalUnitPlural: 'boxes',
  },
  'Adhesives & Sealants': {
    physicalUnit: 'tube',
    physicalUnitPlural: 'tubes',
  },
  Labour: {
    physicalUnit: 'hr',
    physicalUnitPlural: 'hrs',
  },
}

// ── Utility ───────────────────────────────────────────────────────────────────

function pluralize(count: number, rule: ConversionRule): string {
  if (count === 1) return rule.physicalUnit
  return rule.physicalUnitPlural ?? rule.physicalUnit + 's'
}

/**
 * Formats a physical-count quantity for display on cards and the detail drawer.
 *
 * @param quantity  Physical count from DB (pcs / sheets / boxes — NOT sqft/lnft)
 * @param unit      Material.unit field (e.g. "sqft", "lnft", "ea") — used as fallback label
 * @param category  Material.category — selects the ConversionRule
 */
export function formatMaterialQuantity(
  quantity: number,
  unit: string,
  category: string,
  _materialDims?: { width: number | null; length: number | null }   // kept for API compat
): FormattedQuantity {
  const rule = CONVERSION_MAP[category]

  const physicalLabel = rule ? pluralize(quantity, rule) : unit
  const primary = `${quantity.toLocaleString()} ${physicalLabel}`

  // Optional secondary: approximate sqft/lnft based on default coverage if defined
  let secondary: string | null = null
  if (rule?.defaultCoveragePerUnit && quantity > 0) {
    const coverage = Math.round(quantity * rule.defaultCoveragePerUnit)
    secondary = `≈ ${coverage.toLocaleString()} ${unit}`
  }

  return {
    primary,
    secondary,
    physicalCount: quantity,
    unitLabel: physicalLabel,
    rawQty: quantity,
  }
}

/**
 * Aggregates total physical stock for a list of materials.
 * Returns a plain display string, e.g. "10 sheets" or "342 pcs".
 */
export function aggregateStock(
  materials: { current_stock: number; unit: string; category: string; width?: number | null; length?: number | null }[],
  singleCategory: string | null,
): string {
  const total = materials.reduce((s, m) => s + m.current_stock, 0)
  if (total === 0) return '0'

  if (singleCategory) {
    const rule = CONVERSION_MAP[singleCategory]
    if (rule) {
      const label = pluralize(total, rule)
      return `${total.toLocaleString()} ${label}`
    }
  }

  return total.toLocaleString()
}
