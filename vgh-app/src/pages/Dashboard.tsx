import { useState, useEffect } from 'react'
import { supabase, type Material } from '../lib/supabase'
import MaterialDetailDrawer from '../components/MaterialDetailDrawer'
import { aggregateStock, formatMaterialQuantity } from '../utils/materialQuantity'

// Category groups
const CATEGORY_GROUPS = [
  { label: 'All',           match: (_: string) => true },
  { label: 'Drywall',       match: (c: string) => c === 'Drywall' },
  { label: 'Insulation',    match: (c: string) => c === 'Insulation' },
  { label: 'Steel Framing', match: (c: string) => c.startsWith('Steel Framing') || c.startsWith('Channels') || c.startsWith('CT Stud') },
  { label: 'Tape & Mud',    match: (c: string) => c === 'Tape & Mud' },
  { label: 'T-Bar Ceiling', match: (c: string) => c === 'T-Bar Ceiling' },
  { label: 'Accessories',   match: (c: string) => c === 'Accessories' },
  { label: 'Fasteners',     match: (c: string) => c === 'Fasteners' },
  { label: 'Adhesives',     match: (c: string) => c.startsWith('Adhesives') },
  { label: 'Labour',        match: (c: string) => c === 'Labour' },
  { label: 'Equipment',     match: (c: string) => c.startsWith('Equipment') },
]

interface DashboardProps {
  onNavigateInventory?: (material: Material) => void
}

export default function Dashboard({ onNavigateInventory }: DashboardProps) {
  const [materials, setMaterials] = useState<Material[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [categoryLabel, setCategoryLabel] = useState('All')
  const [alertOnly, setAlertOnly] = useState(false)
  const [selectedMaterial, setSelectedMaterial] = useState<Material | null>(null)

  useEffect(() => { fetchMaterials() }, [])

  async function fetchMaterials() {
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('materials')
      .select('*')
      .order('name')
    if (err) { setError(err.message); setLoading(false); return }
    setMaterials(data || [])
    setLoading(false)
  }

  const group = CATEGORY_GROUPS.find(g => g.label === categoryLabel) ?? CATEGORY_GROUPS[0]
  const searchLower = search.toLowerCase()

  const filtered = materials.filter(m => {
    if (searchLower && !m.code.toLowerCase().includes(searchLower) && !m.name.toLowerCase().includes(searchLower)) return false
    if (!group.match(m.category)) return false
    if (alertOnly && m.current_stock >= m.min_stock_alert) return false
    return true
  })

  const statsSource = (categoryLabel !== 'All' || searchLower !== '' || alertOnly) ? filtered : materials;
  const alerts = statsSource.filter(m => m.current_stock < m.min_stock_alert)
  const totalStockStr = aggregateStock(statsSource, categoryLabel !== 'All' ? categoryLabel : null)
  const categoryCount = new Set(statsSource.map(m => m.category)).size
  const isFiltered = statsSource !== materials;

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        <div className="page-header">
          <div>
            <h2>Dashboard</h2>
            <p>Inventory overview — {materials.length} materials</p>
          </div>
          <div className="search-wrapper">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              className="form-control"
              placeholder="Search code or name..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="page-body">
          {/* Stats */}
          <div className="stats-row">
            <div className="stat-card">
              <div className="label">Total Materials</div>
              <div className="value">{statsSource.length}</div>
            </div>
            <div className="stat-card">
              <div className="label">Total In Stock</div>
              <div className="value green" style={{ fontSize: totalStockStr.length > 8 ? 16 : undefined }}>{totalStockStr}</div>
            </div>
            <div className="stat-card">
              <div className="label">Critical Alerts</div>
              <div className="value red">{alerts.length}</div>
            </div>
            {(!isFiltered || categoryCount > 1) && (
              <div className="stat-card">
                <div className="label">Categories</div>
                <div className="value">{categoryCount}</div>
              </div>
            )}
          </div>

          {/* Filters */}
          <div style={{ marginBottom: 16, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="filter-chips" style={{ marginBottom: 0, flex: 1 }}>
              {CATEGORY_GROUPS.map(g => (
                <button
                  key={g.label}
                  className={`chip ${categoryLabel === g.label ? 'active' : ''}`}
                  onClick={() => setCategoryLabel(g.label)}
                >{g.label}</button>
              ))}
            </div>
            <button
              className={`btn ${alertOnly ? 'btn-danger' : 'btn-outline'}`}
              onClick={() => setAlertOnly(a => !a)}
            >
              ⚠ {alertOnly ? 'Show All' : 'Alerts Only'}
            </button>
          </div>

          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
            {filtered.length} {filtered.length === 1 ? 'material' : 'materials'}
            {categoryLabel !== 'All' ? ` in "${categoryLabel}"` : ''}
            <span style={{ marginLeft: 8, color: 'var(--text-muted)', opacity: 0.7 }}>
              · Click any card to view details
            </span>
          </p>

          {error && (
            <div style={{ background: 'rgba(220,38,38,0.1)', border: '1px solid var(--red)', borderRadius: 8, padding: 16, color: 'var(--red)', marginBottom: 16 }}>
              Error loading: {error}
            </div>
          )}

          {/* Grid */}
          {loading ? (
            <div className="loader"><div className="spinner" /></div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
              <h3>No materials found</h3>
              <p>Try another filter or search</p>
            </div>
          ) : (
            <div className="card-grid">
              {filtered.map(m => {
                const isAlert = m.current_stock < m.min_stock_alert
                const dual = formatMaterialQuantity(m.current_stock, m.unit ?? '', m.category ?? '', { width: m.width, length: m.length })
                
                // Extract primary number from primary string to keep the style decoupled
                const primaryMatch = dual.primary.match(/^([\d.,]+)\s*(.*)$/)
                const primaryVal = primaryMatch ? primaryMatch[1] : dual.primary
                const primaryUnit = primaryMatch ? primaryMatch[2] : ''

                const isSelected = selectedMaterial?.id === m.id

                return (
                  <button
                    key={m.id}
                    className={`material-card interactive ${isAlert ? 'alert' : ''} ${isSelected ? 'selected' : ''}`}
                    onClick={() => setSelectedMaterial(m)}
                    title={`Click to view ${m.name} details`}
                  >
                    {/* Code badge */}
                    <span className="code">{m.code}</span>

                    {/* Name */}
                    <h3>{m.name}</h3>

                    {/* Category */}
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>{m.category}</div>

                    {/* Stock display */}
                    <div className="stock-row">
                      <div>
                        <span className="stock-badge">{primaryVal}</span>
                        {' '}
                        <span className="unit-tag">{primaryUnit}</span>
                      </div>
                    </div>

                    {/* Secondary display (sheet equivalent for sqft materials) */}
                    {dual.secondary && (
                      <div style={{
                        marginTop: 4, fontSize: 10, color: '#60A5FA',
                        fontWeight: 600, letterSpacing: '0.2px',
                      }}>
                        {dual.secondary}
                      </div>
                    )}

                    {/* Alert badge */}
                    {isAlert && (
                      <div style={{ marginTop: 8 }}>
                        <span className="alert-badge">⚠ ALERT</span>
                      </div>
                    )}

                    {/* "View details" hint on hover */}
                    <div className="card-hover-hint">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 12, height: 12 }}>
                        <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      View details
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Detail Drawer */}
      <MaterialDetailDrawer
        material={selectedMaterial}
        onClose={() => setSelectedMaterial(null)}
        onNavigateInventory={onNavigateInventory}
      />
    </>
  )
}
