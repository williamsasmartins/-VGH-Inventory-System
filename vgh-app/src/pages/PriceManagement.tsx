import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, type Material, type MaterialPrice } from '../lib/supabase'
import { UnitBadge } from '../components/UnitBadge'

const VENDORS = ['Kenroc', 'Pacific West', 'Dryco']

type PriceEdit = { price: string; isNew: boolean }

interface Props {
  showToast: (message: string, type: 'success' | 'error') => void
}

async function fetchMaterials(): Promise<Material[]> {
  const { data, error } = await supabase
    .from('materials')
    .select('*')
    .order('category', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw error
  return (data as Material[]) || []
}

async function fetchPrices(vendor: string): Promise<MaterialPrice[]> {
  const { data, error } = await supabase
    .from('material_prices')
    .select('*')
    .eq('store_name', vendor)
  if (error) throw error
  return (data as MaterialPrice[]) || []
}

async function upsertPrices(rows: { material_code: string; store_name: string; price: number }[]) {
  const { error } = await supabase
    .from('material_prices')
    .upsert(rows, { onConflict: 'material_code,store_name' })
  if (error) throw error
}

export default function PriceManagement({ showToast }: Props) {
  const [vendor, setVendor] = useState(VENDORS[0])
  const [search, setSearch] = useState('')
  const [edits, setEdits] = useState<Record<string, PriceEdit>>({})

  const queryClient = useQueryClient()

  const { data: materials = [], isLoading: loadingMaterials } = useQuery({
    queryKey: ['materials'],
    queryFn: fetchMaterials,
  })

  const { data: prices = [], isLoading: loadingPrices } = useQuery({
    queryKey: ['prices', vendor],
    queryFn: () => fetchPrices(vendor),
  })

  const priceMap = useMemo(() => {
    const m: Record<string, number> = {}
    for (const p of prices) m[p.material_code] = p.price
    return m
  }, [prices])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return materials.filter(m =>
      q === '' ||
      m.name.toLowerCase().includes(q) ||
      m.code.toLowerCase().includes(q) ||
      m.category.toLowerCase().includes(q)
    )
  }, [materials, search])

  function handlePriceChange(code: string, value: string) {
    const isNew = priceMap[code] === undefined
    setEdits(prev => ({ ...prev, [code]: { price: value, isNew } }))
  }

  function getDisplayPrice(code: string): string {
    if (edits[code] !== undefined) return edits[code].price
    return priceMap[code] !== undefined ? String(priceMap[code]) : ''
  }

  const editCount = Object.keys(edits).length

  const mutation = useMutation({
    mutationFn: upsertPrices,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prices', vendor] })
      setEdits({})
      showToast(`Saved ${editCount} price${editCount !== 1 ? 's' : ''} for ${vendor}`, 'success')
    },
    onError: (err: Error) => {
      showToast(`Save failed: ${err.message}`, 'error')
    },
  })

  function handleSave() {
    const rows = Object.entries(edits)
      .map(([code, edit]) => {
        const num = parseFloat(edit.price)
        if (isNaN(num) || num < 0) return null
        return { material_code: code, store_name: vendor, price: num }
      })
      .filter((r): r is { material_code: string; store_name: string; price: number } => r !== null)

    if (rows.length === 0) {
      showToast('No valid prices to save', 'error')
      return
    }
    mutation.mutate(rows)
  }

  function handleVendorChange(v: string) {
    setVendor(v)
    setEdits({})
  }

  const loading = loadingMaterials || loadingPrices

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div className="page-header">
        <div>
          <h2>Price Management</h2>
          <p>{filtered.length} materials · {prices.length} prices on file for {vendor}</p>
        </div>
        {editCount > 0 && (
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? (
              <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            Save {editCount} Change{editCount !== 1 ? 's' : ''}
          </button>
        )}
      </div>

      <div className="page-body">
        {/* Vendor + Search toolbar */}
        <div className="mb-5 overflow-hidden rounded-card border border-border-base bg-bg-card">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border-base px-3.5 py-3">
            {/* Vendor chips */}
            <div className="flex gap-2 shrink-0">
              {VENDORS.map(v => (
                <button
                  key={v}
                  type="button"
                  onClick={() => handleVendorChange(v)}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 20,
                    fontSize: 13,
                    fontWeight: 600,
                    border: vendor === v ? '1.5px solid var(--blue-accent)' : '1.5px solid var(--border-base)',
                    background: vendor === v ? 'rgba(96,165,250,0.12)' : 'transparent',
                    color: vendor === v ? '#60A5FA' : 'var(--text-muted)',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  {v}
                </button>
              ))}
            </div>

            {/* Search */}
            <div className="search-wrapper min-w-0 flex-1 basis-44">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
              </svg>
              <input
                className="form-control"
                placeholder="Search material name, code or category..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ paddingLeft: 36 }}
              />
            </div>

            {editCount > 0 && (
              <button
                type="button"
                className="btn btn-outline shrink-0 text-xs"
                onClick={() => setEdits({})}
                style={{ padding: '6px 12px' }}
              >
                ✕ Discard changes
              </button>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {loading ? (
            <div className="loader"><div className="spinner" /></div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <h3>No materials found</h3>
              <p>Try adjusting your search</p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Material</th>
                    <th>Category</th>
                    <th>Unit</th>
                    <th style={{ textAlign: 'right', width: 180 }}>Price / Unit ($)</th>
                    <th style={{ width: 80 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(mat => {
                    const editEntry = edits[mat.code]
                    const hasEdit = editEntry !== undefined
                    const isNew = hasEdit && editEntry.isNew
                    const displayVal = getDisplayPrice(mat.code)

                    return (
                      <tr key={mat.code}>
                        <td>
                          <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--green-light)', fontSize: 12 }}>
                            {mat.code}
                          </span>
                        </td>
                        <td style={{ fontSize: 13, maxWidth: 220 }}>{mat.name}</td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{mat.category}</td>
                        <td><UnitBadge unit={mat.unit} /></td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>$</span>
                            <input
                              type="number"
                              min="0"
                              step="0.0001"
                              className="form-control"
                              value={displayVal}
                              placeholder="—"
                              onChange={e => handlePriceChange(mat.code, e.target.value)}
                              style={{
                                width: 110,
                                textAlign: 'right',
                                fontFamily: 'monospace',
                                fontWeight: 600,
                                fontSize: 13,
                                border: hasEdit ? '1.5px solid rgba(245,158,11,0.5)' : undefined,
                                color: hasEdit ? '#F59E0B' : undefined,
                              }}
                            />
                          </div>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {hasEdit && (
                            <span style={{
                              display: 'inline-block',
                              padding: '2px 7px',
                              borderRadius: 4,
                              fontSize: 10,
                              fontWeight: 700,
                              letterSpacing: '0.4px',
                              textTransform: 'uppercase',
                              background: isNew ? 'rgba(96,165,250,0.12)' : 'rgba(245,158,11,0.12)',
                              color: isNew ? '#60A5FA' : '#F59E0B',
                              border: isNew ? '1px solid rgba(96,165,250,0.3)' : '1px solid rgba(245,158,11,0.3)',
                            }}>
                              {isNew ? 'NEW' : 'EDITED'}
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
