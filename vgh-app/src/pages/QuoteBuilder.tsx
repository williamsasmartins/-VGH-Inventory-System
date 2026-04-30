import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase, type Material } from '../lib/supabase'
import { getMaterialConfig, computeQuoteQuantity, TILE_CODES } from '../utils/materialConfig'
import * as XLSX from 'xlsx'

const STORES = ['Kenroc', 'Pacific West', 'Dryco']
const MARKUP = 1.15
const DRAFT_KEY = 'vgh_quote_draft'

// Read draft inside useState lazy initializer so it runs on every component mount,
// not just once at module load (important for SPA navigation).
function getDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') }
  catch { return null }
}

const LABOUR_FIXED_RATES: Record<string, { rate: number; unit: string; name: string }> = {
  'vghl': { rate: 80,  unit: 'Hrs', name: 'VGH Labour' },
  'VGHL': { rate: 80,  unit: 'Hrs', name: 'VGH Labour' },
  'FL':   { rate: 80,  unit: 'Hrs', name: 'Framing Labour' },
  'IL':   { rate: 80,  unit: 'Hrs', name: 'Insulation Labour' },
  'DL':   { rate: 80,  unit: 'Hrs', name: 'Drywall Labour' },
  'TL':   { rate: 80,  unit: 'Hrs', name: 'Taping Labour' },
  'ACL':  { rate: 80,  unit: 'Hrs', name: 'Acoustic Ceiling Labour' },
  'CU':   { rate: 80,  unit: 'Hrs', name: 'Clean Up' },
  'S':    { rate: 80,  unit: 'Hrs', name: 'Supervision' },
  'Demo': { rate: 60,  unit: 'Hrs', name: 'Demo Labour' },
  'D':    { rate: 75,  unit: '-',   name: 'Disposal' },
  'DF':   { rate: 265, unit: '-',   name: 'Delivery Fee' },
}

type QuoteSection = 'Material' | 'Labour'

type SavedQuote = {
  id: string
  project_name: string
  description: string
  store: string
  mat_items: QuoteItem[]
  lab_items: QuoteItem[]
  grand_total: number
  created_at: string
}

type QuoteItem = {
  id: string
  section: QuoteSection
  material: Material | null
  code: string
  description: string
  // quantity is always the base-unit value (sqft / lnft / each).
  // For size-tracked rows it is computed; otherwise it is entered directly.
  quantity: number | ''
  unit: string
  isLabourFixed: boolean
  fixedRate: number | null
  basePrice: number | null
  rateOverride: number | null
  // Size-based entry (populated when material has a category config)
  sizeLabel: string | null   // e.g. "10'"
  pieceCount: number | ''    // raw physical pieces
}

interface Props {
  showToast: (msg: string, type: 'success' | 'error') => void
}

const newItem = (section: QuoteSection): QuoteItem => ({
  id: Math.random().toString(36).slice(2),
  section,
  material: null,
  code: '',
  description: '',
  quantity: '',
  unit: '',
  isLabourFixed: false,
  fixedRate: null,
  basePrice: null,
  rateOverride: null,
  sizeLabel: null,
  pieceCount: '',
})

const CT_SQFT_MAP: Record<string, number> = { "2'x2'": 4, "2'x4'": 8 }

function getEffectiveRate(item: QuoteItem): number | null {
  if (item.rateOverride !== null) return item.rateOverride
  if (item.isLabourFixed && item.fixedRate !== null) return item.fixedRate
  if (item.basePrice !== null) {
    // For tile materials (ct, DWT): basePrice is price/sqft → multiply by tile area for price/pcs
    const area = TILE_CODES.has(item.code) && item.sizeLabel ? (CT_SQFT_MAP[item.sizeLabel] ?? 1) : 1
    return parseFloat((item.basePrice * area * MARKUP).toFixed(4))
  }
  return null
}

function getCostValue(item: QuoteItem): number {
  const rate = getEffectiveRate(item)
  if (rate === null || item.quantity === '' || item.quantity === 0) return 0
  return rate * (item.quantity as number)
}

export default function QuoteBuilder({ showToast }: Props) {
  // ── Lazy initializers — read draft fresh on every mount (SPA-safe) ──────────
  const [store, setStore]             = useState<string>(() => { const d = getDraft(); return d?.store && STORES.includes(d.store) ? d.store : 'Kenroc' })
  const [projectName, setProjectName] = useState<string>(() => getDraft()?.projectName ?? '')
  const [description, setDescription] = useState<string>(() => getDraft()?.description ?? '')
  const [matItems, setMatItems]       = useState<QuoteItem[]>(() => { const d = getDraft(); return Array.isArray(d?.matItems) && d.matItems.length > 0 ? d.matItems : Array.from({ length: 8 }, () => newItem('Material')) })
  const [labItems, setLabItems]       = useState<QuoteItem[]>(() => { const d = getDraft(); return Array.isArray(d?.labItems) && d.labItems.length > 0 ? d.labItems : Array.from({ length: 5 }, () => newItem('Labour')) })

  const matTotal   = matItems.reduce((s, i) => s + getCostValue(i), 0)
  const labTotal   = labItems.reduce((s, i) => s + getCostValue(i), 0)
  const grandTotal = matTotal + labTotal
  const totalHours = labItems.reduce((s, i) => {
    if (i.unit?.toLowerCase() === 'hrs' && i.quantity !== '' && typeof i.quantity === 'number') return s + i.quantity
    return s
  }, 0)

  const [suggestions, setSuggestions]     = useState<Material[]>([])
  const [activeId, setActiveId]           = useState<string | null>(null)
  const [hlIdx, setHlIdx]                 = useState(-1)
  const [showCustomOption, setShowCustomOption] = useState(false)
  const searchTimer   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const descriptionRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const [savedQuotes, setSavedQuotes] = useState<SavedQuote[]>([])
  const [showSaved, setShowSaved]     = useState(false)
  const [isSaving, setIsSaving]       = useState(false)
  // Tracks the DB id of the currently-loaded quote. Null = new/unsaved quote.
  // When non-null, saveQuote() updates that row instead of inserting a new one.
  const [loadedQuoteId, setLoadedQuoteId] = useState<string | null>(null)

  // ── Recompute stale draft items: pieceCount > 0 but quantity = '' ───────────
  // This fixes rows saved before the parseFloat fix was deployed.
  useEffect(() => {
    const recompute = (items: QuoteItem[]): QuoteItem[] =>
      items.map(item => {
        if (!item.material || item.pieceCount === '' || (item.pieceCount as number) <= 0) return item
        if (item.quantity !== '') return item   // already has a valid quantity
        if (!item.sizeLabel) return item
        const newQty = computeQuoteQuantity(item.material, item.sizeLabel, item.pieceCount as number)
        return newQty > 0 ? { ...item, quantity: newQty } : item
      })
    setMatItems(prev => recompute(prev))
    setLabItems(prev => recompute(prev))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // run once on mount only

  // ── Auto-save on every change (skip the very first render via ref) ──────────
  const isMounted = useRef(false)
  useEffect(() => {
    if (!isMounted.current) { isMounted.current = true; return }
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ projectName, description, store, matItems, labItems }))
  }, [projectName, description, store, matItems, labItems])

  const searchMats = useCallback(async (q: string) => {
    if (!q.trim()) { setSuggestions([]); return }
    const trimmed = q.trim()
    // Run two separate queries: code match first (higher priority), then name match
    const [byCode, byName] = await Promise.all([
      supabase.from('materials').select('*').ilike('code', `%${trimmed}%`).order('code').limit(10),
      supabase.from('materials').select('*').ilike('name', `%${trimmed}%`).order('name').limit(10),
    ])
    // Merge with code matches first, deduplicate by id
    const seen = new Set<string>()
    const merged = [...(byCode.data || []), ...(byName.data || [])].filter(m => {
      if (seen.has(m.id)) return false
      seen.add(m.id)
      return true
    }).slice(0, 10)
    setSuggestions(merged)
    setHlIdx(-1)
  }, [])

  async function fetchPrice(code: string): Promise<number | null> {
    const { data } = await supabase.from('material_prices').select('price')
      .eq('material_code', code).eq('store_name', store).maybeSingle()
    return data?.price ? parseFloat(data.price) : null
  }

  // Re-fetch prices when store changes
  useEffect(() => {
    const refetch = async () => {
      const refresh = async (items: QuoteItem[]): Promise<QuoteItem[]> =>
        Promise.all(items.map(async item => {
          if (!item.code || item.isLabourFixed) return item
          // Custom items (no DB material) have manually-entered prices — never overwrite them
          if (!item.material) return item
          const price = await fetchPrice(item.code)
          return { ...item, basePrice: price, rateOverride: null }
        }))
      const [m, l] = await Promise.all([refresh(matItems), refresh(labItems)])
      setMatItems(m); setLabItems(l)
    }
    refetch()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store])

  // ── Patch helpers ──────────────────────────────────────────────────────────
  function updMat(id: string, patch: Partial<QuoteItem>) {
    setMatItems(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i))
  }
  function updLab(id: string, patch: Partial<QuoteItem>) {
    setLabItems(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i))
  }
  function upd(section: QuoteSection, id: string, patch: Partial<QuoteItem>) {
    section === 'Material' ? updMat(id, patch) : updLab(id, patch)
  }

  // ── Size / piece change: auto-recompute base-unit quantity ─────────────────
  function handleSizePieceChange(
    section: QuoteSection,
    id: string,
    patch: { sizeLabel?: string | null; pieceCount?: number | '' },
  ) {
    const items = section === 'Material' ? matItems : labItems
    const item = items.find(i => i.id === id)
    if (!item || !item.material) return

    const newSizeLabel  = 'sizeLabel'  in patch ? (patch.sizeLabel  ?? item.sizeLabel)  : item.sizeLabel
    const newPieceCount = 'pieceCount' in patch ? patch.pieceCount!                      : item.pieceCount

    const isDimensionalSqft = !getMaterialConfig(item.material) && item.material.unit.toLowerCase() === 'sqft' && item.material.width && item.material.length;
    const dimensionalFactor = isDimensionalSqft ? (item.material.width! * item.material.length!) : 1;

    let newQuantity: number | '' = ''
    if (newPieceCount !== '' && (newPieceCount as number) > 0) {
      if (isDimensionalSqft) {
        newQuantity = (newPieceCount as number) * dimensionalFactor
      } else if (newSizeLabel) {
        newQuantity = computeQuoteQuantity(item.material, newSizeLabel, newPieceCount as number)
      }
    }

    upd(section, id, { ...patch, quantity: newQuantity })
  }

  // ── Ceiling Tile size selector ─────────────────────────────────────────────
  const CT_SIZES = ["2'x2'", "2'x4'"] as const
  type CtSize = typeof CT_SIZES[number]

  function handleCtSizeChange(section: QuoteSection, id: string, size: CtSize) {
    const items = section === 'Material' ? matItems : labItems
    const item = items.find(i => i.id === id)
    const baseName = item?.material?.name ?? item?.description?.split(' - ')[0] ?? ''
    upd(section, id, {
      sizeLabel: size,
      description: `${baseName} - ${size}`,
      rateOverride: null,
    })
  }

  // ── Autocomplete / selection ───────────────────────────────────────────────
  async function selectSuggestion(mat: Material, section: QuoteSection, id: string) {
    const labourInfo = LABOUR_FIXED_RATES[mat.code]
    let patch: Partial<QuoteItem>
    if (labourInfo) {
      patch = {
        material: mat, code: mat.code,
        description: labourInfo.name || mat.name,
        unit: labourInfo.unit,
        isLabourFixed: true, fixedRate: labourInfo.rate,
        basePrice: null, rateOverride: null,
        sizeLabel: null, pieceCount: '', quantity: '',
      }
    } else {
      const priceRaw = await fetchPrice(mat.code)
      const config = getMaterialConfig(mat)
      const isTile = TILE_CODES.has(mat.code)
      const defaultTileSize: CtSize = "2'x2'"
      // basePrice always stores raw price/sqft — getEffectiveRate handles × area for tile codes
      patch = {
        material: mat, code: mat.code,
        description: isTile ? `${mat.name} - ${defaultTileSize}` : mat.name,
        unit: mat.unit, isLabourFixed: false, fixedRate: null,
        basePrice: priceRaw, rateOverride: null,
        sizeLabel: isTile ? defaultTileSize : (config?.defaultSizeLabel ?? null),
        pieceCount: '', quantity: '',
      }
    }
    upd(section, id, patch)
    setSuggestions([]); setActiveId(null); setShowCustomOption(false)
  }

  function handleCodeChange(section: QuoteSection, id: string, val: string) {
    const labourInfo = LABOUR_FIXED_RATES[val.trim()]
    if (labourInfo) {
      upd(section, id, {
        code: val, description: labourInfo.name, unit: labourInfo.unit,
        isLabourFixed: true, fixedRate: labourInfo.rate,
        basePrice: null, rateOverride: null, material: null,
        sizeLabel: null, pieceCount: '', quantity: '',
      })
      setSuggestions([]); setActiveId(null); setShowCustomOption(false)
      return
    }
    upd(section, id, {
      code: val, isLabourFixed: false, fixedRate: null,
      sizeLabel: null, pieceCount: '', quantity: '',
    })
    setActiveId(id)
    setShowCustomOption(false)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(async () => {
      await searchMats(val)
      if (val.trim()) setShowCustomOption(true)
    }, 220)
  }

  function handleCodeKeyDown(e: React.KeyboardEvent, section: QuoteSection, id: string) {
    if (!suggestions.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setHlIdx(i => Math.min(i + 1, suggestions.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHlIdx(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (hlIdx >= 0) selectSuggestion(suggestions[hlIdx], section, id) }
    else if (e.key === 'Escape') { setSuggestions([]); setActiveId(null); setShowCustomOption(false) }
  }

  // ── New Quote: reset everything to empty state ─────────────────────────────
  function newQuote() {
    const hasContent =
      projectName.trim() !== '' ||
      description.trim() !== '' ||
      matItems.some(i => i.code || i.description || i.quantity !== '' || i.material) ||
      labItems.some(i => i.code || i.description || i.quantity !== '' || i.material)

    if (hasContent && !window.confirm('Start a new quote? All unsaved fields will be cleared.')) {
      return
    }

    setProjectName('')
    setDescription('')
    setStore('Kenroc')
    setMatItems(Array.from({ length: 8 }, () => newItem('Material')))
    setLabItems(Array.from({ length: 5 }, () => newItem('Labour')))
    setActiveId(null)
    setSuggestions([])
    setLoadedQuoteId(null)   // detach from any previously-loaded quote
    localStorage.removeItem(DRAFT_KEY)
    showToast('New quote started', 'success')
  }

  // ── Save / Load / Print ────────────────────────────────────────────────────
  async function saveQuote() {
    if (!projectName.trim()) { showToast('Enter a project name to save', 'error'); return }
    setIsSaving(true)

    const payload = {
      project_name: projectName.trim(),
      description: description.trim(),
      store,
      mat_items: matItems,
      lab_items: labItems,
      grand_total: parseFloat(grandTotal.toFixed(2)),
    }

    // If a quote was loaded, update it in-place. Otherwise insert a new row.
    let error, newId: string | null = null
    if (loadedQuoteId) {
      const res = await supabase.from('quotes').update(payload).eq('id', loadedQuoteId)
      error = res.error
    } else {
      const res = await supabase.from('quotes').insert(payload).select('id').single()
      error = res.error
      newId = (res.data as { id: string } | null)?.id ?? null
    }

    setIsSaving(false)

    if (error) {
      console.error('Supabase save error:', error)
      showToast(`Error: ${error.message}`, 'error')
      return
    }

    // After a fresh insert, remember the new id so subsequent saves update it.
    if (!loadedQuoteId && newId) setLoadedQuoteId(newId)

    localStorage.removeItem(DRAFT_KEY)
    showToast(loadedQuoteId ? 'Quote updated!' : 'Quote saved!', 'success')
  }

  async function loadSavedQuotes() {
    const { data, error } = await supabase
      .from('quotes').select('*').order('created_at', { ascending: false }).limit(50)
    if (error) { showToast('Error loading quotes', 'error'); return }
    setSavedQuotes((data as SavedQuote[]) || [])
    setShowSaved(true)
  }

  function loadQuote(q: SavedQuote) {
    setProjectName(q.project_name)
    setDescription(q.description)
    setStore(q.store)
    setMatItems(q.mat_items)
    setLabItems(q.lab_items)
    setLoadedQuoteId(q.id)
    setShowSaved(false)
    showToast('Quote loaded', 'success')
  }

  async function deleteQuote(id: string) {
    const { error } = await supabase.from('quotes').delete().eq('id', id)
    if (error) { showToast('Error deleting quote', 'error'); return }
    setSavedQuotes(prev => prev.filter(q => q.id !== id))
    // If the currently-loaded quote was the one just deleted, drop the id so
    // the next Save creates a new row instead of updating a deleted one.
    if (loadedQuoteId === id) setLoadedQuoteId(null)
    showToast('Quote deleted', 'success')
  }

  function printQuote() {
    if (![...matItems, ...labItems].some(i => i.code)) {
      showToast('Add at least one item before printing', 'error')
      return
    }
    const win = window.open('', '_blank')
    if (!win) { showToast('Allow popups to use Print / PDF', 'error'); return }

    const rowHtml = (item: QuoteItem, accentColor: string) => {
      if (!item.code && !item.description) return ''
      const rate = getEffectiveRate(item)
      const cost = getCostValue(item)
      const sizeInfo = item.sizeLabel
        ? `${item.sizeLabel}${item.pieceCount !== '' ? ` × ${item.pieceCount}pcs` : ''}`
        : ''
      const qtyInfo = item.quantity !== '' ? `${item.quantity} ${item.unit}` : (item.unit || '')
      return `<tr>
        <td style="font-family:monospace;font-weight:700;color:${accentColor}">${item.code}</td>
        <td>${item.description}</td>
        <td style="text-align:center">${sizeInfo}</td>
        <td style="text-align:right">${qtyInfo}</td>
        <td style="text-align:right">${rate !== null ? '$' + rate.toFixed(2) : ''}</td>
        <td style="text-align:right;font-weight:700">${cost > 0 ? '$' + cost.toFixed(2) : ''}</td>
      </tr>`
    }

    const matRows = matItems.map(i => rowHtml(i, '#1a56db')).join('')
    const labRows = labItems.map(i => rowHtml(i, '#7e3af2')).join('')
    const dateStr = new Date().toLocaleDateString('en-CA')

    win.document.write(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>DRT Quote – ${projectName}</title>
<style>
  body{font-family:Arial,sans-serif;font-size:13px;color:#111;margin:0;padding:32px}
  h1{font-size:20px;margin:0}h2{font-size:13px;font-weight:normal;margin:4px 0 0;color:#555}
  .hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;border-bottom:2px solid #111;padding-bottom:16px}
  .meta p{margin:4px 0}
  table{width:100%;border-collapse:collapse;margin-top:20px}
  th{background:#f3f4f6;text-align:left;padding:7px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.5px;border-bottom:2px solid #ddd}
  td{padding:6px 10px;border-bottom:1px solid #eee}
  .sec td{background:#f9fafb;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#555;padding:8px 10px}
  .sub-mat td{background:#eff6ff;font-weight:700;font-size:12px;border-top:1px solid #bfdbfe;padding:7px 10px}
  .sub-lab td{background:#f5f3ff;font-weight:700;font-size:12px;border-top:1px solid #ddd6fe;padding:7px 10px}
  .tot td{font-weight:900;font-size:16px;border-top:2px solid #111;padding:10px}
  @media print{body{padding:16px}}
</style></head><body>
<div class="hdr">
  <div><h1>DRT INTERIORS</h1><h2>2430 W Broadway, Vancouver BC, V6K 2E7</h2></div>
  <div style="text-align:right"><strong>QUOTE</strong><br>${dateStr}</div>
</div>
<div class="meta">
  <p><strong>Project:</strong> ${projectName || '—'}</p>
  ${description ? `<p><strong>Scope:</strong> ${description}</p>` : ''}
  <p><strong>Price List:</strong> ${store}</p>
</div>
<table>
  <thead><tr>
    <th style="width:100px">Code</th><th>Description</th>
    <th style="width:90px;text-align:center">Size</th>
    <th style="width:110px;text-align:right">Qty</th>
    <th style="width:90px;text-align:right">Rate</th>
    <th style="width:90px;text-align:right">Cost</th>
  </tr></thead>
  <tbody>
    <tr class="sec"><td colspan="6">Material</td></tr>
    ${matRows}
    <tr class="sub-mat">
      <td colspan="4"></td>
      <td style="text-align:right;color:#1d4ed8">Material Subtotal:</td>
      <td style="text-align:right;color:#1d4ed8">$${matTotal.toFixed(2)}</td>
    </tr>
    <tr><td colspan="6" style="padding:6px 0;border:none"></td></tr>
    <tr class="sec"><td colspan="6">Labour</td></tr>
    ${labRows}
    <tr class="sub-lab">
      <td colspan="4"></td>
      <td style="text-align:right;color:#6d28d9">Labour Subtotal:</td>
      <td style="text-align:right;color:#6d28d9">$${labTotal.toFixed(2)}</td>
    </tr>
    ${totalHours > 0 ? `<tr>
      <td colspan="4"></td>
      <td style="text-align:right;font-weight:700;font-size:12px;color:#555">Total Hours:</td>
      <td style="text-align:right;font-weight:800;font-size:14px;color:#333">${totalHours} Hrs</td>
    </tr>` : ''}
    <tr class="tot">
      <td colspan="4"></td>
      <td style="text-align:right">TOTAL:</td>
      <td style="text-align:right">$${grandTotal.toFixed(2)}</td>
    </tr>
  </tbody>
</table>
</body></html>`)
    win.document.close()
    setTimeout(() => win.print(), 500)
  }

  // ── Simple Quote: company info + project + totals only (for contractors) ───
  function printSimpleQuote() {
    if (!projectName.trim()) {
      showToast('Enter a project name before printing', 'error')
      return
    }
    const win = window.open('', '_blank')
    if (!win) { showToast('Allow popups to use Print / PDF', 'error'); return }

    const dateStr = new Date().toLocaleDateString('en-CA')

    win.document.write(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>DRT Invoice – ${projectName}</title>
<style>
  body{font-family:Arial,sans-serif;font-size:14px;color:#111;margin:0;padding:48px;max-width:640px}
  h1{font-size:22px;margin:0;font-weight:900}h2{font-size:13px;font-weight:normal;margin:5px 0 0;color:#555}
  .hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px;border-bottom:3px solid #111;padding-bottom:20px}
  .badge{background:#111;color:#fff;padding:4px 12px;border-radius:4px;font-size:13px;font-weight:700;letter-spacing:1px}
  .project{margin-bottom:32px}
  .project p{margin:6px 0;font-size:15px}
  .totals{border:2px solid #e5e7eb;border-radius:10px;overflow:hidden;margin-top:12px}
  .totals-row{display:flex;justify-content:space-between;align-items:center;padding:16px 24px;border-bottom:1px solid #e5e7eb}
  .totals-row:last-child{border-bottom:none}
  .totals-row.grand{background:#111;color:#fff;border-bottom:none}
  .totals-label{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;opacity:.75}
  .totals-value{font-size:20px;font-weight:900;font-family:monospace}
  .totals-row.grand .totals-label{opacity:.8;color:#fff}
  .totals-row.grand .totals-value{font-size:28px;color:#fff}
  @media print{body{padding:24px}}
</style></head><body>
<div class="hdr">
  <div><h1>DRT INTERIORS</h1><h2>2430 W Broadway, Vancouver BC, V6K 2E7</h2></div>
  <div style="text-align:right"><div class="badge">INVOICE</div><div style="margin-top:8px;font-size:12px;color:#555">${dateStr}</div></div>
</div>
<div class="project">
  <p><strong>Project:</strong> ${projectName}</p>
  ${description ? `<p><strong>Scope:</strong> ${description}</p>` : ''}
</div>
<div class="totals">
  <div class="totals-row">
    <span class="totals-label">Material Cost</span>
    <span class="totals-value" style="color:#1d4ed8">$${matTotal.toFixed(2)}</span>
  </div>
  <div class="totals-row">
    <span class="totals-label">Labour Cost</span>
    <span class="totals-value" style="color:#6d28d9">$${labTotal.toFixed(2)}</span>
  </div>
  <div class="totals-row grand">
    <span class="totals-label">Total</span>
    <span class="totals-value">$${grandTotal.toFixed(2)}</span>
  </div>
</div>
</body></html>`)
    win.document.close()
    setTimeout(() => win.print(), 500)
  }

  // ── Row renderer ───────────────────────────────────────────────────────────
  function renderRow(item: QuoteItem, section: QuoteSection) {
    const rate       = getEffectiveRate(item)
    const cost       = getCostValue(item)
    const isActive   = activeId === item.id
    const setItems   = section === 'Material' ? setMatItems : setLabItems
    const isLabour   = item.isLabourFixed
    const matConfig  = !isLabour && item.material ? getMaterialConfig(item.material) : null

    return (
      <tr key={item.id}>

        {/* ── Code ── */}
        <td style={{ padding: '5px 6px', position: 'relative' }}>
          <input
            className="inline-input"
            style={{ width: '100%', fontWeight: 700, fontFamily: 'monospace', fontSize: 12,
              color: isLabour ? 'var(--green-light)' : '#60A5FA' }}
            placeholder="code"
            value={item.code}
            onChange={e => handleCodeChange(section, item.id, e.target.value)}
            onKeyDown={e => handleCodeKeyDown(e, section, item.id)}
            onFocus={() => { if (item.code && !isLabour) { setActiveId(item.id); searchMats(item.code) } }}
            onBlur={() => setTimeout(() => { setSuggestions([]); setActiveId(null); setShowCustomOption(false) }, 180)}
            autoComplete="off"
          />
          {isActive && (suggestions.length > 0 || (showCustomOption && item.code.trim())) && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, zIndex: 300, minWidth: 340,
              background: 'var(--bg-secondary)', border: '1px solid var(--border)',
              borderRadius: 8, boxShadow: 'var(--shadow)', maxHeight: 260, overflowY: 'auto',
            }}>
              {suggestions.map((m, idx) => (
                <div key={m.id}
                  style={{ padding: '8px 12px', cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'center',
                    background: idx === hlIdx ? 'var(--bg-hover)' : undefined,
                    borderBottom: '1px solid var(--border)' }}
                  onMouseDown={() => selectSuggestion(m, section, item.id)}
                >
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--green-light)', fontSize: 12, flexShrink: 0 }}>{m.code}</span>
                  <span style={{ fontSize: 13 }}>{m.name}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>{m.unit}</span>
                </div>
              ))}
              {showCustomOption && item.code.trim() && (
                <>
                  {suggestions.length > 0 && <div style={{ height: 1, background: 'var(--border)', margin: '2px 0' }} />}
                  <div
                    onMouseDown={() => {
                      setSuggestions([]); setActiveId(null); setShowCustomOption(false)
                      setTimeout(() => descriptionRefs.current[item.id]?.focus(), 0)
                    }}
                    style={{
                      padding: '8px 12px', cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'center',
                      background: 'rgba(245,158,11,0.06)', color: '#F59E0B', fontSize: 12,
                    }}
                  >
                    <span style={{ fontWeight: 800, fontSize: 15, lineHeight: 1 }}>+</span>
                    <span>Add <strong>"{item.code}"</strong> as custom item</span>
                    <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic' }}>enter rate manually</span>
                  </div>
                </>
              )}
            </div>
          )}
          {/* CUSTOM badge: shown when row has content but no DB material */}
          {!item.material && !item.isLabourFixed && (item.code.trim() || item.description.trim()) && (
            <div style={{ fontSize: 8, color: '#F59E0B', textAlign: 'center', marginTop: 2, letterSpacing: '0.5px', opacity: 0.75 }}>CUSTOM</div>
          )}
        </td>

        {/* ── Description ── */}
        <td style={{ padding: '5px 6px' }}>
          <input
            ref={el => { descriptionRefs.current[item.id] = el }}
            className="inline-input" style={{ width: '100%', fontSize: 13 }}
            placeholder="description..."
            value={item.description}
            onChange={e => upd(section, item.id, { description: e.target.value })} />
        </td>

        {/* ── Size / Qty ── */}
        <td style={{ padding: '5px 6px', width: 170 }}>
          {TILE_CODES.has(item.code) ? (
            // ── Ceiling Tile: size radio + quantity ──
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', gap: 4 }}>
                {CT_SIZES.map(sz => (
                  <button
                    key={sz}
                    type="button"
                    onClick={() => handleCtSizeChange(section, item.id, sz)}
                    style={{
                      flex: 1, padding: '4px 2px', fontSize: 11, fontWeight: 800,
                      fontFamily: 'monospace', borderRadius: 6, cursor: 'pointer',
                      border: '1px solid var(--border)',
                      background: item.sizeLabel === sz ? '#60A5FA22' : 'var(--bg-secondary)',
                      color: item.sizeLabel === sz ? '#60A5FA' : 'var(--text-muted)',
                      outline: item.sizeLabel === sz ? '1px solid #60A5FA' : 'none',
                    }}
                  >{sz}</button>
                ))}
              </div>
              <input
                className="inline-input"
                type="number" min="1" step="1"
                style={{ width: '100%', textAlign: 'right', fontWeight: 700 }}
                placeholder="qty"
                value={item.quantity}
                onChange={e => upd(section, item.id, {
                  quantity: e.target.value === '' ? '' : Math.max(0, parseFloat(e.target.value)),
                })}
              />
            </div>
          ) : (() => {
            const isDimensionalSqft = !matConfig && item.material && item.material.unit.toLowerCase() === 'sqft' && item.material.width && item.material.length
            if (matConfig || isDimensionalSqft) {
              return (
                <div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {matConfig ? (
                      <select
                        value={item.sizeLabel ?? matConfig.defaultSizeLabel}
                        onChange={e => handleSizePieceChange(section, item.id, { sizeLabel: e.target.value })}
                        style={{
                          flex: '0 0 72px',
                          background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                          borderRadius: 6, color: '#60A5FA', fontFamily: 'monospace',
                          fontWeight: 800, fontSize: 13, padding: '5px 6px',
                          cursor: 'pointer', outline: 'none', appearance: 'none',
                        }}
                      >
                        {matConfig.sizes.map(s => (
                          <option key={s.label} value={s.label}>{s.label}</option>
                        ))}
                      </select>
                    ) : (
                      <div style={{
                        flex: '0 0 40px', display: 'flex', alignItems: 'center',
                        justifyContent: 'center', background: 'var(--bg-secondary)',
                        border: '1px solid var(--border)', borderRadius: 6,
                        color: 'var(--text-muted)', fontSize: 12,
                      }}>pcs</div>
                    )}
                    <input
                      className="inline-input"
                      type="number" min="1" step="1"
                      style={{ flex: 1, textAlign: 'right', fontWeight: 700, minWidth: 0 }}
                      placeholder="pcs"
                      value={item.pieceCount}
                      onChange={e => handleSizePieceChange(section, item.id, {
                        pieceCount: e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value)),
                      })}
                    />
                  </div>
                  {item.quantity !== '' && (item.quantity as number) > 0 && (
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 3, textAlign: 'right', fontFamily: 'monospace' }}>
                      = {item.quantity} {item.unit}
                    </div>
                  )}
                </div>
              )
            }
            // Custom item (no DB material, not labour): size text + qty number
            if (!item.material && !item.isLabourFixed) {
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <input
                    className="inline-input"
                    style={{ width: '100%', fontSize: 11, color: '#60A5FA' }}
                    placeholder="size / spec..."
                    value={item.sizeLabel ?? ''}
                    onChange={e => upd(section, item.id, { sizeLabel: e.target.value || null })}
                  />
                  <input
                    className="inline-input"
                    type="number" min="0" step="any"
                    style={{ width: '100%', textAlign: 'right', fontWeight: 700 }}
                    placeholder="qty"
                    value={item.quantity}
                    onChange={e => upd(section, item.id, { quantity: e.target.value === '' ? '' : parseFloat(e.target.value) })}
                  />
                </div>
              )
            }
            return (
              <input className="inline-input" type="number" min="0" step="any"
                style={{ width: '100%', textAlign: 'right', fontWeight: 700 }}
                placeholder="—"
                value={item.quantity}
                onChange={e => upd(section, item.id, { quantity: e.target.value === '' ? '' : parseFloat(e.target.value) })} />
            )
          })()}
        </td>

        {/* ── Units ── */}
        <td style={{ padding: '5px 6px', width: 64 }}>
          <input className="inline-input"
            style={{ width: '100%', textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}
            placeholder="un"
            value={item.unit}
            onChange={e => upd(section, item.id, { unit: e.target.value })} />
        </td>

        {/* ── Rate ── */}
        <td style={{ padding: '5px 6px', width: 88 }}>
          {isLabour ? (
            <div style={{ position: 'relative' }}>
              <input className="inline-input" type="number" step="0.01"
                style={{ width: '100%', textAlign: 'right', color: '#A78BFA', fontWeight: 800 }}
                value={item.rateOverride ?? item.fixedRate ?? ''}
                onChange={e => upd(section, item.id, { rateOverride: e.target.value === '' ? null : parseFloat(e.target.value) })} />
              {item.rateOverride === null && (
                <span style={{ position: 'absolute', bottom: -10, right: 2, fontSize: 9, color: '#A78BFA', opacity: 0.7 }}>fixed/hr</span>
              )}
            </div>
          ) : (
            <div style={{ position: 'relative' }}>
              <input className="inline-input" type="number" step="0.01"
                style={{ width: '100%', textAlign: 'right', color: '#F59E0B', fontWeight: 700 }}
                placeholder={rate !== null ? rate.toFixed(2) : (!item.material && !item.isLabourFixed ? 'base cost...' : '—')}
                value={
                  item.rateOverride !== null
                    ? item.rateOverride
                    : item.basePrice !== null
                      ? (!item.material && !item.isLabourFixed
                          ? item.basePrice
                          : parseFloat((item.basePrice * MARKUP).toFixed(2)))
                      : ''
                }
                onChange={e => {
                  const val = e.target.value === '' ? null : parseFloat(e.target.value)
                  if (!item.material && !item.isLabourFixed) {
                    // Custom item: store as basePrice so ×1.15 markup applies automatically
                    upd(section, item.id, { basePrice: val, rateOverride: null })
                  } else {
                    upd(section, item.id, { rateOverride: val })
                  }
                }} />
              {item.basePrice !== null && item.rateOverride === null && (
                <span style={{ position: 'absolute', bottom: -10, right: 2, fontSize: 9, color: 'var(--text-muted)', opacity: 0.8 }}>×1.15</span>
              )}
              {!item.material && !item.isLabourFixed && item.basePrice === null && item.rateOverride === null && (
                <span style={{ position: 'absolute', bottom: -10, right: 2, fontSize: 9, color: '#F59E0B', opacity: 0.6 }}>×1.15</span>
              )}
            </div>
          )}
        </td>

        {/* $  */}
        <td style={{ padding: '5px 3px', width: 18, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>$</td>

        {/* ── Cost ── */}
        <td style={{ padding: '5px 10px', width: 88, textAlign: 'right', fontWeight: 800, fontSize: 14,
          color: cost > 0 ? '#F59E0B' : 'var(--text-muted)' }}>
          {cost > 0 ? cost.toFixed(2) : '—'}
        </td>

        {/* Remove */}
        <td style={{ padding: 4, width: 28 }}>
          <button onClick={() => setItems(prev => prev.filter(i => i.id !== item.id))}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
              fontSize: 13, padding: '2px 4px', borderRadius: 4 }}
            title="Remove">✕</button>
        </td>
      </tr>
    )
  }

  function sectionHeader(label: string, accentColor: string) {
    return (
      <tr style={{ background: `${accentColor}18` }}>
        <td colSpan={8} style={{ padding: '8px 14px', fontWeight: 800, fontSize: 12,
          color: accentColor, textTransform: 'uppercase', letterSpacing: '1px' }}>
          {label}
        </td>
      </tr>
    )
  }

  // ── Excel export ───────────────────────────────────────────────────────────
  function exportExcel() {
    const allItems = [...matItems, ...labItems]
    if (!allItems.some(i => i.code)) { showToast('Add at least one item', 'error'); return }

    const pad = (n: number) => Array(n).fill('')
    const COLS = 10

    const rows: (string | number)[][] = [
      ['DRT INTERIORS', ...pad(COLS - 1)],
      ['2430 W Broadway, Vancouver BC, V6K 2E7', ...pad(COLS - 1)],
      pad(COLS),
      [`Project: ${projectName}`, ...pad(COLS - 1)],
      [`Total Quoted Price: $${grandTotal.toFixed(2)}`, ...pad(COLS - 1)],
      pad(COLS),
    ]
    if (description) rows.push([`Description: ${description}`, ...pad(COLS - 1)])
    rows.push(pad(COLS))
    rows.push(['', 'Code', 'Description', 'Size', 'Pcs', 'Quantity', 'Units', 'Rate', '$', 'Cost'])

    const addSection = (label: string, items: QuoteItem[]) => {
      rows.push([label, ...pad(COLS - 1)])
      items.filter(i => i.code || i.description).forEach(i => {
        const rate = getEffectiveRate(i)
        const cost = getCostValue(i)
        rows.push([
          '',
          i.code,
          i.description,
          i.sizeLabel  || '',
          i.pieceCount !== '' ? i.pieceCount : '',
          i.quantity   !== '' ? i.quantity : '',
          i.unit || '-',
          rate !== null ? parseFloat(rate.toFixed(2)) : '',
          '$',
          cost > 0 ? parseFloat(cost.toFixed(2)) : '-',
        ])
      })
      rows.push(pad(COLS))
    }

    addSection('Material', matItems)
    addSection('Labour', labItems)
    rows.push(['', '', '', '', '', '', '', 'TOTAL', '$', parseFloat(grandTotal.toFixed(2))])

    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = [
      { wch: 4 }, { wch: 14 }, { wch: 38 }, { wch: 8 }, { wch: 6 },
      { wch: 10 }, { wch: 7 }, { wch: 10 }, { wch: 4 }, { wch: 12 },
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'DRT Quote')
    const fname = `DRT-Quote-${(projectName || 'Project').replace(/[^a-zA-Z0-9]/g, '_')}-${new Date().toISOString().slice(0, 10)}.xlsx`
    XLSX.writeFile(wb, fname)
    showToast(`Exported: ${fname}`, 'success')
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div className="page-header">
        <div>
          <h2>DRT Quote Builder</h2>
          <p>Materials ×1.15 markup · Labour $80/hr fixed</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700 }}>PRICE LIST:</span>
          {STORES.map(s => (
            <button key={s} className={`chip ${store === s ? 'active' : ''}`} onClick={() => setStore(s)}>{s}</button>
          ))}
          <button className="btn btn-outline" onClick={newQuote} title="Clear all fields and start a new quote">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 15, height: 15 }}>
              <line x1="12" y1="5" x2="12" y2="19" strokeLinecap="round" />
              <line x1="5" y1="12" x2="19" y2="12" strokeLinecap="round" />
            </svg>
            New Quote
          </button>
          <button className="btn btn-outline" onClick={loadSavedQuotes}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 15, height: 15 }}>
              <path d="M3 7h18M3 12h18M3 17h18" strokeLinecap="round" />
            </svg>
            Saved Quotes
          </button>
          <button className="btn btn-outline" disabled={isSaving} onClick={saveQuote} title={loadedQuoteId ? 'Update the currently-loaded quote' : 'Save as a new quote'}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 15, height: 15 }}>
              <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" strokeLinecap="round" />
              <path d="M17 21v-8H7v8M7 3v5h8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {isSaving ? 'Saving…' : (loadedQuoteId ? 'Update' : 'Save')}
          </button>
          <button className="btn btn-outline" onClick={printSimpleQuote} title="Invoice for contractors — shows totals only">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 15, height: 15 }}>
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" strokeLinecap="round" />
              <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Invoice
          </button>
          <button className="btn btn-outline" onClick={printQuote} title="Full detailed quote with all line items">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 15, height: 15 }}>
              <path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" strokeLinecap="round" />
              <path d="M6 14h12v8H6z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Detailed Quote
          </button>
          <button className="btn btn-primary" onClick={exportExcel}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 15, height: 15 }}>
              <path d="M14 3v4a1 1 0 001 1h4M17 21H7a2 2 0 01-2-2V5a2 2 0 012-2h7l5 5v11a2 2 0 01-2 2z" strokeLinecap="round" />
              <path d="M12 11v6M9 14l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Export Excel
          </button>
        </div>
      </div>

      <div className="page-body" style={{ overflowY: 'auto' }}>
        {/* Project info */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Project</label>
            <input className="form-control" placeholder="Project name / address" value={projectName} onChange={e => setProjectName(e.target.value)} />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Description</label>
            <input className="form-control" placeholder="Scope of work..." value={description} onChange={e => setDescription(e.target.value)} />
          </div>
        </div>

        {/* Total banner */}
        <div style={{
          background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)',
          borderRadius: 10, padding: '14px 20px', marginBottom: 20,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: projectName ? 10 : 0 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total Quoted Price</div>
            {projectName && <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Project: {projectName}</div>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            {/* Material subtotal */}
            <div style={{
              background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.2)',
              borderRadius: 8, padding: '10px 14px',
            }}>
              <div style={{ fontSize: 10, color: '#60A5FA', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Material</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: '#60A5FA', fontFamily: 'monospace' }}>${matTotal.toFixed(2)}</div>
            </div>
            {/* Labour subtotal */}
            <div style={{
              background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.2)',
              borderRadius: 8, padding: '10px 14px',
            }}>
              <div style={{ fontSize: 10, color: '#A78BFA', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Labour</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: '#A78BFA', fontFamily: 'monospace' }}>${labTotal.toFixed(2)}</div>
              {totalHours > 0 && <div style={{ fontSize: 11, color: '#A78BFA', fontFamily: 'monospace', marginTop: 4, opacity: 0.8 }}>{totalHours} Hrs total</div>}
            </div>
            {/* Grand total */}
            <div style={{
              background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.35)',
              borderRadius: 8, padding: '10px 14px',
            }}>
              <div style={{ fontSize: 10, color: '#F59E0B', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Total</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: '#F59E0B', fontFamily: 'monospace' }}>${grandTotal.toFixed(2)}</div>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ tableLayout: 'fixed', minWidth: 760 }}>
              <thead>
                <tr>
                  <th style={{ width: 100 }}>Code</th>
                  <th>Description</th>
                  <th style={{ width: 156, textAlign: 'center' }}>Size / Qty</th>
                  <th style={{ width: 64, textAlign: 'center' }}>Units</th>
                  <th style={{ width: 88, textAlign: 'right' }}>Rate</th>
                  <th style={{ width: 18, textAlign: 'center' }}>$</th>
                  <th style={{ width: 88, textAlign: 'right' }}>Cost</th>
                  <th style={{ width: 28 }}></th>
                </tr>
              </thead>
              <tbody>
                {sectionHeader('Material', '#60A5FA')}
                {matItems.map(item => renderRow(item, 'Material'))}
                <tr>
                  <td colSpan={8} style={{ padding: '4px 8px' }}>
                    <button className="btn btn-outline" style={{ fontSize: 12, padding: '3px 12px' }}
                      onClick={() => setMatItems(p => [...p, newItem('Material')])}>+ Add Material Line</button>
                  </td>
                </tr>
                <tr style={{ background: 'rgba(96,165,250,0.06)', borderTop: '1px solid rgba(96,165,250,0.2)' }}>
                  <td colSpan={5} style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, fontSize: 12, color: '#60A5FA', letterSpacing: '0.3px' }}>
                    MATERIAL SUBTOTAL:
                  </td>
                  <td style={{ color: '#60A5FA', textAlign: 'center', padding: '8px 3px', opacity: 0.7 }}>$</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 800, fontSize: 16, color: '#60A5FA', fontFamily: 'monospace' }}>
                    {matTotal.toFixed(2)}
                  </td>
                  <td />
                </tr>

                <tr><td colSpan={8} style={{ height: 10 }} /></tr>

                {sectionHeader('Labour', '#A78BFA')}
                {labItems.map(item => renderRow(item, 'Labour'))}
                <tr>
                  <td colSpan={8} style={{ padding: '4px 8px' }}>
                    <button className="btn btn-outline" style={{ fontSize: 12, padding: '3px 12px' }}
                      onClick={() => setLabItems(p => [...p, newItem('Labour')])}>+ Add Labour Line</button>
                  </td>
                </tr>
                <tr style={{ background: 'rgba(167,139,250,0.06)', borderTop: '1px solid rgba(167,139,250,0.2)' }}>
                  <td colSpan={5} style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, fontSize: 12, color: '#A78BFA', letterSpacing: '0.3px' }}>
                    LABOUR SUBTOTAL:
                  </td>
                  <td style={{ color: '#A78BFA', textAlign: 'center', padding: '8px 3px', opacity: 0.7 }}>$</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 800, fontSize: 16, color: '#A78BFA', fontFamily: 'monospace' }}>
                    {labTotal.toFixed(2)}
                  </td>
                  <td />
                </tr>

                <tr><td colSpan={8} style={{ height: 8 }} /></tr>
                <tr style={{ background: 'rgba(245,158,11,0.06)', borderTop: '2px solid rgba(245,158,11,0.3)' }}>
                  <td colSpan={5} style={{ padding: '14px 10px', textAlign: 'right', fontWeight: 700, fontSize: 13 }}>
                    TOTAL QUOTED PRICE:
                  </td>
                  <td style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '14px 3px' }}>$</td>
                  <td style={{ padding: '14px 10px', textAlign: 'right', fontWeight: 900, fontSize: 22, color: '#F59E0B', fontFamily: 'monospace' }}>
                    {grandTotal.toFixed(2)}
                  </td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Legend */}
        <div style={{ marginTop: 12, display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 11, color: 'var(--text-muted)' }}>
          <span><span style={{ color: '#60A5FA' }}>■</span> Material: base price × 1.15 markup</span>
          <span><span style={{ color: '#A78BFA' }}>■</span> Labour: fixed $80/hr (Demo $60/hr)</span>
          <span><span style={{ color: '#F59E0B' }}>■</span> D / DF: list price (no markup)</span>
          <span style={{ marginLeft: 'auto' }}>Size selector auto-calculates lnft / sqft</span>
        </div>
      </div>

      {/* ── Saved Quotes Modal ────────────────────────────────────────────── */}
      {showSaved && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={() => setShowSaved(false)}
        >
          <div
            style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)',
              borderRadius: 12, padding: 24, width: '100%', maxWidth: 620,
              maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>Saved Quotes</h3>
              <button onClick={() => setShowSaved(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>✕</button>
            </div>

            <div style={{ overflowY: 'auto', flex: 1 }}>
              {savedQuotes.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '32px 0', margin: 0 }}>
                  No saved quotes yet.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {savedQuotes.map(q => (
                    <div key={q.id} style={{ display: 'flex', alignItems: 'center', gap: 12,
                      background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                      borderRadius: 8, padding: '10px 14px' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {q.project_name}
                        </div>
                        {q.description && (
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {q.description}
                          </div>
                        )}
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                          {new Date(q.created_at).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })} · {q.store}
                        </div>
                      </div>
                      <span style={{ fontWeight: 900, fontSize: 16, color: '#F59E0B', fontFamily: 'monospace', flexShrink: 0 }}>
                        ${Number(q.grand_total).toFixed(2)}
                      </span>
                      <button className="btn btn-outline" style={{ fontSize: 12, padding: '4px 12px', flexShrink: 0 }}
                        onClick={() => loadQuote(q)}>Load</button>
                      <button onClick={() => deleteQuote(q.id)}
                        style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
                          fontSize: 13, padding: '2px 4px', borderRadius: 4, flexShrink: 0 }}
                        title="Delete quote">✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
