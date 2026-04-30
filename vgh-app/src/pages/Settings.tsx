import { useState, useEffect } from 'react'
import { supabase, type Material } from '../lib/supabase'
import { MATERIAL_UNITS, CATEGORY_DEFAULT_UNIT, normalizeLegacyUnit, type MaterialUnit } from '../types/material'
import { UnitBadge } from '../components/UnitBadge'

interface SettingsProps {
  showToast: (msg: string, type: 'success' | 'error') => void
}

const CATEGORIES = ['Drywall', 'Insulation', 'Steel Framing', 'Tape & Mud', 'T-bar Ceiling', 'Accessories', 'Fasteners', 'Adhesives', 'Labour', 'Equipment']

export default function Settings({ showToast }: SettingsProps) {
  const [materials, setMaterials] = useState<Material[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [editingAlerts, setEditingAlerts] = useState<Record<string, number>>({})
  const [addMode, setAddMode] = useState(false)
  const [editingMaterial, setEditingMaterial] = useState<Material | null>(null)
  const [newMaterial, setNewMaterial] = useState({ code: '', name: '', category: CATEGORIES[0], unit: MATERIAL_UNITS[0] as MaterialUnit, min_stock_alert: 5, width: null as number | null, length: null as number | null, thickness: null as string | null })

  useEffect(() => { fetchMaterials() }, [])

  async function fetchMaterials() {
    setLoading(true)
    const { data } = await supabase.from('materials').select('*').order('category').order('name')
    setMaterials(data || [])
    setLoading(false)
  }

  async function saveAlert(materialId: string) {
    const val = editingAlerts[materialId]
    if (val === undefined) return
    const { error } = await supabase
      .from('materials')
      .update({ min_stock_alert: val })
      .eq('id', materialId)
    if (error) { showToast('Error updating alert', 'error'); return }
    setMaterials(m => m.map(mat => mat.id === materialId ? { ...mat, min_stock_alert: val } : mat))
    setEditingAlerts(e => { const copy = { ...e }; delete copy[materialId]; return copy })
    showToast('Alert limit updated', 'success')
  }

  async function addMaterial() {
    if (!newMaterial.code.trim() || !newMaterial.name.trim()) {
      showToast('Code and name are required', 'error'); return
    }
    const { error } = await supabase.from('materials').insert({
      code: newMaterial.code.trim(),
      name: newMaterial.name.trim(),
      category: newMaterial.category,
      unit: newMaterial.unit,
      min_stock_alert: newMaterial.min_stock_alert,
      width: newMaterial.width,
      length: newMaterial.length,
      thickness: newMaterial.thickness,
      current_stock: 0,
    })
    if (error) {
      if (error.code === '23505') showToast('Code already exists', 'error')
      else showToast('Error adding material', 'error')
      return
    }
    showToast('Material added successfully', 'success')
    setAddMode(false)
    setNewMaterial({ code: '', name: '', category: CATEGORIES[0], unit: MATERIAL_UNITS[0], min_stock_alert: 5, width: null, length: null, thickness: null })
    fetchMaterials()
  }

  async function saveMaterial() {
    if (!editingMaterial) return
    const { error } = await supabase.from('materials').update({
      name: editingMaterial.name,
      category: editingMaterial.category,
      unit: editingMaterial.unit,
      min_stock_alert: editingMaterial.min_stock_alert,
      width: editingMaterial.width,
      length: editingMaterial.length,
      thickness: editingMaterial.thickness,
    }).eq('id', editingMaterial.id)
    if (error) { showToast('Error saving', 'error'); return }
    showToast('Material updated', 'success')
    setMaterials(m => m.map(mat => mat.id === editingMaterial.id ? editingMaterial : mat))
    setEditingMaterial(null)
  }

  const filtered = materials.filter(m => {
    if (search === '') return true
    const q = search.toLowerCase()
    return (
      m.code.toLowerCase().includes(q) ||
      m.name.toLowerCase().includes(q) ||
      m.category.toLowerCase().includes(q)
    )
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div className="page-header">
        <div>
          <h2>Settings</h2>
          <p>Manage materials and alert limits</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setAddMode(true); setEditingMaterial(null) }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
          New Material
        </button>
      </div>

      <div className="page-body">
        {/* Add / Edit Form */}
        {(addMode || editingMaterial) && (
          <div className="card" style={{ marginBottom: 24, background: 'rgba(22,163,74,0.05)', borderColor: 'rgba(22,163,74,0.3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700 }}>{addMode ? 'Add Material' : 'Edit Material'}</h3>
              <button className="btn btn-outline" onClick={() => { setAddMode(false); setEditingMaterial(null) }}>Cancel</button>
            </div>
            <div className="two-cols">
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Code</label>
                <input
                  className="form-control"
                  placeholder="eg: 58tx"
                  value={addMode ? newMaterial.code : editingMaterial?.code || ''}
                  onChange={e => addMode
                    ? setNewMaterial(n => ({ ...n, code: e.target.value }))
                    : setEditingMaterial(m => m ? { ...m, code: e.target.value } : m)}
                  disabled={!addMode}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Name</label>
                <input
                  className="form-control"
                  placeholder="Material name"
                  value={addMode ? newMaterial.name : editingMaterial?.name || ''}
                  onChange={e => addMode
                    ? setNewMaterial(n => ({ ...n, name: e.target.value }))
                    : setEditingMaterial(m => m ? { ...m, name: e.target.value } : m)}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Category</label>
                <select
                  className="form-control"
                  value={addMode ? newMaterial.category : editingMaterial?.category || ''}
                  onChange={e => {
                    const cat = e.target.value
                    const defaultUnit = CATEGORY_DEFAULT_UNIT[cat] ?? 'Custom'
                    if (addMode) setNewMaterial(n => ({ ...n, category: cat, unit: defaultUnit }))
                    else setEditingMaterial(m => m ? { ...m, category: cat } : m)
                  }}
                >
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Unit</label>
                <select
                  className="form-control"
                  value={addMode ? newMaterial.unit : normalizeLegacyUnit(editingMaterial?.unit)}
                  onChange={e => {
                    const u = e.target.value as MaterialUnit
                    if (addMode) setNewMaterial(n => ({ ...n, unit: u }))
                    else setEditingMaterial(m => m ? { ...m, unit: u } : m)
                  }}
                >
                  {MATERIAL_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              
              {/* DIMENSIONS */}
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Length</label>
                <input
                  className="form-control"
                  type="number"
                  step="0.1"
                  min="0"
                  placeholder="e.g. 8"
                  value={addMode ? (newMaterial.length || '') : (editingMaterial?.length || '')}
                  onChange={e => {
                    const val = parseFloat(e.target.value) || null
                    if (addMode) setNewMaterial(n => ({ ...n, length: val }))
                    else setEditingMaterial(m => m ? { ...m, length: val } : m)
                  }}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Width</label>
                <input
                  className="form-control"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="e.g. 4"
                  value={addMode ? (newMaterial.width || '') : (editingMaterial?.width || '')}
                  onChange={e => {
                    const val = parseFloat(e.target.value) || null
                    if (addMode) setNewMaterial(n => ({ ...n, width: val }))
                    else setEditingMaterial(m => m ? { ...m, width: val } : m)
                  }}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Thickness</label>
                <input
                  className="form-control"
                  placeholder='e.g. 1/2"'
                  value={addMode ? (newMaterial.thickness || '') : (editingMaterial?.thickness || '')}
                  onChange={e => {
                    const val = e.target.value || null
                    if (addMode) setNewMaterial(n => ({ ...n, thickness: val }))
                    else setEditingMaterial(m => m ? { ...m, thickness: val } : m)
                  }}
                />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Alert Limit</label>
                <input
                  className="form-control"
                  type="number"
                  min="0"
                  value={addMode ? newMaterial.min_stock_alert : editingMaterial?.min_stock_alert ?? 5}
                  onChange={e => addMode
                    ? setNewMaterial(n => ({ ...n, min_stock_alert: parseInt(e.target.value) || 0 }))
                    : setEditingMaterial(m => m ? { ...m, min_stock_alert: parseInt(e.target.value) || 0 } : m)}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gridColumn: '1 / -1' }}>
                <button
                  className="btn btn-primary"
                  style={{ width: '100%', padding: '10px' }}
                  onClick={addMode ? addMaterial : saveMaterial}
                >
                  {addMode ? 'Add' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Search */}
        <div className="search-wrapper" style={{ maxWidth: 320, marginBottom: 16 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            className="form-control"
            placeholder="Search by code, name or category..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Materials table */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {loading ? (
            <div className="loader"><div className="spinner" /></div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="settings-table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Name</th>
                    <th>Category</th>
                    <th>Dims (L×W×T)</th>
                    <th>Un</th>
                    <th>Stock</th>
                    <th style={{ textAlign: 'center' }}>Min Alert</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(m => (
                    <tr key={m.id}>
                      <td>
                        <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--green-light)', fontSize: 12 }}>
                          {m.code}
                        </span>
                      </td>
                      <td>{m.name}</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{m.category}</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                        {[m.length, m.width, m.thickness].filter(Boolean).join(' × ') || '-'}
                      </td>
                      <td><UnitBadge unit={m.unit} /></td>
                      <td style={{ fontWeight: 700, color: m.current_stock < m.min_stock_alert ? 'var(--red)' : 'var(--green-light)' }}>
                        {m.current_stock}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {editingAlerts[m.id] !== undefined ? (
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'center' }}>
                            <input
                              className="inline-input"
                              type="number"
                              min="0"
                              value={editingAlerts[m.id]}
                              onChange={e => setEditingAlerts(ea => ({ ...ea, [m.id]: parseInt(e.target.value) || 0 }))}
                              onKeyDown={e => e.key === 'Enter' && saveAlert(m.id)}
                              autoFocus
                            />
                            <button className="btn btn-primary" style={{ padding: '4px 8px', fontSize: 12 }} onClick={() => saveAlert(m.id)}>✓</button>
                            <button className="btn btn-outline" style={{ padding: '4px 8px', fontSize: 12 }} onClick={() => setEditingAlerts(ea => { const c = { ...ea }; delete c[m.id]; return c })}>✕</button>
                          </div>
                        ) : (
                          <span
                            style={{ cursor: 'pointer', padding: '2px 8px', borderRadius: 4, background: 'var(--bg-hover)', fontSize: 13 }}
                            title="Click to edit"
                            onClick={() => setEditingAlerts(ea => ({ ...ea, [m.id]: m.min_stock_alert }))}
                          >
                            {m.min_stock_alert}
                          </span>
                        )}
                      </td>
                      <td>
                        <button
                          className="btn btn-outline"
                          style={{ padding: '4px 10px', fontSize: 12 }}
                          onClick={() => { setEditingMaterial(m); setAddMode(false) }}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
