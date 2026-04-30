import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase, type Material, type Transaction } from '../lib/supabase'
import { CONVERSION_MAP, type ConversionRule } from '../utils/materialQuantity'
import { computeTransactionCoverage } from '../utils/materialConfig'

// ── Props ────────────────────────────────────────────────────────────────────
interface Props {
  material: Material | null
  onClose: () => void
  onNavigateInventory?: (material: Material) => void
}

// Returns the best ConversionRule for a category, including prefix-match for
// subcategories like "Steel Framing - 25 Gauge" → "Steel Framing" rule.
function getCategoryRule(category: string): ConversionRule | null {
  if (CONVERSION_MAP[category]) return CONVERSION_MAP[category]
  for (const key of Object.keys(CONVERSION_MAP)) {
    if (category.startsWith(key)) return CONVERSION_MAP[key]
  }
  return null
}

export default function MaterialDetailDrawer({ material, onClose, onNavigateInventory }: Props) {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [txLoading, setTxLoading] = useState(false)
  const [prices, setPrices] = useState<{ store_name: string; price: number }[]>([])

  const fetchData = useCallback(async (mat: Material) => {
    setTxLoading(true)
    const [txRes, priceRes] = await Promise.all([
      // Fetch by material_id OR material_code so that old transactions
      // (which had no material_id set) are still found.
      supabase
        .from('transactions')
        .select('*')
        .or(`material_id.eq.${mat.id},material_code.eq.${mat.code}`)
        .order('created_at', { ascending: false }),
      supabase
        .from('material_prices')
        .select('store_name, price')
        .eq('material_code', mat.code)
        .order('store_name'),
    ])
    setTransactions((txRes.data as Transaction[]) || [])
    setPrices(priceRes.data || [])
    setTxLoading(false)
  }, [])

  useEffect(() => {
    if (!material) { setTransactions([]); setPrices([]); return }
    fetchData(material)
  }, [material, fetchData])

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const isOpen = material !== null

  function formatDate(s: string) {
    const d = new Date(s)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
      ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  }

  const isAlert = material ? material.current_stock < material.min_stock_alert : false

  // Rule for this material's category (handles subcategories via prefix match)
  const categoryRule = material ? getCategoryRule(material.category) : null

  // Physical unit label — always show the human label ("sheets", "pcs", etc.)
  // NOT the raw DB unit ("sqft", "lnft") which would be confusing for stock counts.
  const physicalUnitLabel = categoryRule?.physicalUnitPlural ?? 'pcs'

  // Coverage unit (what sqft/lnft means for this material)
  const coverageUnit = material?.unit ?? ''

  // TOTAL IN / TOTAL OUT — sum coverage from transaction history.
  //
  // Old transactions (before the pcs fix) stored coverage in `quantity` directly
  // and have `sheet_count = null`. New transactions store physical pcs in `quantity`
  // and also set `sheet_count`. We detect which format each transaction uses:
  //   • sheet_count set  → new format: quantity = pcs, apply computeTransactionCoverage
  //   • sheet_count null → old format: quantity already IS the coverage, use as-is
  const { totalInCoverage, totalOutCoverage } = useMemo(() => {
    if (!material) return { totalInCoverage: 0, totalOutCoverage: 0 }
    let totalIn = 0, totalOut = 0
    for (const tx of transactions) {
      const isIn = tx.type?.toUpperCase() === 'IN'
      let coverage: number
      if (tx.sheet_count != null) {
        // New-format transaction: quantity = pcs, compute coverage
        coverage = computeTransactionCoverage(material, tx.sheet_size, tx.quantity)
      } else {
        // Old-format transaction: quantity already stores sqft/lnft coverage
        coverage = tx.quantity
      }
      if (isIn) totalIn += coverage
      else totalOut += coverage
    }
    // Fallback: if no transaction history at all but stock exists, estimate from current_stock
    if (totalIn === 0 && material.current_stock > 0) {
      const defaultCoverage = categoryRule?.defaultCoveragePerUnit
      totalIn = defaultCoverage ? material.current_stock * defaultCoverage : material.current_stock
    }
    return { totalInCoverage: totalIn, totalOutCoverage: totalOut }
  }, [transactions, material, categoryRule])

  return (
    <>
      {/* Backdrop */}
      <div
        className={`drawer-backdrop ${isOpen ? 'open' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <aside className={`material-drawer ${isOpen ? 'open' : ''}`} role="dialog" aria-modal="true">
        {material && (
          <>
            {/* ── Header ── */}
            <div className="drawer-header">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span
                    style={{
                      fontFamily: 'monospace', fontWeight: 800, fontSize: 12,
                      background: isAlert ? 'rgba(220,38,38,0.2)' : 'rgba(34,197,94,0.15)',
                      color: isAlert ? 'var(--red-light)' : 'var(--green-light)',
                      padding: '3px 8px', borderRadius: 6,
                    }}
                  >{material.code}</span>
                  {isAlert && (
                    <span style={{
                      fontSize: 11, fontWeight: 700, color: 'var(--red)',
                      background: 'rgba(220,38,38,0.12)', padding: '2px 8px', borderRadius: 100,
                    }}>⚠ LOW STOCK</span>
                  )}
                </div>
                <h2 style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3 }}>
                  {material.name}
                </h2>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  {material.category} · {material.unit}
                </div>
              </div>
              <button className="drawer-close" onClick={onClose} aria-label="Close">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="drawer-body">

              {/* ── Stock summary ── */}
              <div className="drawer-section">
                <div className="drawer-section-title">Current Stock</div>

                {/* ── 3-col: IN STOCK (pcs) | TOTAL IN (coverage) | TOTAL OUT (coverage) ── */}
                <div className="grid grid-cols-3 gap-2.5">

                  {/* IN STOCK — raw physical count, no unit conversion */}
                  <div className="drawer-stat">
                    <div className="ds-label">In Stock</div>
                    <div className={`ds-value ${isAlert ? 'red' : 'green'}`}>
                      {material.current_stock.toLocaleString()}
                    </div>
                    <div className="ds-unit">{physicalUnitLabel}</div>
                  </div>

                  {/* TOTAL IN — coverage (sqft / lnft) computed from transaction history */}
                  <div className="drawer-stat">
                    <div className="ds-label">Total In</div>
                    {txLoading ? (
                      <div className="ds-value green">—</div>
                    ) : (
                      <>
                        <div className="ds-value green">
                          {totalInCoverage.toLocaleString()}
                        </div>
                        <div className="ds-unit">{coverageUnit}</div>
                      </>
                    )}
                  </div>

                  {/* TOTAL OUT — coverage from transaction history */}
                  <div className="drawer-stat">
                    <div className="ds-label">Total Out</div>
                    {txLoading ? (
                      <div className="ds-value red">—</div>
                    ) : (
                      <>
                        <div className="ds-value red">
                          {totalOutCoverage.toLocaleString()}
                        </div>
                        <div className="ds-unit">{coverageUnit}</div>
                      </>
                    )}
                  </div>
                </div>

                {/* Min alert */}
                <div className={[
                  'mt-2.5 flex items-center justify-between rounded-sm border px-3 py-2 text-xs',
                  isAlert
                    ? 'border-red/30 bg-red/[.08] text-red-light'
                    : 'border-border-base bg-white/[.03] text-text-muted',
                ].join(' ')}>
                  <span>Min. stock alert</span>
                  <strong>{material.min_stock_alert} {physicalUnitLabel}</strong>
                </div>
              </div>

              {/* ── Prices ── */}
              {prices.length > 0 && (
                <div className="drawer-section">
                  <div className="drawer-section-title">Prices by Vendor</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {prices.map(p => (
                      <div key={p.store_name} style={{
                        flex: '1 1 120px',
                        background: 'var(--bg-primary)',
                        border: '1px solid var(--border)',
                        borderRadius: 8, padding: '10px 14px',
                        textAlign: 'center',
                      }}>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, fontWeight: 600 }}>
                          {p.store_name}
                        </div>
                        <div style={{ fontSize: 18, fontWeight: 800, color: '#F59E0B' }}>
                          ${Number(p.price).toFixed(4)}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>/ {material.unit}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Quick action ── */}
              {onNavigateInventory && (
                <div className="drawer-section">
                  <button
                    className="btn btn-primary"
                    style={{ width: '100%', padding: '11px' }}
                    onClick={() => { onNavigateInventory(material); onClose() }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Record Movement (In / Out)
                  </button>
                </div>
              )}

              {/* ── Transaction history ── */}
              <div className="drawer-section" style={{ flex: 1, minHeight: 0 }}>
                <div className="drawer-section-title">
                  Recent Transactions
                  {transactions.length > 0 && (
                    <span style={{ marginLeft: 6, fontWeight: 400, fontSize: 11, color: 'var(--text-muted)' }}>
                      (last {Math.min(transactions.length, 20)})
                    </span>
                  )}
                </div>
                {txLoading ? (
                  <div style={{ textAlign: 'center', padding: '40px 0' }}>
                    <div className="spinner" style={{ width: 24, height: 24, margin: '0 auto' }} />
                  </div>
                ) : transactions.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)', fontSize: 13 }}>
                    No transactions recorded yet
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {transactions.slice(0, 20).map(tx => {
                      const isIn = tx.type?.toUpperCase() === 'IN'
                      const coverage = computeTransactionCoverage(material, tx.sheet_size, tx.quantity)
                      const showCoverage = coverage !== tx.quantity
                      const lineTotal = tx.unit_price ? tx.unit_price * coverage : null
                      return (
                        <div key={tx.id} style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '9px 12px',
                          background: 'var(--bg-primary)',
                          border: `1px solid ${isIn ? 'rgba(34,197,94,0.15)' : 'rgba(220,38,38,0.15)'}`,
                          borderRadius: 8,
                          fontSize: 12,
                        }}>
                          <span className={isIn ? 'type-in' : 'type-out'} style={{ flexShrink: 0 }}>
                            {isIn ? '↑ In' : '↓ Out'}
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <strong style={{ color: isIn ? 'var(--green-light)' : 'var(--red-light)' }}>
                                {isIn ? '+' : '-'}{tx.quantity} {physicalUnitLabel}
                              </strong>
                              {showCoverage && (
                                <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                                  = {coverage} {material.unit}
                                </span>
                              )}
                              {tx.sheet_size && (
                                <span style={{
                                  fontSize: 10, fontFamily: 'monospace', fontWeight: 700,
                                  background: 'rgba(96,165,250,0.15)', color: '#60A5FA',
                                  padding: '1px 6px', borderRadius: 4,
                                }}>{tx.sheet_size}</span>
                              )}
                              {tx.project_name && (
                                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                  📍 {tx.project_name}
                                </span>
                              )}
                            </div>
                            <div style={{ color: 'var(--text-muted)', marginTop: 2, fontSize: 11 }}>
                              {formatDate(tx.created_at)}
                              {tx.store_name ? ` · ${tx.store_name}` : ''}
                              {tx.notes ? ` · ${tx.notes}` : ''}
                            </div>
                          </div>
                          {lineTotal !== null && (
                            <span style={{ fontWeight: 700, color: '#F59E0B', flexShrink: 0, fontSize: 13 }}>
                              ${lineTotal.toFixed(2)}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

            </div>
          </>
        )}
      </aside>
    </>
  )
}
