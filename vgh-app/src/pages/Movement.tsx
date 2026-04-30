import { useState, useRef, useCallback, useEffect } from 'react'
import { supabase, type Material } from '../lib/supabase'
import { getMaterialConfig, TILE_CODES } from '../utils/materialConfig'

const STORES = ['Kenroc', 'Pacific West', 'Dryco']
const DRAFT_KEY = 'vgh_movement_draft'

// Lazy-read localStorage on every mount (survives SPA nav)
function getDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') }
  catch { return null }
}

// ── Types ────────────────────────────────────────────────────────────────────
type MovementLine = {
  id: string
  material: Material
  physicalCount: number   // physical pieces (sheets / pcs / tiles)
  coverage: number        // sqft or lnft — used only for cost & display
  sizeLabel: string | null
  unitPrice: number | null
  store: string
}

interface MovementProps {
  showToast: (msg: string, type: 'success' | 'error') => void
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function newId() { return Math.random().toString(36).slice(2) }

const TILE_SQFT: Record<string, number> = { "2'x2'": 4, "2'x4'": 8 }

// ── Component ────────────────────────────────────────────────────────────────
export default function Movement({ showToast }: MovementProps) {

  // ── Session-level fields (rehydrated from localStorage draft) ────────────
  const [type,        setType]        = useState<'IN' | 'OUT'>(() => (getDraft()?.type === 'IN' ? 'IN' : 'OUT'))
  const [projectName, setProjectName] = useState<string>(() => getDraft()?.projectName ?? '')
  const [employee,    setEmployee]    = useState<string>(() => getDraft()?.employee ?? '')
  const [date,        setDate]        = useState<string>(() => getDraft()?.date ?? new Date().toISOString().slice(0, 10))
  const [notes,       setNotes]       = useState<string>(() => getDraft()?.notes ?? '')
  const [store,       setStore]       = useState<string>(() => {
    const d = getDraft()?.store
    return STORES.includes(d) ? d : 'Kenroc'
  })

  // ── Line items ────────────────────────────────────────────────────────────
  const [lines, setLines] = useState<MovementLine[]>(() => {
    const d = getDraft()?.lines
    return Array.isArray(d) ? d : []
  })

  // ── Edit mode: id of the line currently being edited (null = adding new) ─
  const [editingId, setEditingId] = useState<string | null>(() => getDraft()?.editingId ?? null)

  // ── Add-item form (rehydrated from draft so in-progress work survives nav) ─
  const [codeInput,        setCodeInput]        = useState<string>(() => getDraft()?.codeInput ?? '')
  const [suggestions,      setSuggestions]      = useState<Material[]>([])
  const [showDropdown,     setShowDropdown]      = useState(false)
  const [selectedMaterial, setSelectedMaterial] = useState<Material | null>(() => getDraft()?.selectedMaterial ?? null)
  const [qty,              setQty]              = useState<string>(() => getDraft()?.qty ?? '')
  const [sizeLabel,        setSizeLabel]        = useState<string | null>(() => getDraft()?.sizeLabel ?? null)
  const [unitPrice,        setUnitPrice]        = useState<number | null>(() => getDraft()?.unitPrice ?? null)
  const [highlightedIdx,   setHighlightedIdx]   = useState(-1)
  const [saving,           setSaving]           = useState(false)

  const inputRef    = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Auto-save draft whenever tracked state changes ───────────────────────
  // Restores on navigation back to this page; cleared on successful save/clear.
  // Also persists the in-progress Add Item form so a typed-but-not-added
  // material + quantity aren't lost when the user switches tabs.
  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      // Committed state
      type, projectName, employee, date, notes, store, lines,
      // In-progress Add Item form
      codeInput, selectedMaterial, qty, sizeLabel, unitPrice, editingId,
    }))
  }, [type, projectName, employee, date, notes, store, lines,
      codeInput, selectedMaterial, qty, sizeLabel, unitPrice, editingId])

  // Derived
  const matConfig  = selectedMaterial ? getMaterialConfig(selectedMaterial) : null
  const isTile     = selectedMaterial ? TILE_CODES.has(selectedMaterial.code) : false
  const hasSizes   = !isTile && matConfig !== null && matConfig.sizes.length > 0
  const tileOptions = ["2'x2'", "2'x4'"] as const

  const qtyNum = qty === '' ? 0 : parseFloat(qty)

  // Effective qty in base units (sqft / lnft / pcs):
  // - Tile codes (ct, DWT): pieces × tile area (sqft)
  // - Drywall (factor > 1): sheets × sqft/sheet (e.g. 10 sheets × 32 sqft = 320 sqft)
  // - Linear materials (factor = 1): pieces × length in feet (e.g. 10 pcs × 10' = 100 lnft)
  // - Everything else: raw qty
  const sizeFactor = (() => {
    if (!sizeLabel) return 1
    if (isTile) return TILE_SQFT[sizeLabel] ?? 1
    if (hasSizes && matConfig) {
      const opt = matConfig.sizes.find(s => s.label === sizeLabel)
      if (!opt) return 1
      // Drywall: factor encodes sqft/sheet (e.g. 32)
      if (opt.factor > 1) return opt.factor
      // Linear: factor = 1 but label is feet (e.g. "10'" → 10 lnft per piece)
      const feet = parseFloat(sizeLabel)
      return isNaN(feet) ? 1 : feet
    }
    return 1
  })()

  const effectiveQty = qtyNum * sizeFactor

  // ── Search materials ──────────────────────────────────────────────────────
  const searchMaterials = useCallback(async (q: string) => {
    if (!q.trim()) { setSuggestions([]); setShowDropdown(false); return }
    const [byCode, byName] = await Promise.all([
      supabase.from('materials').select('*').ilike('code', `%${q}%`).order('code').limit(10),
      supabase.from('materials').select('*').ilike('name', `%${q}%`).order('name').limit(10),
    ])
    const seen = new Set<string>()
    const merged = [...(byCode.data || []), ...(byName.data || [])].filter(m => {
      if (seen.has(m.id)) return false; seen.add(m.id); return true
    }).slice(0, 10)
    setSuggestions(merged)
    setShowDropdown(true)
    setHighlightedIdx(-1)
  }, [])

  function handleCodeChange(val: string) {
    setCodeInput(val)
    setSelectedMaterial(null)
    setSizeLabel(null)
    setUnitPrice(null)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => searchMaterials(val), 200)
  }

  async function selectMaterial(m: Material) {
    setSelectedMaterial(m)
    setCodeInput(`${m.code} — ${m.name}`)
    setSuggestions([])
    setShowDropdown(false)
    setSizeLabel(isTileCode(m.code) ? "2'x2'" : (getMaterialConfig(m)?.defaultSizeLabel ?? null))
    // Fetch price for current store
    const { data } = await supabase.from('material_prices').select('price')
      .eq('material_code', m.code).eq('store_name', store).maybeSingle()
    setUnitPrice(data?.price ? parseFloat(data.price) : null)
  }

  function isTileCode(code: string) { return TILE_CODES.has(code) }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!showDropdown || suggestions.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlightedIdx(i => Math.min(i + 1, suggestions.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlightedIdx(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      if (highlightedIdx >= 0) selectMaterial(suggestions[highlightedIdx])
      else if (suggestions.length === 1) selectMaterial(suggestions[0])
    }
    else if (e.key === 'Escape') setShowDropdown(false)
  }

  function addLine() {
    if (!selectedMaterial) { showToast('Select a material', 'error'); return }
    if (qtyNum <= 0)        { showToast('Enter a valid quantity', 'error'); return }
    if ((isTile || hasSizes) && !sizeLabel) { showToast('Select a size', 'error'); return }

    const payload: Omit<MovementLine, 'id'> = {
      material: selectedMaterial,
      physicalCount: qtyNum,
      coverage: effectiveQty,
      sizeLabel,
      unitPrice,
      store,
    }

    if (editingId) {
      // Replace the line being edited (keep its id for stable React keys)
      setLines(prev => prev.map(l => l.id === editingId ? { ...payload, id: editingId } : l))
      setEditingId(null)
      showToast('Item updated', 'success')
    } else {
      setLines(prev => [...prev, { ...payload, id: newId() }])
    }

    // Reset add-item form but keep project/date/type
    setCodeInput('')
    setSelectedMaterial(null)
    setSuggestions([])
    setQty('')
    setSizeLabel(null)
    setUnitPrice(null)
    inputRef.current?.focus()
  }

  function editLine(id: string) {
    const line = lines.find(l => l.id === id)
    if (!line) return
    setEditingId(id)
    setSelectedMaterial(line.material)
    setCodeInput(`${line.material.code} — ${line.material.name}`)
    setQty(String(line.physicalCount))
    setSizeLabel(line.sizeLabel)
    setUnitPrice(line.unitPrice)
    setShowDropdown(false)
    setSuggestions([])
    // Bring the form into view so the user can see what they're editing
    setTimeout(() => inputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50)
  }

  function cancelEdit() {
    setEditingId(null)
    setCodeInput('')
    setSelectedMaterial(null)
    setSuggestions([])
    setQty('')
    setSizeLabel(null)
    setUnitPrice(null)
  }

  function removeLine(id: string) {
    setLines(prev => prev.filter(l => l.id !== id))
    if (editingId === id) cancelEdit()
  }

  // ── Save all lines ────────────────────────────────────────────────────────
  async function handleSave() {
    if (lines.length === 0) { showToast('Add at least one item', 'error'); return }
    if (type === 'OUT' && !projectName.trim()) { showToast('Project name is required', 'error'); return }
    if (type === 'OUT' && !employee.trim()) { showToast('Employee name is required', 'error'); return }

    // Stock check for OUT
    if (type === 'OUT') {
      for (const line of lines) {
        if (line.physicalCount > line.material.current_stock) {
          showToast(`Insufficient stock for ${line.material.code}: available ${line.material.current_stock} pcs`, 'error')
          return
        }
      }
    }

    setSaving(true)

    const employeeNote = employee.trim() ? `Employee: ${employee.trim()}` : ''
    const notesText = [employeeNote, notes.trim()].filter(Boolean).join(' | ')

    const inserts = lines.map(line => ({
      material_id:   line.material.id,
      material_code: line.material.code,
      type:          type.toLowerCase() as 'in' | 'out',
      quantity:      line.physicalCount,        // physical pieces (sheets / pcs)
      sheet_size:    line.sizeLabel ?? null,     // size label for coverage calculation
      sheet_count:   line.physicalCount,         // alias kept for backward compat
      notes:         notesText || null,
      project_name:  type === 'OUT' ? projectName.trim() : null,
      unit_price:    line.unitPrice ?? null,
      store_name:    line.unitPrice !== null ? line.store : null,
      created_at:    new Date(date).toISOString(),
    }))

    const { error } = await supabase.from('transactions').insert(inserts)

    if (error) {
      console.error('Supabase error:', error)
      showToast(`Error: ${error.message}`, 'error')
      setSaving(false)
      return
    }

    // Update local stock using physical piece count
    for (const line of lines) {
      const delta = type === 'IN' ? line.physicalCount : -line.physicalCount
      await supabase.from('materials')
        .update({ current_stock: line.material.current_stock + delta })
        .eq('id', line.material.id)
    }

    showToast(`${type} recorded — ${lines.length} item${lines.length > 1 ? 's' : ''} saved`, 'success')
    setLines([])
    setProjectName('')
    setEmployee('')
    setNotes('')
    setDate(new Date().toISOString().slice(0, 10))
    setEditingId(null)
    // Clear persisted draft now that everything is committed
    localStorage.removeItem(DRAFT_KEY)
    setSaving(false)
  }

  const totalCost = lines.reduce((sum, l) => sum + (l.unitPrice !== null ? l.unitPrice * l.coverage : 0), 0)

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* Header */}
      <div className="page-header">
        <div><h2>Inventory</h2><p>Material tracking (In/Out)</p></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>PRICE LIST:</span>
          {STORES.map(s => (
            <button key={s} className={`chip ${store === s ? 'active' : ''}`}
              onClick={() => setStore(s)} style={{ fontSize: 12 }}>{s}</button>
          ))}
        </div>
      </div>

      <div className="page-body" style={{ overflowY: 'auto' }}>
        <div style={{ maxWidth: 680, margin: '0 auto' }}>

          {/* ── Session fields ── */}
          <div className="card" style={{ marginBottom: 20, padding: '20px 24px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>

              {/* Date */}
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Date</label>
                <input className="form-control" type="date" value={date}
                  onChange={e => setDate(e.target.value)} />
              </div>

              {/* Movement type */}
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Movement Type</label>
                <div className="toggle-group">
                  <button type="button" className={`toggle-btn ${type === 'IN' ? 'active-in' : ''}`}
                    onClick={() => setType('IN')}>↑ IN</button>
                  <button type="button" className={`toggle-btn ${type === 'OUT' ? 'active-out' : ''}`}
                    onClick={() => setType('OUT')}>↓ OUT</button>
                </div>
              </div>
            </div>

            {/* Project name + Employee */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Project Name {type === 'OUT' && <span style={{ color: 'var(--red)' }}>*</span>}</label>
                <input className="form-control"
                  placeholder="Eg: 1234 Main St - Renovation"
                  value={projectName}
                  onChange={e => setProjectName(e.target.value)} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Employee Name {type === 'OUT' && <span style={{ color: 'var(--red)' }}>*</span>}</label>
                <input className="form-control"
                  placeholder="Eg: John Silva"
                  value={employee}
                  onChange={e => setEmployee(e.target.value)} />
              </div>
            </div>
          </div>

          {/* ── Add / Edit item form ── */}
          <div className="card" style={{
            marginBottom: 20, padding: '20px 24px',
            borderColor: editingId ? 'rgba(245,158,11,0.5)' : 'rgba(96,165,250,0.3)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: editingId ? '#F59E0B' : '#60A5FA' }}>
                {editingId ? 'Edit Item' : 'Add Item'}
              </h3>
              {editingId && (
                <button type="button" onClick={cancelEdit}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}>
                  Cancel edit
                </button>
              )}
            </div>

            {/* Material search */}
            <div className="form-group">
              <label>Material Code / Name</label>
              <div className="autocomplete-wrapper" ref={dropdownRef} style={{ position: 'relative' }}>
                <input
                  ref={inputRef}
                  className="form-control"
                  placeholder="Type code or name... eg: 58tx"
                  value={codeInput}
                  onChange={e => handleCodeChange(e.target.value)}
                  onKeyDown={handleKeyDown}
                  autoComplete="off"
                />
                {showDropdown && suggestions.length > 0 && (
                  <div className="autocomplete-dropdown">
                    {suggestions.map((m, idx) => (
                      <div key={m.id}
                        className={`autocomplete-item ${idx === highlightedIdx ? 'highlighted' : ''}`}
                        onMouseDown={() => selectMaterial(m)}>
                        <span className="item-code">{m.code}</span>
                        <span className="item-name">{m.name}</span>
                        <span className="item-cat">{m.unit}</span>
                      </div>
                    ))}
                  </div>
                )}
                {showDropdown && suggestions.length === 0 && codeInput.trim() && (
                  <div className="autocomplete-dropdown">
                    <div className="autocomplete-item" style={{ color: 'var(--text-muted)', cursor: 'default' }}>No materials found</div>
                  </div>
                )}
              </div>

              {/* Selected material info */}
              {selectedMaterial && (
                <div className="selected-material" style={{ marginTop: 8 }}>
                  <div>
                    <div className="name">{selectedMaterial.name}</div>
                    <div className="meta">{selectedMaterial.category} · {selectedMaterial.unit}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
                    {unitPrice !== null && (
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>{store}/{selectedMaterial.unit}</div>
                        <div style={{ fontSize: 18, fontWeight: 800, color: '#F59E0B' }}>${unitPrice.toFixed(4)}</div>
                      </div>
                    )}
                    <div className="stock-info">
                      <div className="num">{selectedMaterial.current_stock}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>in stock</div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Tile size selector */}
            {isTile && selectedMaterial && (
              <div className="form-group">
                <label>Tile Size</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {tileOptions.map(sz => (
                    <button key={sz} type="button"
                      onClick={() => setSizeLabel(sz)}
                      style={{
                        flex: 1, padding: '8px', fontFamily: 'monospace', fontWeight: 800, fontSize: 14,
                        borderRadius: 8, cursor: 'pointer', border: '2px solid',
                        borderColor: sizeLabel === sz ? '#60A5FA' : 'var(--border)',
                        background: sizeLabel === sz ? 'rgba(96,165,250,0.15)' : 'var(--bg-secondary)',
                        color: sizeLabel === sz ? '#60A5FA' : 'var(--text-muted)',
                      }}>{sz}</button>
                  ))}
                </div>
              </div>
            )}

            {/* Linear size selector */}
            {hasSizes && selectedMaterial && (
              <div className="form-group">
                <label>{matConfig!.sizeLabel}</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {matConfig!.sizes.map(opt => (
                    <button key={opt.label} type="button"
                      onClick={() => setSizeLabel(opt.label)}
                      style={{
                        padding: '7px 16px', borderRadius: 8, cursor: 'pointer',
                        fontFamily: 'monospace', fontWeight: sizeLabel === opt.label ? 800 : 500,
                        fontSize: 14, border: '2px solid',
                        borderColor: sizeLabel === opt.label ? '#60A5FA' : 'var(--border)',
                        background: sizeLabel === opt.label ? 'rgba(96,165,250,0.15)' : 'var(--bg-secondary)',
                        color: sizeLabel === opt.label ? '#60A5FA' : 'var(--text-secondary)',
                      }}>{opt.label}</button>
                  ))}
                </div>
              </div>
            )}

            {/* Quantity + Add button */}
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
              <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                <label>
                  {(() => {
                    const factor = hasSizes && matConfig ? (matConfig.sizes.find(s => s.label === sizeLabel)?.factor ?? 0) : 0
                    return factor > 1 ? 'Number of Sheets' : hasSizes ? 'Number of Pieces' : 'Quantity'
                  })()}
                  {sizeLabel && qtyNum > 0 && effectiveQty !== qtyNum && (
                    <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>
                      = {effectiveQty} {selectedMaterial?.unit ?? ''}
                    </span>
                  )}
                </label>
                <input className="form-control" type="number" min="1" placeholder="0"
                  value={qty} onChange={e => setQty(e.target.value)}
                  style={{ fontSize: 20, fontWeight: 700 }}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLine() } }}
                />
              </div>
              <button type="button" className="btn btn-primary"
                style={{
                  padding: '10px 24px', marginBottom: 1,
                  background: editingId ? '#F59E0B' : undefined,
                  borderColor: editingId ? '#F59E0B' : undefined,
                }}
                onClick={addLine}>
                {editingId ? '✓ Update' : '+ Add'}
              </button>
            </div>
          </div>

          {/* ── Items list ── */}
          {lines.length > 0 && (
            <div className="card" style={{ marginBottom: 20, padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{lines.length} item{lines.length > 1 ? 's' : ''}</span>
                {totalCost > 0 && (
                  <span style={{ fontWeight: 900, fontSize: 18, color: '#F59E0B', fontFamily: 'monospace' }}>
                    ${totalCost.toFixed(2)}
                  </span>
                )}
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-secondary)' }}>
                    <th style={{ padding: '8px 16px', textAlign: 'left',   fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>CODE</th>
                    <th style={{ padding: '8px 8px',  textAlign: 'left',   fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>MATERIAL</th>
                    <th style={{ padding: '8px 8px',  textAlign: 'center', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>SIZE</th>
                    <th style={{ padding: '8px 8px',  textAlign: 'right',  fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>QTY (PCS)</th>
                    <th style={{ padding: '8px 8px',  textAlign: 'right',  fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>QTY (LNFT/SQFT)</th>
                    <th style={{ padding: '8px 8px',  textAlign: 'right',  fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>COST</th>
                    <th style={{ width: 64 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map(line => (
                    <tr key={line.id} style={{
                      borderBottom: '1px solid var(--border)',
                      background: editingId === line.id ? 'rgba(245,158,11,0.08)' : undefined,
                    }}>
                      <td style={{ padding: '10px 16px', fontFamily: 'monospace', fontWeight: 700, color: '#60A5FA', fontSize: 13 }}>
                        {line.material.code}
                      </td>
                      <td style={{ padding: '10px 8px', fontSize: 13 }}>{line.material.name}</td>
                      <td style={{ padding: '10px 8px', textAlign: 'center', fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                        {line.sizeLabel ?? '—'}
                      </td>
                      {/* QTY (PCS) — raw physical count entered by user */}
                      <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 700 }}>
                        {line.physicalCount}
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 3 }}>pcs</span>
                      </td>
                      {/* QTY (LNFT/SQFT) — calculated coverage */}
                      <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 700, color: '#60A5FA' }}>
                        {line.coverage !== line.physicalCount
                          ? <>{line.coverage} <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{line.material.unit}</span></>
                          : <span style={{ color: 'var(--text-muted)' }}>—</span>
                        }
                      </td>
                      <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 700, color: '#F59E0B' }}>
                        {line.unitPrice !== null ? `$${(line.unitPrice * line.coverage).toFixed(2)}` : '—'}
                      </td>
                      <td style={{ padding: '10px 8px', whiteSpace: 'nowrap' }}>
                        <button onClick={() => editLine(line.id)} title="Edit this item"
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: editingId === line.id ? '#F59E0B' : 'var(--text-muted)',
                            padding: '2px 4px', marginRight: 2,
                          }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ verticalAlign: 'middle' }}>
                            <path d="M12 20h9" strokeLinecap="round" />
                            <path d="M16.5 3.5a2.1 2.1 0 113 3L7 19l-4 1 1-4 12.5-12.5z" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                        <button onClick={() => removeLine(line.id)} title="Remove this item"
                          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14, padding: '2px 4px' }}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Notes ── */}
          <div className="form-group">
            <label>Notes (optional)</label>
            <input className="form-control" placeholder="Observations..."
              value={notes} onChange={e => setNotes(e.target.value)} />
          </div>

          {/* ── Save button ── */}
          <div style={{ display: 'flex', gap: 12 }}>
            <button
              type="button"
              className={`btn ${type === 'IN' ? 'btn-primary' : 'btn-danger'}`}
              style={{ flex: 1, padding: '14px', fontSize: 16, fontWeight: 700,
                background: type === 'OUT' ? '#DC2626' : undefined,
                opacity: saving || lines.length === 0 ? 0.6 : 1 }}
              disabled={saving || lines.length === 0}
              onClick={handleSave}
            >
              {saving ? 'Saving...' : `↓ Record ${type} (${lines.length} item${lines.length !== 1 ? 's' : ''})`}
            </button>
            <button type="button" className="btn btn-outline"
              onClick={() => {
                setLines([]); setProjectName(''); setEmployee(''); setNotes('')
                setCodeInput(''); setSelectedMaterial(null); setQty(''); setSizeLabel(null); setUnitPrice(null)
                setEditingId(null)
                localStorage.removeItem(DRAFT_KEY)
              }}>
              Clear
            </button>
          </div>

        </div>
      </div>
    </div>
  )
}
