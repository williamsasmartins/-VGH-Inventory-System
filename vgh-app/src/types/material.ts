// ─── Canonical unit type ─────────────────────────────────────────────────────
// These are the exact display-ready values stored in the database going forward.

export type MaterialUnit =
  | 'Lnft'
  | 'Sqft'
  | 'Pcs'
  | 'Boxes'
  | 'Tubes'
  | 'Cans'
  | 'Pails'
  | 'Hrs'
  | 'Weeks'
  | 'Custom'

export const MATERIAL_UNITS: MaterialUnit[] = [
  'Lnft',
  'Sqft',
  'Pcs',
  'Boxes',
  'Tubes',
  'Cans',
  'Pails',
  'Hrs',
  'Weeks',
  'Custom',
]

// ─── Category → default unit ──────────────────────────────────────────────────

export const CATEGORY_DEFAULT_UNIT: Record<string, MaterialUnit> = {
  'Drywall':       'Sqft',
  'Insulation':    'Sqft',
  'Steel Framing': 'Lnft',
  'Tape & Mud':    'Pails',
  'T-bar Ceiling': 'Lnft',
  'Accessories':   'Pcs',
  'Fasteners':     'Boxes',
  'Adhesives':     'Tubes',
  'Labour':        'Hrs',
  'Equipment':     'Weeks',
}

// ─── Unit badge color tokens ──────────────────────────────────────────────────

export const UNIT_COLOR: Record<MaterialUnit, { bg: string; border: string; text: string }> = {
  Sqft:   { bg: 'rgba(96,165,250,0.10)',  border: 'rgba(96,165,250,0.30)',  text: '#60A5FA' },
  Lnft:   { bg: 'rgba(52,211,153,0.10)',  border: 'rgba(52,211,153,0.30)',  text: '#34D399' },
  Pcs:    { bg: 'rgba(167,139,250,0.10)', border: 'rgba(167,139,250,0.30)', text: '#A78BFA' },
  Boxes:  { bg: 'rgba(251,191,36,0.10)',  border: 'rgba(251,191,36,0.30)',  text: '#FBBF24' },
  Tubes:  { bg: 'rgba(249,115,22,0.10)',  border: 'rgba(249,115,22,0.30)',  text: '#F97316' },
  Cans:   { bg: 'rgba(236,72,153,0.10)',  border: 'rgba(236,72,153,0.30)',  text: '#EC4899' },
  Pails:  { bg: 'rgba(20,184,166,0.10)',  border: 'rgba(20,184,166,0.30)',  text: '#14B8A6' },
  Hrs:    { bg: 'rgba(239,68,68,0.10)',   border: 'rgba(239,68,68,0.30)',   text: '#EF4444' },
  Weeks:  { bg: 'rgba(234,179,8,0.10)',   border: 'rgba(234,179,8,0.30)',   text: '#EAB308' },
  Custom: { bg: 'rgba(100,116,139,0.10)', border: 'rgba(100,116,139,0.30)', text: '#64748B' },
}

// ─── Legacy normalizer ────────────────────────────────────────────────────────
// Converts old lowercase DB values to the canonical MaterialUnit.
// Safe to call with null / undefined (returns 'Custom').

const LEGACY_MAP: Record<string, MaterialUnit> = {
  sqft: 'Sqft', 'sq ft': 'Sqft', sf: 'Sqft',
  lnft: 'Lnft', 'ln ft': 'Lnft', linft: 'Lnft',
  ea: 'Pcs', pcs: 'Pcs', each: 'Pcs', roll: 'Pcs',
  box: 'Boxes', boxes: 'Boxes', bag: 'Boxes', bags: 'Boxes',
  tube: 'Tubes', tubes: 'Tubes',
  can: 'Cans', cans: 'Cans',
  pail: 'Pails', pails: 'Pails',
  hour: 'Hrs', hr: 'Hrs', hrs: 'Hrs',
  day: 'Weeks', week: 'Weeks', weeks: 'Weeks',
  load: 'Custom',
}

export function normalizeLegacyUnit(raw: string | null | undefined): MaterialUnit {
  if (!raw) return 'Custom'
  if (MATERIAL_UNITS.includes(raw as MaterialUnit)) return raw as MaterialUnit
  return LEGACY_MAP[raw.toLowerCase()] ?? 'Custom'
}
