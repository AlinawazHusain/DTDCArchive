import { useState, useCallback, useRef } from 'react'
import Button from '../../components/common/Button'
import { COLORS, RADIUS } from '../../constants/theme'
import { useApp } from '../../context/AppContext'
import { callApi } from '../../utils/api'
import DashboardLayout from '../../components/layout/DashboardLayout'
import { debounce } from 'lodash'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'

const STATUS_OPTIONS = [
  '', 'Pending', 'Delivered', 'In Transit', 'RTO', 'Lost', 'Damaged', 'Cancelled',
]


export default function RTOPage() {
  const { addToast } = useApp()

  // ── Filter state ──────────────────────────────────────────────────────
  const [cnno,             setCnno]             = useState('')
  const [dateFrom,         setDateFrom]         = useState('')
  const [dateTo,           setDateTo]           = useState('')
  const [statusFilter,     setStatusFilter]     = useState('')
  const [clientName,       setClientName]       = useState('')
  const [clientId,         setClientId]         = useState(null)
  const [clientSuggestions,setClientSuggestions]= useState([])
  const [showSuggestions,  setShowSuggestions]  = useState(false)

  // ── Data state ────────────────────────────────────────────────────────
  const [loading,  setLoading]  = useState(false)
  const [saving,   setSaving]   = useState(null)
  const [bookings, setBookings] = useState([])
  const [fetched,  setFetched]  = useState(false)

  // ── CSV Upload state ──────────────────────────────────────────────────
  const [csvRows,        setCsvRows]        = useState([])       // parsed preview rows
  const [csvFileName,    setCsvFileName]    = useState('')
  const [csvError,       setCsvError]       = useState('')
  const [csvUploading,   setCsvUploading]   = useState(false)
  const [csvResult,      setCsvResult]      = useState(null)     // { success, failed, errors }
  const [showCsvPanel,   setShowCsvPanel]   = useState(false)
  const csvFileRef = useRef(null)

  const cnnoRef = useRef(null)
  const token   = () => localStorage.getItem('access_token')

  // ── Client autocomplete ───────────────────────────────────────────────
  const fetchSuggestions = useCallback(
    debounce(async (val) => {
      if (!val.trim()) { setClientSuggestions([]); setShowSuggestions(false); return }
      try {
        const res = await callApi({
          url: `/api/searchClientsByName?name=${encodeURIComponent(val)}`,
          method: 'GET',
          headers: { Authorization: `Bearer ${token()}` },
        })
        setClientSuggestions(res || [])
        setShowSuggestions(true)
      } catch { /* silent */ }
    }, 350),
    []
  )

  const handleClientChange = (val) => {
    setClientName(val)
    setClientId(null)
    fetchSuggestions(val)
  }

  const selectClient = (c) => {
    setClientName(c.name)
    setClientId(c.id)
    setClientSuggestions([])
    setShowSuggestions(false)
  }

  // ── Search ────────────────────────────────────────────────────────────
  const handleSearch = async () => {
    const hasCnno   = cnno.trim()
    const hasDate   = dateFrom || dateTo
    const hasClient = clientId
    const hasStatus = statusFilter

    if (!hasCnno && !hasDate && !hasClient && !hasStatus) {
      addToast('Enter at least one filter to search.', 'error')
      return
    }
    if (clientName.trim() && !clientId) {
      addToast('Please select a client from the dropdown.', 'error')
      return
    }

    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (hasCnno)   params.append('cnno',      cnno.trim())
      if (dateFrom)  params.append('date_from', dateFrom)
      if (dateTo)    params.append('date_to',   dateTo)
      if (clientId)  params.append('client_id', clientId)
      if (hasStatus) params.append('status',    statusFilter)

      const data = await callApi({
        url: `/api/rto/bookings/filter?${params.toString()}`,
        method: 'GET',
        headers: { Authorization: `Bearer ${token()}` },
      })

      const rows = Array.isArray(data) ? data : (data.bookings ?? data.data ?? [])
      setBookings(rows.map(r => ({
        ...r,
        _edited:          false,
        RTO_RECEIPT_DATE:  r.RTO_RECEIPT_DATE  ?? null,
        RTO_DELIVERY_DATE: r.RTO_DELIVERY_DATE ?? null,
      })))
      setFetched(true)

      if (rows.length === 0) addToast('No bookings found.', 'error')
      else addToast(`${rows.length} booking${rows.length !== 1 ? 's' : ''} found.`, 'success')
    } catch {
      addToast('Failed to fetch bookings. Please try again.', 'error')
    } finally {
      setLoading(false)
      cnnoRef.current?.focus()
    }
  }

  const handleCnnoKeyDown = (e) => {
    if (e.key === 'Enter') handleSearch()
  }

  const handleChange = (index, key, val) => {
    setBookings(prev => prev.map((r, i) =>
      i === index ? { ...r, [key]: val, _edited: true } : r
    ))
  }

  const handleSave = async (row, index) => {
    setSaving(index)
    try {
      await callApi({
        url: '/api/rto/bookingUpdate',
        method: 'PUT',
        body: {
          data: {
            id:                row.id,
            RTO_RECEIPT_DATE:  row.RTO_RECEIPT_DATE,
            RTO_DELIVERY_DATE: row.RTO_DELIVERY_DATE,
            RECEIVED_BY:       row.RECEIVED_BY,
            POD_LINK:          row.POD_LINK,
          }
        },
        headers: { Authorization: `Bearer ${token()}` },
      })
      setBookings(prev => prev.map((r, i) => i === index ? { ...r, _edited: false } : r))
      addToast(`Booking ${row.DSR_CNNO} updated!`, 'success')
    } catch {
      addToast('Failed to save. Please try again.', 'error')
    } finally {
      setSaving(null)
    }
  }

  const handleClear = () => {
    setCnno(''); setDateFrom(''); setDateTo('')
    setStatusFilter(''); setClientName(''); setClientId(null)
    setClientSuggestions([]); setShowSuggestions(false)
    setBookings([]); setFetched(false)
    cnnoRef.current?.focus()
  }

  // ── CSV Parsing ───────────────────────────────────────────────────────
  const handleCsvFile = (file) => {
  if (!file) return
  if (!file.name.match(/\.(csv|xlsx?)$/i)) {
    setCsvError('Please upload a .csv, .xlsx, or .xls file.')
    setCsvRows([]); setCsvFileName(''); return
  }

  setCsvFileName(file.name)
  setCsvError('')
  setCsvResult(null)

  const reader = new FileReader()
  reader.onload = (e) => {
    try {
      const workbook = XLSX.read(e.target.result, { type: 'array', cellDates: true })
      const sheet    = workbook.Sheets[workbook.SheetNames[0]]
      const raw = XLSX.utils.sheet_to_json(sheet, {
        defval: '',
        raw: false,
        dateNF: 'yyyy-mm-dd',
      })

      if (!raw.length) {
        setCsvError('The file is empty or has no data rows.')
        setCsvRows([]); return
      }

      const headers = Object.keys(raw[0]).map(h => h.toLowerCase())
      if (!headers.includes('cnno')) {
        setCsvError('Missing required column: CnNo. Expected: CnNo, RefNo, RTO_RECEIPT_DATE, RTO_DELIVERY_DATE, RECEIVER_NAME')
        setCsvRows([]); return
      }

      const normalized = raw.map(row => {
        const lower = {}
        Object.keys(row).forEach(k => {
          const value = row[k]

          // Handle Excel date objects
          lower[k.toLowerCase()] = String(value ?? '').trim()
        })
        return {
          CnNo:              lower['cnno']              || '',
          RefNo:             lower['refno']             || '',
          RTO_RECEIPT_DATE:  lower['rto_receipt_date']  || '',
          RTO_DELIVERY_DATE: lower['rto_delivery_date'] || '',
          RECEIVER_NAME:     lower['receiver_name']     || '',
        }
      }).filter(r => r.CnNo)

      if (!normalized.length) {
        setCsvError('No valid rows found (every row is missing a CnNo).')
        setCsvRows([]); return
      }

      setCsvRows(normalized)
    } catch (err) {
      setCsvError(`Parse error: ${err.message}`)
      setCsvRows([])
    }
  }
  reader.readAsArrayBuffer(file)
}

  const handleCsvDrop = (e) => {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file) handleCsvFile(file)
  }

  const handleCsvInputChange = (e) => {
    handleCsvFile(e.target.files?.[0])
  }

  const handleCsvClear = () => {
    setCsvRows([])
    setCsvFileName('')
    setCsvError('')
    setCsvResult(null)
    if (csvFileRef.current) csvFileRef.current.value = ''
  }

  // ── CSV Submit ────────────────────────────────────────────────────────
  const handleCsvSubmit = async () => {
    if (!csvRows.length) return
    setCsvUploading(true)
    setCsvResult(null)
    try {
      const response = await callApi({
        url: '/api/rto/bulkUpdate',
        method: 'POST',
        body: { data: csvRows },
        headers: { Authorization: `Bearer ${token()}` },
      })

      // Expect API to return { success: N, failed: N, errors: [...] }
      const result = {
        success: response?.success ?? response?.updated ?? csvRows.length,
        failed:  response?.failed  ?? response?.errors?.length ?? 0,
        errors:  response?.errors  ?? [],
      }
      setCsvResult(result)

      if (result.failed === 0) {
        addToast(`✅ ${result.success} record${result.success !== 1 ? 's' : ''} updated successfully!`, 'success')
      } else {
        addToast(`⚠️ ${result.success} updated, ${result.failed} failed.`, 'error')
      }
    } catch {
      addToast('Bulk upload failed. Please try again.', 'error')
    } finally {
      setCsvUploading(false)
    }
  }

  // ── Styles ────────────────────────────────────────────────────────────
  const labelStyle = {
    fontSize: 12, fontWeight: 600, color: COLORS.gray,
    display: 'block', marginBottom: 5,
  }
  const inputStyle = {
    padding: '9px 12px', fontSize: 13, width: '100%', boxSizing: 'border-box',
    border: `1.5px solid ${COLORS.border}`, borderRadius: RADIUS.md,
    outline: 'none', color: COLORS.dark, fontFamily: "'DM Sans', sans-serif",
  }
  const thStyle = {
    padding: '11px 14px', textAlign: 'left',
    color: COLORS.gray, fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap',
  }
  const tdStyle = {
    padding: '10px 14px', fontSize: 13,
    color: COLORS.dark, verticalAlign: 'middle',
  }

  const unsavedCount = bookings.filter(r => r._edited).length

  return (
    <DashboardLayout>

      {/* ── Page Header ── */}
      <div style={{ marginBottom: 22 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: COLORS.dark, fontFamily: "'Syne', sans-serif" }}>
          RTO Management
        </h2>
        <p style={{ fontSize: 13, color: COLORS.gray, marginTop: 2 }}>
          Search by AWB / scan barcode · Update RTO receipt, delivery dates and POD · Bulk upload via CSV.
        </p>
      </div>

      {/* ── Filter Panel ── */}
      <div style={{
        background: COLORS.white, border: `1px solid ${COLORS.border}`,
        borderRadius: RADIUS.lg, padding: '20px 22px', marginBottom: 20,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: COLORS.dark, margin: 0 }}>
            🔎 Search Bookings
          </h3>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {/* ── Toggle CSV Panel ── */}
            <button
              onClick={() => setShowCsvPanel(v => !v)}
              style={{
                fontSize: 12, fontWeight: 700,
                background: showCsvPanel ? COLORS.primary + '15' : COLORS.bgPage,
                color: showCsvPanel ? COLORS.primary : COLORS.gray,
                border: `1px solid ${showCsvPanel ? COLORS.primary + '40' : COLORS.border}`,
                borderRadius: RADIUS.full, padding: '5px 14px', cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              📂 Bulk CSV Upload
            </button>
            {fetched && (
              <button onClick={handleClear} style={{
                fontSize: 12, color: COLORS.danger, background: 'none',
                border: `1px solid ${COLORS.danger}20`, borderRadius: RADIUS.full,
                padding: '4px 12px', cursor: 'pointer', fontWeight: 600,
              }}>
                ✕ Clear &amp; Reset
              </button>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>

          {/* ── AWB / Barcode ── */}
          <div style={{ flex: '2 1 200px', minWidth: 180 }}>
            <label style={labelStyle}>
              AWB / CN Number
              <span style={{
                marginLeft: 8, fontSize: 10, fontWeight: 700,
                background: COLORS.primary + '15', color: COLORS.primary,
                borderRadius: 4, padding: '2px 7px', verticalAlign: 'middle',
              }}>
                📷 SCANNER READY
              </span>
            </label>
            <input
              ref={cnnoRef}
              value={cnno}
              onChange={e => setCnno(e.target.value)}
              onKeyDown={handleCnnoKeyDown}
              placeholder="Scan barcode or type AWB…"
              autoFocus
              autoComplete="off"
              style={{
                ...inputStyle,
                fontFamily: 'monospace', fontSize: 14, letterSpacing: 1,
                borderColor: cnno ? COLORS.primary + '80' : COLORS.border,
                background:  cnno ? COLORS.primary + '05' : '#fff',
              }}
            />
          </div>

          {/* ── Client autocomplete ── */}
          <div style={{ position: 'relative', flex: '2 1 200px', minWidth: 180 }}>
            <label style={labelStyle}>Client Name</label>
            <input
              value={clientName}
              onChange={e => handleClientChange(e.target.value)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 180)}
              onFocus={() => clientSuggestions.length > 0 && setShowSuggestions(true)}
              placeholder="Type to search client…"
              style={{
                ...inputStyle,
                borderColor: clientId ? COLORS.primary + '80' : COLORS.border,
                background:  clientId ? COLORS.primary + '06' : '#fff',
              }}
            />
            {clientId && (
              <span style={{
                position: 'absolute', right: 10, top: 32,
                fontSize: 10, background: COLORS.success + '20',
                color: COLORS.success, borderRadius: 4,
                padding: '2px 7px', fontWeight: 700,
              }}>✓</span>
            )}
            {showSuggestions && clientSuggestions.length > 0 && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 9999,
                background: '#fff', border: `1px solid ${COLORS.border}`,
                borderRadius: RADIUS.md, maxHeight: 200, overflowY: 'auto',
                boxShadow: '0 6px 16px rgba(0,0,0,0.1)', marginTop: 4,
              }}>
                {clientSuggestions.map((c, i) => (
                  <div key={i} onMouseDown={() => selectClient(c)}
                    style={{
                      padding: '10px 14px', cursor: 'pointer', fontSize: 13,
                      display: 'flex', justifyContent: 'space-between',
                      borderBottom: i < clientSuggestions.length - 1
                        ? `1px solid ${COLORS.grayLight}` : 'none',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = COLORS.bgPage}
                    onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                  >
                    <span style={{ fontWeight: 600, color: COLORS.dark }}>{c.name}</span>
                    <span style={{ color: COLORS.gray, fontSize: 12 }}>{c.phone}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Date From ── */}
          <div style={{ flex: '1 1 140px', minWidth: 130 }}>
            <label style={labelStyle}>Booking Date From</label>
            <input type="date" value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              style={inputStyle}
            />
          </div>

          {/* ── Date To ── */}
          <div style={{ flex: '1 1 140px', minWidth: 130 }}>
            <label style={labelStyle}>Booking Date To</label>
            <input type="date" value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              style={inputStyle}
            />
          </div>

          {/* ── Status ── */}
          <div style={{ flex: '1 1 140px', minWidth: 130 }}>
            <label style={labelStyle}>Status</label>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              style={{ ...inputStyle, cursor: 'pointer' }}>
              <option value="">All Statuses</option>
              {STATUS_OPTIONS.filter(Boolean).map(o => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </div>

          <div style={{ paddingBottom: 1 }}>
            <Button onClick={handleSearch} disabled={loading}>
              {loading ? 'Searching…' : '🔍 Search'}
            </Button>
          </div>
        </div>

        {/* Active filter chips */}
        {fetched && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
            {cnno && (
              <span style={{
                background: COLORS.primary + '15', color: COLORS.primary,
                border: `1px solid ${COLORS.primary}30`,
                borderRadius: RADIUS.full, padding: '4px 12px',
                fontSize: 12, fontWeight: 600, fontFamily: 'monospace',
              }}>📦 {cnno}</span>
            )}
            {clientName && (
              <span style={{
                background: COLORS.primary + '15', color: COLORS.primary,
                border: `1px solid ${COLORS.primary}30`,
                borderRadius: RADIUS.full, padding: '4px 12px', fontSize: 12, fontWeight: 600,
              }}>👤 {clientName}</span>
            )}
            {(dateFrom || dateTo) && (
              <span style={{
                background: COLORS.success + '15', color: COLORS.success,
                border: `1px solid ${COLORS.success}30`,
                borderRadius: RADIUS.full, padding: '4px 12px', fontSize: 12, fontWeight: 600,
              }}>📅 {dateFrom || '…'} → {dateTo || '…'}</span>
            )}
            {statusFilter && (
              <span style={{
                background: COLORS.warning + '15', color: COLORS.warning,
                border: `1px solid ${COLORS.warning}30`,
                borderRadius: RADIUS.full, padding: '4px 12px', fontSize: 12, fontWeight: 600,
              }}>🔖 {statusFilter}</span>
            )}
            <span style={{
              background: COLORS.grayLight, color: COLORS.gray,
              borderRadius: RADIUS.full, padding: '4px 12px', fontSize: 12,
            }}>
              {bookings.length} result{bookings.length !== 1 ? 's' : ''}
            </span>
          </div>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════════════ */}
      {/* ── CSV Upload Panel ── */}
      {/* ════════════════════════════════════════════════════════════════ */}
      {showCsvPanel && (
        <div style={{
          background: COLORS.white, border: `1.5px solid ${COLORS.primary}30`,
          borderRadius: RADIUS.lg, padding: '20px 22px', marginBottom: 20,
          boxShadow: `0 0 0 4px ${COLORS.primary}08`,
        }}>
          {/* Panel header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: COLORS.dark, margin: 0 }}>
                📂 Bulk RTO Update via CSV or Excel
              </h3>
              <p style={{ fontSize: 12, color: COLORS.gray, marginTop: 4, marginBottom: 0 }}>
                Upload a CSV or Excel with columns: <code style={{ background: COLORS.bgPage, padding: '1px 6px', borderRadius: 4, fontFamily: 'monospace' }}>CnNo, RefNo, RTO_RECEIPT_DATE, RTO_DELIVERY_DATE, RECEIVER_NAME</code>
              </p>
            </div>
            {csvRows.length > 0 && (
              <button onClick={handleCsvClear} style={{
                fontSize: 12, color: COLORS.danger, background: 'none',
                border: `1px solid ${COLORS.danger}20`, borderRadius: RADIUS.full,
                padding: '4px 12px', cursor: 'pointer', fontWeight: 600,
              }}>✕ Clear</button>
            )}
          </div>

          {/* ── Drop Zone ── */}
          {!csvRows.length && (
            <div
              onDrop={handleCsvDrop}
              onDragOver={e => e.preventDefault()}
              onClick={() => csvFileRef.current?.click()}
              style={{
                border: `2px dashed ${csvError ? COLORS.danger + '60' : COLORS.primary + '40'}`,
                borderRadius: RADIUS.lg, padding: '36px 20px',
                textAlign: 'center', cursor: 'pointer',
                background: csvError ? COLORS.danger + '04' : COLORS.primary + '03',
                transition: 'all 0.2s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = COLORS.primary + '07'}
              onMouseLeave={e => e.currentTarget.style.background = csvError ? COLORS.danger + '04' : COLORS.primary + '03'}
            >
              <div style={{ fontSize: 36, marginBottom: 10 }}>📄</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.dark, marginBottom: 6 }}>
                {csvFileName ? csvFileName : 'Drop your CSV here, or click to browse'}
              </div>
              <div style={{ fontSize: 12, color: COLORS.gray }}>
                Supports .csv files · Columns: CnNo, RefNo, RTO_RECEIPT_DATE, RTO_DELIVERY_DATE, RECEIVER_NAME
              </div>
              {csvError && (
                <div style={{
                  marginTop: 12, fontSize: 12, color: COLORS.danger,
                  fontWeight: 600, background: COLORS.danger + '10',
                  borderRadius: RADIUS.md, padding: '8px 14px', display: 'inline-block',
                }}>
                  ⚠️ {csvError}
                </div>
              )}
              <input
                ref={csvFileRef}
                type="file"
                accept=".csv , .xlsx , .xls"
                style={{ display: 'none' }}
                onChange={handleCsvInputChange}
              />
            </div>
          )}

          {/* ── Preview Table ── */}
          {csvRows.length > 0 && (
            <>
              {/* Stats bar */}
              <div style={{
                display: 'flex', gap: 12, flexWrap: 'wrap',
                alignItems: 'center', marginBottom: 14,
              }}>
                <span style={{
                  background: COLORS.primary + '12', color: COLORS.primary,
                  borderRadius: RADIUS.full, padding: '5px 14px',
                  fontSize: 12, fontWeight: 700,
                }}>
                  📋 {csvRows.length} row{csvRows.length !== 1 ? 's' : ''} ready to upload
                </span>
                <span style={{ fontSize: 12, color: COLORS.gray }}>
                  from <strong>{csvFileName}</strong>
                </span>

                {/* Result badge */}
                {csvResult && (
                  <>
                    <span style={{
                      background: COLORS.success + '15', color: COLORS.success,
                      borderRadius: RADIUS.full, padding: '5px 14px',
                      fontSize: 12, fontWeight: 700,
                    }}>
                      ✅ {csvResult.success} updated
                    </span>
                    {csvResult.failed > 0 && (
                      <span style={{
                        background: COLORS.danger + '15', color: COLORS.danger,
                        borderRadius: RADIUS.full, padding: '5px 14px',
                        fontSize: 12, fontWeight: 700,
                      }}>
                        ❌ {csvResult.failed} failed
                      </span>
                    )}
                  </>
                )}
              </div>

              {/* Preview table (first 10 rows) */}
              <div style={{
                border: `1px solid ${COLORS.border}`, borderRadius: RADIUS.md,
                overflow: 'hidden', marginBottom: 16,
              }}>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: COLORS.bgPage }}>
                        {['#', 'CnNo', 'RefNo', 'RTO Receipt Date', 'RTO Delivery Date', 'Receiver Name'].map(h => (
                          <th key={h} style={{
                            ...thStyle, fontSize: 11, padding: '9px 12px',
                            borderBottom: `1px solid ${COLORS.border}`,
                          }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {csvRows.slice(0, 10).map((r, i) => {
                        // highlight rows that errored after submit
                        const errored = csvResult?.errors?.some(e =>
                          e.cnno === r.CnNo || e.row === i + 1
                        )
                        return (
                          <tr key={i} style={{
                            borderTop: `1px solid ${COLORS.grayLight}`,
                            background: errored
                              ? COLORS.danger + '08'
                              : i % 2 === 0 ? '#fff' : COLORS.bgPage + '50',
                          }}>
                            <td style={{ ...tdStyle, fontSize: 11, color: COLORS.gray, padding: '8px 12px' }}>
                              {errored ? '❌' : i + 1}
                            </td>
                            <td style={{ ...tdStyle, fontFamily: 'monospace', fontWeight: 600, color: COLORS.primary, padding: '8px 12px', fontSize: 12 }}>
                              {r.CnNo || '—'}
                            </td>
                            <td style={{ ...tdStyle, padding: '8px 12px', fontSize: 12 }}>{r.RefNo || '—'}</td>
                            <td style={{ ...tdStyle, padding: '8px 12px', fontSize: 12 }}>{r.RTO_RECEIPT_DATE || '—'}</td>
                            <td style={{ ...tdStyle, padding: '8px 12px', fontSize: 12 }}>{r.RTO_DELIVERY_DATE || '—'}</td>
                            <td style={{ ...tdStyle, padding: '8px 12px', fontSize: 12 }}>{r.RECEIVER_NAME || '—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {csvRows.length > 10 && (
                  <div style={{
                    padding: '8px 14px', fontSize: 12, color: COLORS.gray,
                    borderTop: `1px solid ${COLORS.grayLight}`,
                    background: COLORS.bgPage,
                  }}>
                    … and {csvRows.length - 10} more row{csvRows.length - 10 !== 1 ? 's' : ''} (not shown in preview)
                  </div>
                )}
              </div>

              {/* Error list after submit */}
              {csvResult?.errors?.length > 0 && (
                <div style={{
                  background: COLORS.danger + '08', border: `1px solid ${COLORS.danger}25`,
                  borderRadius: RADIUS.md, padding: '12px 16px', marginBottom: 16,
                }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: COLORS.danger, marginBottom: 8 }}>
                    Failed rows:
                  </div>
                  <ul style={{ margin: 0, padding: '0 0 0 16px', fontSize: 12, color: COLORS.danger }}>
                    {csvResult.errors.slice(0, 10).map((e, i) => (
                      <li key={i} style={{ marginBottom: 3 }}>
                        <strong>{e.cnno || `Row ${e.row}`}</strong>: {e.message || e.error || 'Unknown error'}
                      </li>
                    ))}
                    {csvResult.errors.length > 10 && (
                      <li style={{ color: COLORS.gray }}>…and {csvResult.errors.length - 10} more</li>
                    )}
                  </ul>
                </div>
              )}

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <button
                  onClick={handleCsvSubmit}
                  disabled={csvUploading || (csvResult && csvResult.failed === 0 && csvResult.success > 0)}
                  style={{
                    padding: '10px 24px', fontSize: 13, fontWeight: 700,
                    borderRadius: RADIUS.md, border: 'none', cursor: csvUploading ? 'wait' : 'pointer',
                    background: (csvResult && csvResult.failed === 0 && csvResult.success > 0)
                      ? COLORS.success
                      : COLORS.primary,
                    color: '#fff', fontFamily: "'DM Sans', sans-serif",
                    opacity: csvUploading ? 0.75 : 1,
                    transition: 'all 0.2s',
                  }}
                >
                  {csvUploading
                    ? `⏳ Uploading ${csvRows.length} rows…`
                    : (csvResult && csvResult.failed === 0 && csvResult.success > 0)
                      ? `✅ Done — ${csvResult.success} updated`
                      : `🚀 Upload ${csvRows.length} rows`
                  }
                </button>

                <button onClick={handleCsvClear} style={{
                  padding: '10px 18px', fontSize: 13, fontWeight: 600,
                  borderRadius: RADIUS.md, border: `1.5px solid ${COLORS.border}`,
                  background: '#fff', color: COLORS.gray, cursor: 'pointer',
                  fontFamily: "'DM Sans', sans-serif",
                }}>
                  ✕ Clear &amp; Re-upload
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Results Table ── */}
      <div style={{
        background: COLORS.white, borderRadius: RADIUS.lg,
        border: `1px solid ${COLORS.border}`, overflow: 'hidden',
      }}>
        <div style={{ overflowX: 'auto' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '80px 20px' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
              <div style={{ color: COLORS.gray, fontSize: 14 }}>Searching bookings…</div>
            </div>

          ) : !fetched ? (
            <div style={{ textAlign: 'center', padding: '80px 20px' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>📦</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: COLORS.dark, marginBottom: 8 }}>
                No results yet
              </div>
              <div style={{ fontSize: 13, color: COLORS.gray, maxWidth: 360, margin: '0 auto' }}>
                Scan a barcode, enter an AWB number, or use the filters above to search.
              </div>
            </div>

          ) : bookings.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: COLORS.gray, fontSize: 14 }}>
              No bookings found for the selected filters.
            </div>

          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: COLORS.bgPage }}>
                  {[
                    'Action', 'AWB / CN No.', 'Booking Date',
                    'RTO Receipt Date', 'RTO Delivery Date', 'Received By',
                    'Ref No.', 'Bill To Customer', 'POD Link',
                  ].map(h => <th key={h} style={thStyle}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {bookings.map((row, i) => (
                  <tr key={row.id ?? i} style={{
                    borderTop: `1px solid ${COLORS.grayLight}`,
                    background: row._edited
                      ? COLORS.primary + '07'
                      : i % 2 === 0 ? '#fff' : COLORS.bgPage + '50',
                  }}>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                      <button
                        onClick={() => handleSave(row, i)}
                        disabled={!row._edited || saving === i}
                        style={{
                          padding: '7px 16px', fontSize: 12, fontWeight: 700,
                          borderRadius: RADIUS.md, border: 'none',
                          cursor: row._edited ? 'pointer' : 'not-allowed',
                          background: row._edited ? COLORS.primary : COLORS.grayLight,
                          color:      row._edited ? '#fff' : COLORS.gray,
                          transition: 'all 0.2s', fontFamily: "'DM Sans', sans-serif", minWidth: 80,
                        }}
                      >
                        {saving === i ? '…' : '💾 Save'}
                      </button>
                    </td>
                    <td style={{ ...tdStyle, fontWeight: 600, color: COLORS.primary, whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                      {row.DSR_CNNO || '—'}
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{row.DSR_BOOKING_DATE || '—'}</td>
                    <td style={{ ...tdStyle, minWidth: 155 }}>
                      <input type="date" value={row.RTO_RECEIPT_DATE || ''}
                        onChange={e => handleChange(i, 'RTO_RECEIPT_DATE', e.target.value)}
                        style={inputStyle}
                      />
                    </td>
                    <td style={{ ...tdStyle, minWidth: 155 }}>
                      <input type="date" value={row.RTO_DELIVERY_DATE || ''}
                        onChange={e => handleChange(i, 'RTO_DELIVERY_DATE', e.target.value)}
                        style={inputStyle}
                      />
                    </td>
                    <td style={{ ...tdStyle, minWidth: 150 }}>
                      <input value={row.RECEIVED_BY || ''}
                        onChange={e => handleChange(i, 'RECEIVED_BY', e.target.value)}
                        placeholder="Receiver name…" style={inputStyle}
                      />
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{row.DSR_REFNO || '—'}</td>
                    <td style={{ ...tdStyle, minWidth: 160 }}>{row.BILL_TO_CUSTOMER_NAME || '—'}</td>
                    <td style={{ ...tdStyle, minWidth: 180 }}>
                      <input value={row.POD_LINK || ''}
                        onChange={e => handleChange(i, 'POD_LINK', e.target.value)}
                        placeholder="Paste POD URL…" style={inputStyle}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {fetched && bookings.length > 0 && (
          <div style={{
            padding: '12px 20px', borderTop: `1px solid ${COLORS.grayLight}`,
            fontSize: 13, color: COLORS.gray,
            display: 'flex', justifyContent: 'space-between',
          }}>
            <span>{bookings.length} record{bookings.length !== 1 ? 's' : ''} found</span>
            <span style={{ color: unsavedCount > 0 ? COLORS.warning : COLORS.success, fontWeight: 500 }}>
              {unsavedCount > 0
                ? `⚠️ ${unsavedCount} unsaved change${unsavedCount > 1 ? 's' : ''}`
                : '✓ All saved'}
            </span>
          </div>
        )}
      </div>

    </DashboardLayout>
  )
}