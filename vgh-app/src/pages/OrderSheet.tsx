import { useState, useEffect, useCallback, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'
import { supabase, type Material } from '../lib/supabase'
import { getMaterialConfig, TILE_CODES } from '../utils/materialConfig'
import drtLogo from '../assets/drt-logo.svg'

// ─── Types ────────────────────────────────────────────────────────────────────

interface OrderRow {
  id: string
  code: string
  material: Material | null
  sizeLabel: string
  quantity: number | ''
}

interface SavedOrder {
  id: string
  project_name: string
  address: string | null
  delivery_date: string | null
  site_contact: string | null
  notes: string | null
  items: OrderRow[]
  total_cost: number | null
  created_at: string
}

interface JobInfo {
  projectName: string
  address: string
  deliveryDate: string
  contact: string
  notes: string
}

interface Props {
  showToast: (msg: string, type: 'success' | 'error') => void
}

// ─── Contact presets (Williams is primary) ────────────────────────────────────
const CONTACTS = {
  williams: 'Williams — williams@drtinteriors.com  |  236.515.3775',
  dave:     'Dave — Dave@drtinteriors.com  |  778.952.2177',
} as const
type ContactKey = keyof typeof CONTACTS
const DEFAULT_CONTACT: ContactKey = 'williams'

// ─── Draft persistence (survives page navigation) ────────────────────────────
const DRAFT_KEY = 'vgh_order_draft'
function getDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') }
  catch { return null }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const newRow = (): OrderRow => ({
  id: Math.random().toString(36).slice(2),
  code: '',
  material: null,
  sizeLabel: '',
  quantity: '',
})

function getSizeOptions(material: Material): string[] {
  if (TILE_CODES.has(material.code)) return ["2'x2'", "2'x4'"]
  const cfg = getMaterialConfig(material)
  if (!cfg) return []
  return cfg.sizes.map(s => s.label)
}

function getUnit(material: Material | null): string {
  if (!material) return ''
  const unit = (material.unit || '').toLowerCase()
  const name = (material.name || '').toLowerCase()
  const cat = (material.category || '').toLowerCase()
  if (TILE_CODES.has(material.code)) return 'boxes'
  if (unit === 'sqft' || unit === 'sq ft' || unit === 'sf') {
    if (name.includes('insul') || cat.includes('insul')) return 'sqft'
    return 'sheets'
  }
  if (name.includes('track') || cat.includes('track')) return 'pcs'
  if (name.includes('stud') || name.includes('framing') || name.includes('channel') || name.includes('furring')) return 'pcs'
  if (cat.includes('t-bar') || name.includes('ceiling tile')) return 'pcs'
  return 'pcs'
}

function formatDate(iso: string): string {
  try {
    const [y, m, d] = iso.split('-')
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    return `${months[Number(m) - 1]} ${Number(d)}, ${y}`
  } catch {
    return iso
  }
}

/**
 * Fetch /logo.png (same-origin, public folder) and return a base64 data URL.
 * Same-origin fetch avoids all CORS tainting issues that break canvas.toDataURL().
 */
async function fetchLogoPng(): Promise<string> {
  const res = await fetch('/logo.png')
  if (!res.ok) throw new Error(`logo fetch failed: ${res.status}`)
  const blob = await res.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function OrderSheet({ showToast }: Props) {
  // ── Rehydrate from localStorage on every mount ──────────────────────────────
  const [rows, setRows] = useState<OrderRow[]>(() => {
    const d = getDraft()?.rows
    return Array.isArray(d) && d.length > 0 ? d : [newRow()]
  })
  const [jobInfo, setJobInfo] = useState<JobInfo>(() => {
    const d = getDraft()?.jobInfo
    return d && typeof d === 'object' ? d : {
      projectName: '', address: '', deliveryDate: '',
      contact: CONTACTS[DEFAULT_CONTACT], notes: '',
    }
  })
  // Which contact preset is active (custom = user typed their own)
  const [contactKey, setContactKey] = useState<ContactKey | 'custom'>(() => {
    const d = getDraft()?.contactKey
    if (d === 'williams' || d === 'dave' || d === 'custom') return d
    return DEFAULT_CONTACT
  })
  // Id of the currently-loaded saved order (null = new unsaved order).
  // When set, Save performs an UPDATE instead of INSERT so edits don't duplicate.
  const [loadedOrderId, setLoadedOrderId] = useState<string | null>(() => {
    const d = getDraft()?.loadedOrderId
    return typeof d === 'string' ? d : null
  })

  const [editingContact, setEditingContact] = useState(false)
  const [savedOrders, setSavedOrders] = useState<SavedOrder[]>([])
  const [showLoadPanel, setShowLoadPanel] = useState(false)
  const [filterProject, setFilterProject] = useState('')
  const [saving, setSaving] = useState(false)
  const [loadingOrders, setLoadingOrders] = useState(false)
  const [prices, setPrices] = useState<Record<string, number>>({})
  const [logoPng, setLogoPng] = useState<string>('')

  // ── Autocomplete (Inventory-style dropdown) ─────────────────────────────────
  const [activeRowId, setActiveRowId] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<Material[]>([])
  const [highlightIdx, setHighlightIdx] = useState(-1)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const dropdownRef = useRef<HTMLDivElement>(null)

  // ── Persist draft whenever any tracked piece of state changes ───────────────
  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ rows, jobInfo, contactKey, loadedOrderId }))
  }, [rows, jobInfo, contactKey, loadedOrderId])

  // Fetch /logo.png as base64 once on mount — used by both PDF and UI fallback
  useEffect(() => {
    fetchLogoPng()
      .then(setLogoPng)
      .catch(() => { /* logo optional — export still works without it */ })
  }, [])

  // ─── Load materials ────────────────────────────────────────────────────────
  const { data: materials = [] } = useQuery<Material[]>({
    queryKey: ['materials'],
    queryFn: async () => {
      const { data, error } = await supabase.from('materials').select('*').order('name')
      if (error) throw error
      return data as Material[]
    },
  })

  // ─── Load prices (cheapest per code) ──────────────────────────────────────
  useEffect(() => {
    supabase.from('material_prices').select('material_code, price').then(({ data }) => {
      if (!data) return
      const map: Record<string, number> = {}
      for (const p of data) {
        if (!map[p.material_code] || p.price < map[p.material_code]) map[p.material_code] = p.price
      }
      setPrices(map)
    })
  }, [])

  // ─── Code lookup ──────────────────────────────────────────────────────────
  const lookupMaterial = useCallback((code: string): Material | null => {
    if (!code.trim()) return null
    return materials.find(m => m.code.toLowerCase() === code.trim().toLowerCase()) ?? null
  }, [materials])

  // ─── Row mutations ────────────────────────────────────────────────────────
  const updateRow = useCallback((id: string, changes: Partial<OrderRow>) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...changes } : r))
  }, [])

  // Attach a material to a row (computes default size label)
  const attachMaterial = useCallback((rowId: string, material: Material) => {
    const cfg = getMaterialConfig(material)
    const sizes = getSizeOptions(material)
    const defaultSize = cfg?.defaultSizeLabel ?? (sizes[0] || '')
    updateRow(rowId, { code: material.code, material, sizeLabel: defaultSize })
  }, [updateRow])

  // Live-search suggestions as the user types (code OR name), same UX as Inventory
  const onCodeChange = useCallback((rowId: string, value: string) => {
    updateRow(rowId, { code: value, material: null, sizeLabel: '' })
    setActiveRowId(rowId)
    const q = value.trim().toLowerCase()
    if (!q) { setSuggestions([]); setHighlightIdx(-1); setDropdownPos(null); return }
    // Position dropdown using fixed coords so overflow:auto on the table wrapper doesn't clip it
    const inputEl = inputRefs.current[rowId]
    if (inputEl) {
      const rect = inputEl.getBoundingClientRect()
      setDropdownPos({ top: rect.bottom + 2, left: rect.left, width: Math.max(rect.width, 280) })
    }
    const matches = materials.filter(m =>
      m.code.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)
    ).slice(0, 8)
    setSuggestions(matches)
    setHighlightIdx(-1)
  }, [materials, updateRow])

  // Fallback exact-match lookup on blur for typed-and-pasted codes
  const onCodeBlur = useCallback((rowId: string, code: string) => {
    // Delay so onMouseDown on a dropdown option can fire first
    setTimeout(() => {
      setActiveRowId(current => current === rowId ? null : current)
      setSuggestions([])
      setDropdownPos(null)
      const material = lookupMaterial(code)
      if (material) attachMaterial(rowId, material)
    }, 150)
  }, [lookupMaterial, attachMaterial])

  const onCodeKeyDown = useCallback((rowId: string, e: React.KeyboardEvent) => {
    if (activeRowId !== rowId || suggestions.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlightIdx(i => Math.min(i + 1, suggestions.length - 1)) }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); setHighlightIdx(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      const idx = highlightIdx >= 0 ? highlightIdx : 0
      const picked = suggestions[idx]
      if (picked) { attachMaterial(rowId, picked); setSuggestions([]); setActiveRowId(null); setDropdownPos(null) }
    }
    else if (e.key === 'Escape') { setSuggestions([]); setActiveRowId(null); setDropdownPos(null) }
  }, [activeRowId, suggestions, highlightIdx, attachMaterial])

  const addRow = () => setRows(prev => [...prev, newRow()])
  const removeRow = (id: string) =>
    setRows(prev => prev.length === 1 ? [newRow()] : prev.filter(r => r.id !== id))

  // ─── Derived ──────────────────────────────────────────────────────────────
  const filledRows = rows.filter(r => r.material && r.quantity && Number(r.quantity) > 0)

  const totalCost = filledRows.reduce((sum, r) => {
    return sum + (prices[r.material!.code] ?? 0) * Number(r.quantity)
  }, 0)

  // ─── Save ─────────────────────────────────────────────────────────────────
  // If a saved order was loaded, UPDATE the same row (no duplicates).
  // Otherwise INSERT and capture the new id so subsequent saves also update.
  const handleSave = async () => {
    if (!jobInfo.projectName.trim()) { showToast('Enter a project name before saving', 'error'); return }
    setSaving(true)
    const payload = {
      project_name: jobInfo.projectName.trim(),
      address: jobInfo.address || null,
      delivery_date: jobInfo.deliveryDate || null,
      site_contact: jobInfo.contact || null,
      notes: jobInfo.notes || null,
      items: rows,
      total_cost: totalCost || null,
    }
    try {
      if (loadedOrderId) {
        const { error } = await supabase.from('material_orders').update(payload).eq('id', loadedOrderId)
        if (error) throw error
        showToast('Order updated', 'success')
      } else {
        const { data, error } = await supabase.from('material_orders').insert(payload).select('id').single()
        if (error) throw error
        if (data?.id) setLoadedOrderId(data.id as string)
        showToast('Order saved', 'success')
      }
    } catch (e: unknown) {
      showToast((e as Error).message ?? 'Save failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  // ─── New Order: clear form and draft ──────────────────────────────────────
  const handleNewOrder = () => {
    const hasContent =
      jobInfo.projectName.trim() !== '' || jobInfo.address.trim() !== '' ||
      jobInfo.notes.trim() !== '' || rows.some(r => r.code || r.material || r.quantity !== '')
    if (hasContent && !window.confirm('Start a new order? All unsaved fields will be cleared.')) return

    setJobInfo({ projectName: '', address: '', deliveryDate: '', contact: CONTACTS[DEFAULT_CONTACT], notes: '' })
    setContactKey(DEFAULT_CONTACT)
    setRows([newRow()])
    setLoadedOrderId(null)
    setSuggestions([])
    setActiveRowId(null)
    setDropdownPos(null)
    localStorage.removeItem(DRAFT_KEY)
    showToast('New order started', 'success')
  }

  // ─── Load ─────────────────────────────────────────────────────────────────
  const handleLoadOrders = async () => {
    setLoadingOrders(true)
    setShowLoadPanel(true)
    try {
      const { data, error } = await supabase
        .from('material_orders').select('*')
        .order('created_at', { ascending: false }).limit(100)
      if (error) throw error
      setSavedOrders((data ?? []) as SavedOrder[])
    } catch (e: unknown) {
      showToast((e as Error).message ?? 'Load failed', 'error')
    } finally {
      setLoadingOrders(false)
    }
  }

  const loadOrder = (order: SavedOrder) => {
    const contact = order.site_contact ?? CONTACTS[DEFAULT_CONTACT]
    // Detect which preset (if any) the loaded contact matches
    const matchKey = (Object.entries(CONTACTS) as [ContactKey, string][])
      .find(([, v]) => v === contact)?.[0]
    setContactKey(matchKey ?? 'custom')
    setJobInfo({
      projectName: order.project_name,
      address: order.address ?? '',
      deliveryDate: order.delivery_date ?? '',
      contact,
      notes: order.notes ?? '',
    })
    const loadedRows: OrderRow[] = (order.items as OrderRow[]).map(item => ({
      ...item, material: lookupMaterial(item.code),
    }))
    setRows(loadedRows.length ? loadedRows : [newRow()])
    setLoadedOrderId(order.id)
    setShowLoadPanel(false)
    showToast(`Loaded: ${order.project_name}`, 'success')
  }

  // ─── Export Excel ─────────────────────────────────────────────────────────
  const handleExportExcel = () => {
    const aoa = [
      ['DRT INTERIORS LTD', '', '', ''],
      ['Material Order Sheet', '', '', ''],
      [],
      ['Job Name', jobInfo.projectName, 'Delivery Date', jobInfo.deliveryDate ? formatDate(jobInfo.deliveryDate) : ''],
      ['Address', jobInfo.address, 'Site Contact', jobInfo.contact],
      ...(jobInfo.notes ? [['Notes', jobInfo.notes, '', '']] : []),
      [],
      ['Description', 'Size', 'Quantity', 'Unit'],
      ...filledRows.map(r => [r.material?.name ?? r.code, r.sizeLabel || '', r.quantity, getUnit(r.material)]),
    ]

    const ws = XLSX.utils.aoa_to_sheet(aoa)
    ws['!cols'] = [{ wch: 38 }, { wch: 14 }, { wch: 14 }, { wch: 10 }]
    // Merge title cells
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 3 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 3 } },
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Order Sheet')
    const filename = `DRT_Order_${jobInfo.projectName || 'Sheet'}_${new Date().toISOString().slice(0, 10)}.xlsx`
    XLSX.writeFile(wb, filename)
  }

  // ─── Export PDF ────────────────────────────────────────────────────────────
  const handleExportPdf = () => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const pageW = doc.internal.pageSize.getWidth()
    const green: [number, number, number] = [22, 163, 74]

    // Green header band
    doc.setFillColor(...green)
    doc.rect(0, 0, pageW, 30, 'F')

    // Logo: PNG is black-on-white, so paint a white pill behind it
    const logoH = 11   // mm tall
    const logoW = logoH * (380 / 54)  // original SVG viewBox aspect ratio
    const logoX = (pageW - logoW) / 2
    const logoY = 4

    if (logoPng) {
      try {
        // White background rect so black logo text is visible on green
        doc.setFillColor(255, 255, 255)
        doc.roundedRect(logoX - 3, logoY - 1, logoW + 6, logoH + 2, 2, 2, 'F')
        doc.addImage(logoPng, 'PNG', logoX, logoY, logoW, logoH)
      } catch { /* skip */ }
    }

    // Subtitle
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.text('Material Order Sheet', pageW / 2, 26, { align: 'center' })

    // Job info block
    doc.setTextColor(40, 40, 40)
    let y = 36
    const labelColor: [number, number, number] = [100, 116, 139]
    const valueColor: [number, number, number] = [15, 23, 42]

    const infoItems = [
      ['Job Name', jobInfo.projectName || '—'],
      ['Delivery Date', jobInfo.deliveryDate ? formatDate(jobInfo.deliveryDate) : '—'],
      ['Address', jobInfo.address || '—'],
      ['Site Contact', jobInfo.contact],
      ...(jobInfo.notes ? [['Notes', jobInfo.notes]] as [string, string][] : []),
    ]

    // Two-column info grid — draw label then value with a fixed gap
    // Each row occupies 7mm; left col starts at x=14, right col at x=pageW/2+4
    const colX = [14, pageW / 2 + 4]
    const labelGap = 2  // extra space between colon and value (mm)

    infoItems.forEach((item, i) => {
      const col = i % 2
      // Advance y only when starting a new left-column row (after first row)
      if (col === 0 && i > 0) y += 7

      const x = colX[col]

      // Label (bold, muted colour)
      doc.setFontSize(7.5)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(...labelColor)
      const labelText = item[0] + ':'
      doc.text(labelText, x, y)

      // Value (normal, dark colour) — offset by label width + fixed gap
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(...valueColor)
      doc.text(item[1], x + doc.getTextWidth(labelText) + labelGap, y)
    })

    // Separator
    y += 10
    doc.setDrawColor(...green)
    doc.setLineWidth(0.5)
    doc.line(14, y, pageW - 14, y)
    y += 4

    // Items table
    autoTable(doc, {
      startY: y,
      head: [['Description', 'Size', 'Quantity', 'Unit']],
      body: filledRows.map(r => [
        r.material?.name ?? r.code,
        r.sizeLabel || '—',
        String(r.quantity),
        getUnit(r.material),
      ]),
      headStyles: {
        fillColor: green,
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 10,
      },
      bodyStyles: { fontSize: 9.5, textColor: [30, 30, 30] },
      alternateRowStyles: { fillColor: [246, 250, 246] },
      columnStyles: {
        0: { cellWidth: 80 },
        1: { cellWidth: 30 },
        2: { cellWidth: 30, halign: 'center' },
        3: { cellWidth: 20 },
      },
      margin: { left: 14, right: 14 },
    })

    // Footer
    const finalY = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable?.finalY ?? y + 20
    doc.setFontSize(8)
    doc.setTextColor(...labelColor)
    doc.text('DRT Interiors Ltd  —  Dave@drtinteriors.com  —  778.952.2177', pageW / 2, finalY + 8, { align: 'center' })

    const filename = `DRT_Order_${jobInfo.projectName || 'Sheet'}_${new Date().toISOString().slice(0, 10)}.pdf`
    doc.save(filename)
  }

  // ─── Print ─────────────────────────────────────────────────────────────────
  const handlePrint = () => window.print()

  const filteredOrders = savedOrders.filter(o =>
    !filterProject.trim() || o.project_name.toLowerCase().includes(filterProject.toLowerCase())
  )

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="page-content" style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '20px 24px' }}>

      {/* Top toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, flex: 1 }}>DRT Order Sheet</h1>
        <button className="btn-secondary" onClick={handleNewOrder} style={{ gap: 6, fontSize: 13 }} title="Clear all fields and start a new order">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" strokeLinecap="round" /><line x1="5" y1="12" x2="19" y2="12" strokeLinecap="round" /></svg>
          New
        </button>
        <button className="btn-secondary" onClick={handleLoadOrders} style={{ gap: 6, fontSize: 13 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7h18M3 12h18M3 17h18" strokeLinecap="round" /></svg>
          Load
        </button>
        <button className="btn-secondary" onClick={handleExportExcel} style={{ gap: 6, fontSize: 13 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><path d="M8 13l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Excel
        </button>
        <button className="btn-secondary" onClick={handleExportPdf} style={{ gap: 6, fontSize: 13 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="9" y1="15" x2="15" y2="15" /><line x1="9" y1="11" x2="15" y2="11" /></svg>
          PDF
        </button>
        <button className="btn-secondary" onClick={handlePrint} style={{ gap: 6, fontSize: 13 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></svg>
          Print
        </button>
        <button className="btn-primary" onClick={handleSave} disabled={saving} style={{ gap: 6, fontSize: 13 }} title={loadedOrderId ? 'Update the currently-loaded order' : 'Save as a new order'}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
          {saving ? 'Saving…' : (loadedOrderId ? 'Update' : 'Save Order')}
        </button>
      </div>

      {/* Two-column layout */}
      <div className="order-sheet-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>

        {/* ── LEFT: Input panel ── */}
        <div className="card order-input-panel" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ background: 'var(--green)', color: '#fff', padding: '10px 16px', fontWeight: 700, fontSize: 12, letterSpacing: '0.5px', textTransform: 'uppercase' }}>
            Order Input
          </div>

          {/* Job info fields */}
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>Project Name *</label>
                <input className="input" value={jobInfo.projectName} onChange={e => setJobInfo(j => ({ ...j, projectName: e.target.value }))} placeholder="e.g. VGH" style={{ width: '100%' }} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>Delivery Date</label>
                <input type="date" className="input" value={jobInfo.deliveryDate} onChange={e => setJobInfo(j => ({ ...j, deliveryDate: e.target.value }))} style={{ width: '100%' }} />
              </div>
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>Address</label>
              <input className="input" value={jobInfo.address} onChange={e => setJobInfo(j => ({ ...j, address: e.target.value }))} placeholder="Job site address" style={{ width: '100%' }} />
            </div>
            {/* Site Contact with two presets (Williams is primary) */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Site Contact</label>
                <button
                  onClick={() => setEditingContact(v => !v)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--green)', fontSize: 11, padding: 0 }}
                >
                  {editingContact ? 'Done' : 'Edit custom'}
                </button>
              </div>
              {/* Preset chips */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                {(['williams', 'dave'] as ContactKey[]).map(key => {
                  const active = contactKey === key
                  const label = key === 'williams' ? 'Williams (me)' : 'Dave'
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => { setContactKey(key); setJobInfo(j => ({ ...j, contact: CONTACTS[key] })); setEditingContact(false) }}
                      style={{
                        padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600,
                        border: '1px solid', cursor: 'pointer',
                        borderColor: active ? 'var(--green)' : 'var(--border)',
                        background: active ? 'var(--green)' : 'transparent',
                        color: active ? '#fff' : 'var(--text-secondary)',
                      }}
                    >
                      {label}{key === 'williams' && !active ? ' ★' : ''}
                    </button>
                  )
                })}
              </div>
              {editingContact ? (
                <input
                  className="input"
                  value={jobInfo.contact}
                  onChange={e => { setJobInfo(j => ({ ...j, contact: e.target.value })); setContactKey('custom') }}
                  placeholder="Name — email  |  phone"
                  style={{ width: '100%' }}
                />
              ) : (
                <div style={{ fontSize: 12, color: 'var(--text-primary)', padding: '6px 10px', background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 6 }}>
                  {jobInfo.contact || <span style={{ color: 'var(--text-muted)' }}>—</span>}
                </div>
              )}
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>Notes</label>
              <input className="input" value={jobInfo.notes} onChange={e => setJobInfo(j => ({ ...j, notes: e.target.value }))} placeholder="Special instructions…" style={{ width: '100%' }} />
            </div>
          </div>

          {/* Items table */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
                  {['Mat Code', 'Description', 'Size', 'Qty', ''].map(h => (
                    <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => {
                  const sizes = row.material ? getSizeOptions(row.material) : []
                  return (
                    <tr key={row.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '5px 8px', width: 110 }}>
                        <input
                          ref={el => { inputRefs.current[row.id] = el }}
                          className="input"
                          value={row.code}
                          onChange={e => onCodeChange(row.id, e.target.value)}
                          onFocus={() => { setActiveRowId(row.id); if (row.code) onCodeChange(row.id, row.code) }}
                          onBlur={e => onCodeBlur(row.id, e.target.value)}
                          onKeyDown={e => onCodeKeyDown(row.id, e)}
                          placeholder="Code or name"
                          style={{ width: '100%', padding: '4px 8px', fontSize: 13 }}
                          autoComplete="off"
                          autoFocus={idx === rows.length - 1 && idx > 0}
                        />
                      </td>
                      <td style={{ padding: '5px 8px', minWidth: 110 }}>
                        <span style={{ fontSize: 12, color: row.material ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                          {row.material?.name ?? (row.code ? '—' : '')}
                        </span>
                      </td>
                      <td style={{ padding: '5px 8px', width: 88 }}>
                        {sizes.length > 0 ? (
                          <select className="input" value={row.sizeLabel} onChange={e => updateRow(row.id, { sizeLabel: e.target.value })} style={{ width: '100%', padding: '4px 6px', fontSize: 13 }}>
                            {sizes.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        ) : (
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: '5px 8px', width: 68 }}>
                        <input
                          className="input"
                          type="number"
                          min={1}
                          value={row.quantity}
                          onChange={e => updateRow(row.id, { quantity: e.target.value === '' ? '' : Number(e.target.value) })}
                          placeholder="0"
                          style={{ width: '100%', padding: '4px 8px', fontSize: 13, textAlign: 'right' }}
                        />
                      </td>
                      <td style={{ padding: '5px 8px', width: 34 }}>
                        <button onClick={() => removeRow(row.id)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4, borderRadius: 4 }} title="Remove">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button className="btn-secondary" onClick={addRow} style={{ fontSize: 12, padding: '5px 12px' }}>+ Add Row</button>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              <span style={{ marginRight: 4 }}>Est. Cost (internal):</span>
              <span style={{ fontWeight: 700, color: totalCost > 0 ? 'var(--green)' : 'var(--text-muted)' }}>
                {totalCost > 0 ? `$${totalCost.toFixed(2)}` : '—'}
              </span>
            </div>
          </div>
        </div>

        {/* ── RIGHT: Supplier document ── */}
        <div className="card order-doc" style={{ padding: 0, overflow: 'hidden' }}>
          {/* Green header with logo */}
          <div style={{ background: 'var(--green)', padding: '12px 20px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            {/* Use the real PNG from /public — no CSS filter needed on white bg */}
            <img
              src="/logo.png"
              alt="DRT Interiors"
              style={{ height: 38, display: 'block', objectFit: 'contain' }}
              onError={e => { (e.currentTarget as HTMLImageElement).src = drtLogo }}
            />
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.85)', letterSpacing: '1px', textTransform: 'uppercase', fontWeight: 600 }}>
              Material Order Sheet
            </div>
          </div>

          {/* Job info box */}
          <div style={{ padding: '10px 16px', borderBottom: '2px solid var(--green)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px 16px', fontSize: 12 }}>
            <InfoRow label="Job Name" value={jobInfo.projectName || '—'} />
            <InfoRow label="Delivery Date" value={jobInfo.deliveryDate ? formatDate(jobInfo.deliveryDate) : '—'} />
            <InfoRow label="Address" value={jobInfo.address || '—'} />
            <InfoRow label="Site Contact" value={jobInfo.contact || '—'} />
            {jobInfo.notes && (
              <div style={{ gridColumn: '1 / -1' }}>
                <InfoRow label="Notes" value={jobInfo.notes} />
              </div>
            )}
          </div>

          {/* Order table */}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--green)' }}>
                {[['Description', 'left'], ['Size', 'left'], ['Quantity', 'center'], ['Unit', 'left']].map(([h, align]) => (
                  <th key={h} style={{ padding: '8px 14px', textAlign: align as 'left' | 'right', fontSize: 12, fontWeight: 700, color: '#fff' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filledRows.length === 0 ? (
                <tr><td colSpan={4} style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Fill in the input table to generate the order</td></tr>
              ) : (
                filledRows.map((row, i) => (
                  <tr key={row.id} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                    <td style={{ padding: '8px 14px', fontSize: 13 }}>{row.material?.name ?? row.code}</td>
                    <td style={{ padding: '8px 14px', fontSize: 13, color: row.sizeLabel ? 'var(--text-primary)' : 'var(--text-muted)' }}>{row.sizeLabel || '—'}</td>
                    <td style={{ padding: '8px 14px', fontSize: 13, textAlign: 'center', fontWeight: 600 }}>{row.quantity}</td>
                    <td style={{ padding: '8px 14px', fontSize: 12, color: 'var(--text-secondary)' }}>{getUnit(row.material)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {filledRows.length > 0 && (
            <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
              DRT Interiors Ltd — {jobInfo.contact}
            </div>
          )}
        </div>
      </div>

      {/* ── Autocomplete dropdown (fixed position so table overflow:auto doesn't clip it) ── */}
      {activeRowId && suggestions.length > 0 && dropdownPos && (
        <div ref={dropdownRef} style={{
          position: 'fixed',
          top: dropdownPos.top,
          left: dropdownPos.left,
          width: dropdownPos.width,
          zIndex: 9999,
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          maxHeight: 260,
          overflowY: 'auto',
          boxShadow: 'var(--shadow)',
        }}>
          {suggestions.map((m, i) => (
            <div
              key={m.id}
              onMouseDown={() => {
                const rowId = activeRowId
                attachMaterial(rowId, m)
                setSuggestions([])
                setActiveRowId(null)
                setDropdownPos(null)
              }}
              style={{
                padding: '6px 10px', cursor: 'pointer', fontSize: 12,
                display: 'flex', gap: 8, alignItems: 'center',
                background: i === highlightIdx ? 'var(--bg-hover)' : 'transparent',
                borderBottom: i < suggestions.length - 1 ? '1px solid var(--border)' : 'none',
              }}
            >
              <span style={{ fontFamily: 'monospace', color: '#60A5FA', fontWeight: 700, minWidth: 44 }}>{m.code}</span>
              <span style={{ flex: 1, color: 'var(--text-primary)' }}>{m.name}</span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{m.unit}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Load panel ── */}
      {showLoadPanel && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20 }} onClick={() => setShowLoadPanel(false)}>
          <div className="card" style={{ width: '100%', maxWidth: 540, maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: 16, fontWeight: 700 }}>Saved Orders</h2>
              <button onClick={() => setShowLoadPanel(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
              <input className="input" placeholder="Filter by project name…" value={filterProject} onChange={e => setFilterProject(e.target.value)} style={{ width: '100%' }} />
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {loadingOrders ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>
              ) : filteredOrders.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>No orders found</div>
              ) : (
                filteredOrders.map(order => (
                  <button key={order.id} onClick={() => loadOrder(order)}
                    style={{ width: '100%', background: 'none', border: 'none', borderBottom: '1px solid var(--border)', padding: '12px 20px', textAlign: 'left', cursor: 'pointer', color: 'var(--text-primary)', display: 'flex', flexDirection: 'column', gap: 2 }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                  >
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{order.project_name}</span>
                    <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--text-muted)' }}>
                      {order.delivery_date && <span>Delivery: {formatDate(order.delivery_date)}</span>}
                      {order.address && <span>{order.address}</span>}
                      <span>{new Date(order.created_at).toLocaleDateString()}</span>
                    </div>
                    {order.total_cost != null && order.total_cost > 0 && (
                      <span style={{ fontSize: 11, color: 'var(--green)', marginTop: 2 }}>Est. ${order.total_cost.toFixed(2)}</span>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span style={{ color: 'var(--text-muted)', marginRight: 4, fontWeight: 600 }}>{label}:</span>
      <span style={{ color: 'var(--text-primary)' }}>{value}</span>
    </div>
  )
}
