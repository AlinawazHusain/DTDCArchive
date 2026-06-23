import { useState, useCallback , useRef } from 'react'
import Button from '../../components/common/Button'
import { COLORS, RADIUS } from '../../constants/theme'
import { useApp } from '../../context/AppContext'
import { callApi } from '../../utils/api'
import { useNavigate } from 'react-router-dom'
import { debounce } from 'lodash'
import DashboardLayout from '../../components/layout/DashboardLayout'

import * as XLSX from 'xlsx'
import { saveAs } from 'file-saver'

const FR_STATUS_OPTIONS = ['Pending', 'In Progress', 'Resolved', 'Closed', 'Escalated' , 'RTO' , 'Complain']

export default function CustomerSupportPage() {
  const { addToast } = useApp()
  const navigate     = useNavigate()

  // ── Filter state ──────────────────────────────────────────────────────
  const [dateFrom,          setDateFrom]          = useState('')
  const [dateTo,            setDateTo]            = useState('')
  const [clientName,        setClientName]        = useState('')
  const [clientId,          setClientId]          = useState(null)
  const [clientSuggestions, setClientSuggestions] = useState([])
  const [showSuggestions,   setShowSuggestions]   = useState(false)
  const [filterAwb,         setFilterAwb]         = useState('')   // ← 1. new AWB state

  const [selectedRows, setSelectedRows] = useState([])
  const [frCsNameFilter, setFrCsNameFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')


  const [csvRows,        setCsvRows]        = useState([])       // parsed preview rows
  const [csvFileName,    setCsvFileName]    = useState('')
  const [csvError,       setCsvError]       = useState('')
  const [csvUploading,   setCsvUploading]   = useState(false)
  const [csvResult,      setCsvResult]      = useState(null)     // { success, failed, errors }
  const [showCsvPanel,   setShowCsvPanel]   = useState(false)
  const csvFileRef = useRef(null)

  const cnnoRef = useRef(null)


  // ── Data state ────────────────────────────────────────────────────────
  const [loading,  setLoading]  = useState(false)
  const [saving,   setSaving]   = useState(false)
  const [bookings, setBookings] = useState([])
  const [fetched,  setFetched]  = useState(false)

  // ── Misc ──────────────────────────────────────────────────────────────
  const [hover, setHover] = useState(false)
  const token = () => localStorage.getItem('access_token')

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
      } catch { /* silent — don't block typing */ }
    }, 350),
    []
  )

  const handleClientChange = (val) => {
    setClientName(val)
    setClientId(null)
    // Typing a client name clears AWB
    if (val.trim()) setFilterAwb('')
    fetchSuggestions(val)
  }

  const selectClient = (c) => {
    setClientName(c.name)
    setClientId(c.id)
    setClientSuggestions([])
    setShowSuggestions(false)
  }

  // ── 2. Fetch bookings — updated to support AWB-only search ───────────
  const handleSearch = async () => {
    const hasAwb    = filterAwb.trim()
    const hasClient = clientName.trim()

    if (!hasAwb && !hasClient && !frCsNameFilter && !statusFilter) {
      addToast('Select atlease one parameter for serach', 'error')
      return
    }

  

    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (hasAwb) params.append('dsr_cnno', filterAwb.trim())
      if (dateFrom) params.append('date_from', dateFrom)
      if (dateTo) params.append('date_to',   dateTo)
      if (clientId) params.append('client_id', clientId)
      if (frCsNameFilter) params.append('fr_cs_name', frCsNameFilter)
      if (statusFilter)   params.append('fr_status',  statusFilter)

      const data = await callApi({
        url: `/api/customerSupport/bookings/filter?${params.toString()}`,
        method: 'GET',
        headers: { Authorization: `Bearer ${token()}` },
      })
      const rows = Array.isArray(data) ? data : (data.bookings ?? data.data ?? [])
      setBookings(rows.map(r => ({ ...r, _edited: false })))
      setFetched(true)
      if (rows.length === 0) addToast('No bookings found with this search.', 'error')
      else addToast(`${rows.length} booking${rows.length !== 1 ? 's' : ''} found.`, 'success')
    } catch {
      addToast('Failed to fetch bookings. Please try again.', 'error')
    } finally {
      setLoading(false)
    }
  }

  // ── Inline field change ───────────────────────────────────────────────
  const handleChange = (index, key, val) => {
    setBookings(prev => prev.map((r, i) =>
      i === index ? { ...r, [key]: val, _edited: true } : r
    ))
  }


  const toggleRowSelection = (id) => {
  setSelectedRows(prev =>
    prev.includes(id)
      ? prev.filter(r => r !== id)
      : [...prev, id]
  )
}

const toggleSelectAll = () => {
  const ids = bookings.map(r => r.id)

  const allSelected = ids.every(id =>
    selectedRows.includes(id)
  )

  if (allSelected) {
    setSelectedRows(prev =>
      prev.filter(id => !ids.includes(id))
    )
  } else {
    setSelectedRows(prev => [
      ...new Set([...prev, ...ids])
    ])
  }
}

const exportToExcel = () => {
  const rowsToExport = bookings.filter(r =>
    selectedRows.includes(r.id)
  )

  if (rowsToExport.length === 0) {
    addToast('Please select at least one row.', 'error')
    return
  }

  const exportData = rowsToExport.map(r => ({
    AWB: r.DSR_CNNO,
    Booking_Date: r.DSR_BOOKING_DATE,
    FR_Status: r.FR_STATUS,
    FR_CS_Remark: r.FR_CS_REMARK,
    FR_CS_Name: r.FR_CS_NAME,
    Destination: r.DSR_DEST,
    Dest_Pin: r.DSR_DEST_PIN,
    Destination_Branch: r.DESTINATION_BRANCH_NAME,
    EDD_Date: r.EDD_DATE,
    LAST_STATUS_DESCRIPTION : r.LAST_STATUS_DESCRIPTION,
    Receiver_Name: r.RECEIVER_NAME,
    Mobile: r.DSR_MOBILE,
    Client_Name: r.client_name,
  }))

  const worksheet = XLSX.utils.json_to_sheet(exportData)

  const workbook = XLSX.utils.book_new()

  XLSX.utils.book_append_sheet(
    workbook,
    worksheet,
    'CustomerSupport'
  )

  const excelBuffer = XLSX.write(workbook, {
    bookType: 'xlsx',
    type: 'array',
  })

  const blob = new Blob(
    [excelBuffer],
    {
      type:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=UTF-8',
    }
  )

  saveAs(blob, `customer_support_${Date.now()}.xlsx`)

  addToast('Excel exported successfully.', 'success')
}


  // ── Save a single row ─────────────────────────────────────────────────
  const handleSave = async (row, index) => {
    setSaving(true)
    try {
      await callApi({
        url: '/api/customerSupport/bookingUpdate',
        method: 'PUT',
        body: {
          data: {
            id:           row.id,
            FR_STATUS:    row.FR_STATUS,
            FR_CS_REMARK: row.FR_CS_REMARK,
            FR_CS_NAME:   row.FR_CS_NAME,
            RECEIVER_NAME : row.RECEIVER_NAME,
            DSR_MOBILE : row.DSR_MOBILE
          }
        },
        headers: { Authorization: `Bearer ${token()}` },
      })
      setBookings(prev => prev.map((r, i) => i === index ? { ...r, _edited: false } : r))
      addToast(`Booking ${row.DSR_CNNO} updated!`, 'success')
    } catch {
      addToast('Failed to save. Please try again.', 'error')
    } finally {
      setSaving(false)
    }
  }


   const handleClear = () => {
    setDateFrom(''); setDateTo('')
    setStatusFilter(''); setClientName(''); setClientId(null)
    setClientSuggestions([]); setShowSuggestions(false)
    setBookings([]); setFetched(false)
    cnnoRef.current?.focus()
  }

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
          last_status_description:             lower['last status description']             || '',
          destination_branch_name:  lower['destination branch name']  || '',
          booking_date: lower['booking date'] || '',
          edd_date:     lower['edd date']     || '',
          DSR_MOBILE: lower['dsr_mobile'] || '',
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

  const handleCsvSubmit = async () => {
    if (!csvRows.length) return
    setCsvUploading(true)
    setCsvResult(null)
    try {
      const response = await callApi({
        url: '/api/customerSupport/bulkUpdate',
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
    // <div style={{ minHeight: '100vh', background: COLORS.bgPage, padding: '32px 24px' }}>
      <DashboardLayout>

      {/* ── Page Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: COLORS.dark, fontFamily: "'Syne', sans-serif" }}>
            Customer Support — Bookings
          </h2>
          <p style={{ fontSize: 13, color: COLORS.gray, marginTop: 2 }}>
            Filter by AWB number, or by client and date range, then update FR status &amp; remarks inline.
          </p>
        </div>

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
          </div>
      </div>

      {/* ── Filter Panel ── */}
      <div style={{
        background: COLORS.white, border: `1px solid ${COLORS.border}`,
        borderRadius: RADIUS.lg, padding: '20px 22px', marginBottom: 20,
      }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: COLORS.dark, margin: '0 0 16px' }}>
          🔎 Search Bookings
        </h3>

        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>

          {/* ── 3. AWB input ── */}
          <div style={{ flex: '1 1 160px', minWidth: 150 }}>
            <label style={labelStyle}>AWB / CN Number</label>
            <input
              value={filterAwb}
              onChange={e => {
                setFilterAwb(e.target.value)
                // Typing an AWB clears client + date
                if (e.target.value.trim()) {
                  setClientName('')
                  setClientId(null)
                  setDateFrom('')
                  setDateTo('')
                  setClientSuggestions([])
                  setShowSuggestions(false)
                }
              }}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="e.g. 123456789"
              style={inputStyle}
            />
          </div>

          {/* Divider */}
          <div style={{
            display: 'flex', alignItems: 'flex-end', paddingBottom: 10,
            fontSize: 12, color: COLORS.gray, fontWeight: 600, whiteSpace: 'nowrap',
          }}>
            — or —
          </div>

          {/* ── Client autocomplete ── */}
          <div style={{ position: 'relative', flex: '2 1 200px', minWidth: 190 }}>
            <label style={labelStyle}>Client Name</label>
            <input
              value={clientName}
              onChange={e => handleClientChange(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 180)}
              onFocus={() => clientSuggestions.length > 0 && setShowSuggestions(true)}
              placeholder="Type client name to search…"
              style={{
                ...inputStyle,
                borderColor: clientId ? COLORS.primary + '80' : COLORS.border,
                background:  clientId ? COLORS.primary + '06' : '#fff',
              }}
            />
            {clientId && (
              <span style={{
                position: 'absolute', right: 10, top: '50%', transform: 'translateY(4px)',
                fontSize: 11, background: COLORS.success + '20',
                color: COLORS.success, borderRadius: 4, padding: '2px 7px', fontWeight: 600,
              }}>
                ✓ Selected
              </span>
            )}
            {showSuggestions && clientSuggestions.length > 0 && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 9999,
                background: '#fff', border: `1px solid ${COLORS.border}`,
                borderRadius: RADIUS.md, maxHeight: 200, overflowY: 'auto',
                boxShadow: '0 6px 16px rgba(0,0,0,0.1)', marginTop: 4,
              }}>
                {clientSuggestions.map((c, i) => (
                  <div
                    key={i}
                    onMouseDown={() => selectClient(c)}
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
            <label style={labelStyle}>Date From</label>
            <input
              type="date" value={dateFrom}
              onChange={e => { setDateFrom(e.target.value); if (e.target.value) setFilterAwb('') }}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              style={inputStyle}
            />
          </div>

          {/* ── Date To ── */}
          <div style={{ flex: '1 1 140px', minWidth: 130 }}>
            <label style={labelStyle}>Date To</label>
            <input
              type="date" value={dateTo}
              onChange={e => { setDateTo(e.target.value); if (e.target.value) setFilterAwb('') }}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              style={inputStyle}
            />
          </div>

          <div style={{ flex: '1 1 160px', minWidth: 140 }}>
            <label style={labelStyle}>FR CS Name</label>

            <select
              value={frCsNameFilter}
              onChange={(e) => setFrCsNameFilter(e.target.value)}
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              <option value="">All</option>

              {Array.from({ length: 999 }, (_, i) => String(i + 1)).map(n => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>


          <div style={{ flex: '1 1 180px', minWidth: 160 }}>
            <label style={labelStyle}>FR Status</label>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              <option value="">All Status</option>

              {FR_STATUS_OPTIONS.map(status => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>


          <div style={{ display: 'flex', gap: 14, paddingBottom: 1  , flexWrap: 'wrap', alignItems: 'flex-end'}}>
            <Button onClick={handleSearch} disabled={loading}>
              {loading ? 'Searching…' : '🔍 Show Results'}
            </Button>

            <Button
              onClick={exportToExcel}
              disabled={selectedRows.length === 0}
            >
              ⬇ Export Excel
            </Button>

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

        {/* ── 4. Active filter chips — AWB chip added ── */}
        {fetched && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
            {filterAwb && (
              <span style={{
                background: COLORS.primary + '15', color: COLORS.primary,
                border: `1px solid ${COLORS.primary}30`,
                borderRadius: RADIUS.full, padding: '4px 12px', fontSize: 12, fontWeight: 600,
              }}>
                📦 AWB: {filterAwb}
              </span>
            )}
            {clientName && (
              <span style={{
                background: COLORS.primary + '15', color: COLORS.primary,
                border: `1px solid ${COLORS.primary}30`,
                borderRadius: RADIUS.full, padding: '4px 12px', fontSize: 12, fontWeight: 600,
              }}>
                👤 {clientName}
              </span>
            )}
            {(dateFrom || dateTo) && (
              <span style={{
                background: COLORS.success + '15', color: COLORS.success,
                border: `1px solid ${COLORS.success}30`,
                borderRadius: RADIUS.full, padding: '4px 12px', fontSize: 12, fontWeight: 600,
              }}>
                📅 {dateFrom || '…'} → {dateTo || '…'}
              </span>
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
                📂 Bulk Customer Support Update via CSV / Excel
              </h3>
              <p style={{ fontSize: 12, color: COLORS.gray, marginTop: 4, marginBottom: 0 }}>
                Upload a CSV / Excel with columns: <code style={{ background: COLORS.bgPage, padding: '1px 6px', borderRadius: 4, fontFamily: 'monospace' }}>CnNo, Destination Branch Name , Last Status Description, Booking Date, EDD Date, DSR_MOBILE ,RECEIVER_NAME</code>
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
                        {['#', 'CnNo', 'booking_date', 'edd_date' , 'last_status_description' , 'destination_branch_name' ,'DSR_MOBILE' ,  'RECEIVER_NAME'].map(h => (
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
                            <td style={{ ...tdStyle, padding: '8px 12px', fontSize: 12 }}>{r.booking_date || '—'}</td>
                            <td style={{ ...tdStyle, padding: '8px 12px', fontSize: 12 }}>{r.edd_date || '—'}</td>
                            <td style={{ ...tdStyle, padding: '8px 12px', fontSize: 12 }}>{r.last_status_description || '—'}</td>
                            <td style={{ ...tdStyle, padding: '8px 12px', fontSize: 12 }}>{r.destination_branch_name || '—'}</td>
                            <td style={{ ...tdStyle, padding: '8px 12px', fontSize: 12 }}>{r.DSR_MOBILE || '—'}</td>
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
              <div style={{ fontSize: 13, color: COLORS.gray }}>
                Search by <strong>AWB number</strong>, or select a <strong>client</strong> and <strong>date range</strong>.
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
                  <th style={thStyle}>
                    <input
                      type="checkbox"
                      checked={
                        bookings.length > 0 &&
                        bookings.every(r =>
                          selectedRows.includes(r.id)
                        )
                      }
                      onChange={toggleSelectAll}
                    />
                  </th>

                  {[
                    'Action',
                    'AWB / CN No.',
                    'Booking Date',
                    'EDD Date',
                    'Last Status Description',
                    'FR Status',
                    'FR CS Remark',
                    'FR CS Name',
                    'Destination',
                    'Dest. Pin',
                    'Dest. Branch',
                    'Receiver Name',
                    'Mobile',
                    'Client Name',
                  ].map(h => (
                    <th key={h} style={thStyle}>
                      {h}
                    </th>
                  ))}
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
                    <td style={tdStyle}>
                      <input
                        type="checkbox"
                        checked={selectedRows.includes(row.id)}
                        onChange={() => toggleRowSelection(row.id)}
                      />
                    </td>
                    {/* ── Save button ── */}
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                      <button
                        onClick={() => handleSave(row, i)}
                        disabled={!row._edited || saving}
                        style={{
                          padding: '7px 16px', fontSize: 12, fontWeight: 700,
                          borderRadius: RADIUS.md, border: 'none',
                          cursor: row._edited ? 'pointer' : 'not-allowed',
                          background: row._edited ? COLORS.primary : COLORS.grayLight,
                          color:      row._edited ? '#fff' : COLORS.gray,
                          transition: 'all 0.2s', fontFamily: "'DM Sans', sans-serif",
                        }}
                      >
                        {saving ? '...' : '💾 Save'}
                      </button>
                    </td>

                    <td style={{ ...tdStyle, fontWeight: 600, color: COLORS.primary, whiteSpace: 'nowrap' }}>
                      {row.DSR_CNNO || '—'}
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{row.DSR_BOOKING_DATE || '—'}</td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{row.EDD_DATE || '—'}</td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{row.LAST_STATUS_DESCRIPTION || '—'}</td>
                    {/* ── FR Status dropdown ── */}
                    <td style={{ ...tdStyle, minWidth: 140 }}>
                      <select
                        value={row.FR_STATUS || ''}
                        onChange={e => handleChange(i, 'FR_STATUS', e.target.value)}
                        style={{
                          ...inputStyle, padding: '7px 10px', cursor: 'pointer',
                          background:   row.FR_STATUS ? COLORS.primary + '0f' : '#fff',
                          borderColor:  row.FR_STATUS ? COLORS.primary + '60' : COLORS.border,
                          fontWeight: 500,
                        }}
                      >
                        <option value="">— Select —</option>
                        {FR_STATUS_OPTIONS.map(o => (
                          <option key={o} value={o}>{o}</option>
                        ))}
                      </select>
                    </td>

                    {/* ── FR CS Remark ── */}
                    <td style={{ ...tdStyle, minWidth: 180 }}>
                      <input
                        value={row.FR_CS_REMARK || ''}
                        onChange={e => handleChange(i, 'FR_CS_REMARK', e.target.value)}
                        placeholder="Add remark…"
                        style={inputStyle}
                      />
                    </td>

                    {/* ── FR CS Name ── */}
                    <td style={{ ...tdStyle, minWidth: 150 }}>
                      <select
                        value={row.FR_CS_NAME || ''}
                        onChange={e => handleChange(i, 'FR_CS_NAME', e.target.value)}
                        style={{ ...inputStyle, cursor: 'pointer' }}
                      >
                        <option value=''>— Select —</option>
                        {Array.from({ length: 999 }, (_, i) => String(i + 1)).map(n => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                      </select>
                    </td>

                    <td style={tdStyle}>{row.DSR_DEST || '—'}</td>
                    <td style={tdStyle}>{row.DSR_DEST_PIN || '—'}</td>
                    <td style={tdStyle}>{row.DESTINATION_BRANCH_NAME || '—'}</td>
                    <td style={{ ...tdStyle, minWidth: 180 }}>
                      <input
                        value={row.RECEIVER_NAME || ''}
                        onChange={e => handleChange(i, 'RECEIVER_NAME', e.target.value)}
                        placeholder="Add receiver name"
                        style={inputStyle}
                      />
                    </td>
                    <td style={{ ...tdStyle, minWidth: 180 }}>
                      <input
                        value={row.DSR_MOBILE || ''}
                        onChange={e => handleChange(i, 'DSR_MOBILE', e.target.value)}
                        placeholder="Add dsr mobile"
                        style={inputStyle}
                      />
                    </td>
                    <td style={tdStyle}>{row.client_name || '—'}</td>

                    
                    
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Footer ── */}
        {fetched && bookings.length > 0 && (
          <div style={{
            padding: '12px 20px', borderTop: `1px solid ${COLORS.grayLight}`,
            fontSize: 13, color: COLORS.gray,
            display: 'flex', justifyContent: 'space-between',
          }}>
            <span>{bookings.length} record{bookings.length !== 1 ? 's' : ''} found</span>
            <span style={{
              color:      bookings.some(r => r._edited) ? COLORS.warning : COLORS.success,
              fontWeight: 500,
            }}>
              {bookings.filter(r => r._edited).length > 0
                ? `⚠️ ${bookings.filter(r => r._edited).length} unsaved change${bookings.filter(r => r._edited).length > 1 ? 's' : ''}`
                : '✓ All saved'}
            </span>
          </div>
        )}
      </div>

    </DashboardLayout>
  )
}