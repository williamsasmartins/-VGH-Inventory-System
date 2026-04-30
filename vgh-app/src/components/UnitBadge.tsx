import { normalizeLegacyUnit, UNIT_COLOR, type MaterialUnit } from '../types/material'

interface Props {
  unit: MaterialUnit | string | null | undefined
  size?: 'sm' | 'md'
}

export function UnitBadge({ unit, size = 'sm' }: Props) {
  const normalized = normalizeLegacyUnit(unit as string)
  const color = UNIT_COLOR[normalized]
  const fontSize = size === 'md' ? 12 : 10
  const padding = size === 'md' ? '3px 8px' : '2px 6px'

  return (
    <span style={{
      display: 'inline-block',
      padding,
      borderRadius: 4,
      fontSize,
      fontWeight: 700,
      fontFamily: 'monospace',
      letterSpacing: '0.3px',
      background: color.bg,
      border: `1px solid ${color.border}`,
      color: color.text,
      lineHeight: 1.4,
    }}>
      {normalized}
    </span>
  )
}
