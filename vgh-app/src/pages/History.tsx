import { useState, useEffect, useMemo } from 'react'
import { supabase, type Transaction } from '../lib/supabase'
import { computeTransactionCoverage } from '../utils/materialConfig'
import * as XLSX from 'xlsx'

export default function History() {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [filterType, setFilterType] = useState<'ALL' | 'IN' | 'OUT'>('ALL')
  const [filterSearch, setFilterSearch] = useState('')
  const [filterDays, setFilterDays] = useState('30')
  const [filterProject, setFilterProject] = useState('')
  const [filterCode, setFilterCode] = useState('')
  const [filterVendor, setFilterVendor] = useState('')
  const [projects, setProjects] = useState<string[]>([])

  useEffect(() => { fetchTransactions() }, [])

  async function fetchTransactions() {
    setLoading(true)
    const { data } = await supabase
      .from('transactions')
      .select('*, materials(code, name, category, unit)')
      .order('created_at', { ascending: false })
    const txs = (data as Transaction[]) || []
    setTransactions(txs)
    // Extract unique project names
    const proj = [...new Set(txs.filter(t => t.project_name).map(t => t.project_name!))]
    setProjects(proj.sort())
    setLoading(false)
  }

  const codes = useMemo(() =>
    [...new Set(transactions.filter(t => t.materials?.code).map(t => t.materials!.code))].sort()
  , [transactions])

  const vendors = useMemo(() =>
    [...new Set(transactions.filter(t => t.store_name).map(t => t.store_name!))].sort()
  , [transactions])

  const filtered = useMemo(() => {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - parseInt(filterDays || '9999'))
    const q = filterSearch.toLowerCase()

    return transactions.filter(t => {
      // ── Type: DB stores lowercase 'in'/'out', state uses 'IN'/'OUT' ──
      const txType = t.type?.toUpperCase()
      const matchType = filterType === 'ALL' || txType === filterType

      // ── Date ──
      const matchDate = new Date(t.created_at) >= cutoff

      // ── Global text search: code, name, project, notes, employee name ──
      // Employee name is embedded in notes as "Employee: Name | ..."
      const employeeName = t.notes?.match(/Employee:\s*([^|]+)/i)?.[1]?.trim() ?? ''
      const matchSearch = q === '' || [
        t.materials?.code,
        t.materials?.name,
        t.project_name,
        t.notes,
        employeeName,
        t.store_name,
      ].some(field => field?.toLowerCase().includes(q))

      // ── Dropdown filters ──
      const matchProject = filterProject === '' || t.project_name === filterProject
      const matchCode    = filterCode === ''    || t.materials?.code === filterCode
      const matchVendor  = filterVendor === ''  || t.store_name === filterVendor

      return matchType && matchDate && matchSearch && matchProject && matchCode && matchVendor
    })
  }, [transactions, filterType, filterDays, filterSearch, filterProject, filterCode, filterVendor])

  const totalOut = filtered.filter(t => t.type?.toUpperCase() === 'OUT' && t.unit_price)
    .reduce((s, t) => {
      const coverage = computeTransactionCoverage(t.materials || { code: '' }, t.sheet_size, t.quantity)
      return s + (t.unit_price! * coverage)
    }, 0)

  function exportExcel() {
    const rows = filtered.map(t => {
      const coverage = computeTransactionCoverage(t.materials || { code: '' }, t.sheet_size, t.quantity)
      return {
        Date: new Date(t.created_at).toLocaleString('en-US'),
        Type: t.type === 'IN' ? 'In' : 'Out',
        Project: t.project_name || '',
        Code: t.materials?.code || '',
        Material: t.materials?.name || '',
        Category: t.materials?.category || '',
        'Sheets/Pcs': t.sheet_count ?? '',
        'Size': t.sheet_size || '',
        Quantity: t.quantity,
        Unit: t.materials?.unit || '',
        Vendor: t.store_name || '',
        'Unit Price': t.unit_price ? `$${Number(t.unit_price).toFixed(4)}` : '',
        'Total': t.unit_price ? `$${(t.unit_price * coverage).toFixed(2)}` : '',
        Notes: t.notes || '',
      }
    })
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'History')
    const suffix = filterProject ? `-${filterProject.replace(/[^a-zA-Z0-9]/g, '_')}` : ''
    XLSX.writeFile(wb, `vgh-history${suffix}-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  function formatDate(dateStr: string) {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US') + ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div className="page-header">
        <div><h2>History</h2><p>{filtered.length} transactions found{totalOut > 0 ? ` · Total: $${totalOut.toFixed(2)}` : ''}</p></div>
        <button className="btn btn-secondary" onClick={exportExcel}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 3v4a1 1 0 001 1h4M17 21H7a2 2 0 01-2-2V5a2 2 0 012-2h7l5 5v11a2 2 0 01-2 2zM12 11v6M9 14l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Export Excel
        </button>
      </div>

      <div className="page-body">
        {/* ── Filter Toolbar ── */}
        {(() => {
          const hasActive = filterSearch !== '' || filterType !== 'ALL' || filterDays !== '30'
            || filterCode !== '' || filterVendor !== '' || filterProject !== ''
          const clearAll = () => {
            setFilterSearch(''); setFilterType('ALL'); setFilterDays('30')
            setFilterCode(''); setFilterVendor(''); setFilterProject('')
          }
          return (
            <div className="mb-5 overflow-hidden rounded-card border border-border-base bg-bg-card">

              {/* Row 1: Search · Type toggle · Date range */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border-base px-3.5 py-3">

                {/* Search */}
                <div className="search-wrapper min-w-0 flex-1 basis-44">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
                  </svg>
                  <input
                    className="form-control"
                    placeholder="Search code, name, project, employee..."
                    value={filterSearch}
                    onChange={e => setFilterSearch(e.target.value)}
                    style={{ paddingLeft: 36 }}
                  />
                </div>

                {/* Type toggle */}
                <div className="toggle-group w-auto shrink-0">
                  {(['ALL', 'IN', 'OUT'] as const).map(t => (
                    <button key={t} type="button"
                      className={`toggle-btn ${filterType === t ? (t === 'OUT' ? 'active-out' : 'active-in') : ''}`}
                      onClick={() => setFilterType(t)}
                      style={{ padding: '8px 14px', fontSize: 13 }}
                    >{t === 'ALL' ? 'All' : t === 'IN' ? '↑ In' : '↓ Out'}</button>
                  ))}
                </div>

                {/* Date range */}
                <select
                  className="form-control w-auto shrink-0"
                  value={filterDays}
                  onChange={e => setFilterDays(e.target.value)}
                >
                  <option value="7">Last 7 days</option>
                  <option value="30">Last 30 days</option>
                  <option value="90">Last 90 days</option>
                  <option value="365">Last year</option>
                  <option value="9999">All time</option>
                </select>
              </div>

              {/* Row 2: Code · Vendor · Project · Clear */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-2.5">

                <select
                  className="form-control w-auto min-w-[130px]"
                  value={filterCode}
                  onChange={e => setFilterCode(e.target.value)}
                >
                  <option value="">All codes</option>
                  {codes.map(c => <option key={c} value={c}>{c}</option>)}
                </select>

                <select
                  className="form-control w-auto min-w-[130px]"
                  value={filterVendor}
                  onChange={e => setFilterVendor(e.target.value)}
                >
                  <option value="">All vendors</option>
                  {vendors.map(v => <option key={v} value={v}>{v}</option>)}
                </select>

                <select
                  className="form-control w-auto min-w-[150px]"
                  value={filterProject}
                  onChange={e => setFilterProject(e.target.value)}
                >
                  <option value="">All projects</option>
                  {projects.map(p => <option key={p} value={p}>📍 {p}</option>)}
                </select>

                {hasActive && (
                  <button
                    type="button"
                    className="btn btn-outline ml-auto shrink-0 text-xs"
                    onClick={clearAll}
                    style={{ padding: '6px 12px' }}
                  >
                    ✕ Clear filters
                  </button>
                )}
              </div>
            </div>
          )
        })()}

        {/* Table */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {loading ? (
            <div className="loader"><div className="spinner" /></div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <h3>No transactions</h3>
              <p>No activity in this period/filter</p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Project</th>
                    <th>Code</th>
                    <th>Material</th>
                    <th>Size</th>
                    <th>Qty</th>
                    <th>Un</th>
                    <th>Vendor</th>
                    <th>Unit Price</th>
                    <th>Total</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(t => {
                    const coverage = computeTransactionCoverage(t.materials || { code: '' }, t.sheet_size, t.quantity)
                    const lineTotal = t.unit_price ? t.unit_price * coverage : null
                    return (
                      <tr key={t.id}>
                        <td style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap', fontSize: 12 }}>{formatDate(t.created_at)}</td>
                        <td><span className={t.type?.toUpperCase() === 'IN' ? 'type-in' : 'type-out'}>{t.type?.toUpperCase() === 'IN' ? '↑ In' : '↓ Out'}</span></td>
                        <td style={{ fontSize: 12, color: t.project_name ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                          {t.project_name ? <span>📍 {t.project_name}</span> : '—'}
                        </td>
                        <td><span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--green-light)', fontSize: 12 }}>{t.materials?.code}</span></td>
                        <td style={{ maxWidth: 180, fontSize: 13 }}>{t.materials?.name}</td>
                        {/* Size badge */}
                        <td style={{ textAlign: 'center' }}>
                          {t.sheet_size ? (
                            <span style={{
                              display: 'inline-flex', flexDirection: 'column', alignItems: 'center',
                              background: 'rgba(96,165,250,0.12)', border: '1px solid rgba(96,165,250,0.3)',
                              borderRadius: 6, padding: '2px 8px', fontSize: 12,
                              fontFamily: 'monospace', fontWeight: 700, color: '#60A5FA',
                            }}>
                              {t.sheet_size}
                              {t.sheet_count != null && (
                                <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-muted)', fontFamily: 'inherit' }}>
                                  {t.sheet_count} pc{t.sheet_count !== 1 ? 's' : ''}
                                </span>
                              )}
                            </span>
                          ) : '—'}
                        </td>
                        <td style={{ fontWeight: 700, textAlign: 'right' }}>{t.quantity}</td>
                        <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{t.materials?.unit}</td>
                        <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{t.store_name || '—'}</td>
                        <td style={{ textAlign: 'right', color: '#F59E0B', fontWeight: 600, fontSize: 13 }}>
                          {t.unit_price ? `$${Number(t.unit_price).toFixed(4)}` : '—'}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: lineTotal ? '#F59E0B' : 'var(--text-muted)' }}>
                          {lineTotal ? `$${lineTotal.toFixed(2)}` : '—'}
                        </td>
                        <td style={{ color: 'var(--text-muted)', fontSize: 12, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {t.notes || '—'}
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
