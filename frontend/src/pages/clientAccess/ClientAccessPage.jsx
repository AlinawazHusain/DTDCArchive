import { useState } from 'react'
import Button from '../../components/common/Button'
import { COLORS, RADIUS } from '../../constants/theme'
import { useApp } from '../../context/AppContext'
import { callApi } from '../../utils/api'
import { useNavigate } from 'react-router-dom'

const FR_STATUS_OPTIONS = ['Pending', 'In Progress', 'Resolved', 'Closed', 'Escalated']

export default function ClientAccessPage() {
  const { addToast } = useApp()

  const [dateFrom,  setDateFrom]  = useState('')
  const [dateTo,    setDateTo]    = useState('')
  const [loading,   setLoading]   = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [bookings,  setBookings]  = useState([])
  const [fetched,   setFetched]   = useState(false)

  const navigate = useNavigate()
  const [hover, setHover] = useState(false)

  const token = () => localStorage.getItem('access_token')

  // ── Fetch bookings by date range ─────────────────────────────────────
  const handleSearch = async () => {
    if (!dateFrom || !dateTo) {
      addToast('Please select both start and end dates.', 'error')
      return
    }
    setLoading(true)
    try {
      const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo })
      const data = await callApi({
        url: `/api/clientAccess/bookings/filter?${params.toString()}`,
        method: 'GET',
        headers: { Authorization: `Bearer ${token()}` },
      })
      const rows = Array.isArray(data) ? data : (data.bookings ?? data.data ?? [])
      setBookings(rows.map(r => ({ ...r, _edited: false })))
      setFetched(true)
      if (rows.length === 0) addToast('No bookings found for this date range.', 'error')
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

  // ── Save / Update a single row ────────────────────────────────────────
  const handleSave = async (row, index) => {
    setSaving(true)
    try {
      await callApi({
        url: '/api/clientAccess/bookingUpdate',
        method: 'PUT',
        body: {
          data: {
            id:            row.id,
            FR_STATUS:     row.FR_STATUS,
            FR_CS_REMARK:  row.FR_CS_REMARK,
            FR_CS_NAME:    row.FR_CS_NAME,
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

  // ── Styles ────────────────────────────────────────────────────────────
  const labelStyle = { fontSize: 12, fontWeight: 600, color: COLORS.gray, display: 'block', marginBottom: 5 }
  const inputStyle = {
    padding: '9px 12px', fontSize: 13, width: '100%', boxSizing: 'border-box',
    border: `1.5px solid ${COLORS.border}`, borderRadius: RADIUS.md,
    outline: 'none', color: COLORS.dark, fontFamily: "'DM Sans', sans-serif",
  }
  const thStyle = {
    padding: '11px 14px', textAlign: 'left',
    color: COLORS.gray, fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap',
  }
  const tdStyle = { padding: '10px 14px', fontSize: 13, color: COLORS.dark, verticalAlign: 'middle' }

  return (
    <div style={{ minHeight: '100vh', background: COLORS.bgPage, padding: '32px 24px' }}>
      {/* ── Page Header ── */}
      <div style={{ marginBottom: 22 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: COLORS.dark, fontFamily: "'Syne', sans-serif" }}>
          Consignment Bookings
        </h2>
        <p style={{ fontSize: 13, color: COLORS.gray, marginTop: 2 }}>
          Filter by date range and update FR status & remarks inline.
        </p>
      </div>
      {/* ── Logout button ── */}
  <button
    onClick={() => {
      localStorage.removeItem('access_token')
      localStorage.removeItem('refresh_token')
      navigate('/')
    }}
    onMouseEnter={() => setHover(true)}
    onMouseLeave={() => setHover(false)}
    style={{
      background: 'none',
      color: COLORS.dark,
      border: hover ? `3px solid ${COLORS.danger}` : `3px solid ${COLORS.warningLight}`,
      borderRadius: RADIUS.md,
      padding: '15px 20px',
      cursor: 'pointer',
      fontSize: 14,
      fontFamily: "'DM Sans', sans-serif",
      transition: 'all 0.2s',
    }}
  >
    ← Logout
  </button>

      


      {/* ── Filter Panel ── */}
      <div style={{
        background: COLORS.white, border: `1px solid ${COLORS.border}`,
        borderRadius: RADIUS.lg, padding: '20px 22px', marginBottom: 20,
      }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: COLORS.dark, marginBottom: 16, margin: '0 0 16px' }}>
          🔎 Search by Date Range
        </h3>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 160px', minWidth: 150 }}>
            <label style={labelStyle}>Date From</label>
            <input type="date" value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              style={inputStyle}
            />
          </div>
          <div style={{ flex: '1 1 160px', minWidth: 150 }}>
            <label style={labelStyle}>Date To</label>
            <input type="date" value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              style={inputStyle}
            />
          </div>
          <Button onClick={handleSearch} disabled={loading}>
            {loading ? 'Searching…' : '🔍 Show Results'}
          </Button>
        </div>
      </div>

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
                Select a date range and click <strong>Show Results</strong>.
              </div>
            </div>

          ) : bookings.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: COLORS.gray, fontSize: 14 }}>
              No bookings found for the selected date range.
            </div>

          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: COLORS.bgPage }}>
                  {['AWB / CN No.', 'Booking Date', 'Destination', 'Dest. Pin',
                    'Dest. Branch', 'EDD Date', 'Receiver Name', 'Mobile',
                    'FR Status', 'FR CS Remark', 'FR CS Name', 'Action'].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
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
                    {/* ── Read-only cells ── */}
                    <td style={{ ...tdStyle, fontWeight: 600, color: COLORS.primary, whiteSpace: 'nowrap' }}>
                      {row.DSR_CNNO || '—'}
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{row.DSR_BOOKING_DATE || '—'}</td>
                    <td style={tdStyle}>{row.DSR_DEST || '—'}</td>
                    <td style={tdStyle}>{row.DSR_DEST_PIN || '—'}</td>
                    <td style={tdStyle}>{row.DESTINATION_BRANCH_NAME || '—'}</td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{row.EDD_DATE || '—'}</td>
                    <td style={tdStyle}>{row.RECEIVER_NAME || '—'}</td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{row.DSR_MOBILE || '—'}</td>

                    {/* ── FR Status dropdown ── */}
                    <td style={{ ...tdStyle, minWidth: 140 }}>
                      <select
                        value={row.FR_STATUS || ''}
                        onChange={e => handleChange(i, 'FR_STATUS', e.target.value)}
                        style={{
                          ...inputStyle, padding: '7px 10px',
                          background: row.FR_STATUS ? COLORS.primary + '0f' : '#fff',
                          borderColor: row.FR_STATUS ? COLORS.primary + '60' : COLORS.border,
                          fontWeight: 500, cursor: 'pointer',
                        }}
                      >
                        <option value="">— Select —</option>
                        {FR_STATUS_OPTIONS.map(o => (
                          <option key={o} value={o}>{o}</option>
                        ))}
                      </select>
                    </td>

                    {/* ── FR CS Remark textbox ── */}
                    <td style={{ ...tdStyle, minWidth: 180 }}>
                      <input
                        value={row.FR_CS_REMARK || ''}
                        onChange={e => handleChange(i, 'FR_CS_REMARK', e.target.value)}
                        placeholder="Add remark…"
                        style={inputStyle}
                      />
                    </td>

                    {/* ── FR CS Name textbox ── */}
                    <td style={{ ...tdStyle, minWidth: 150 }}>
                      <input
                        value={row.FR_CS_NAME || ''}
                        onChange={e => handleChange(i, 'FR_CS_NAME', e.target.value)}
                        placeholder="CS name…"
                        style={inputStyle}
                      />
                    </td>

                    {/* ── Save button ── */}
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                      <button
                        onClick={() => handleSave(row, i)}
                        disabled={!row._edited || saving}
                        style={{
                          padding: '7px 16px', fontSize: 12, fontWeight: 700,
                          borderRadius: RADIUS.md, border: 'none', cursor: row._edited ? 'pointer' : 'not-allowed',
                          background: row._edited ? COLORS.primary : COLORS.grayLight,
                          color: row._edited ? '#fff' : COLORS.gray,
                          transition: 'all 0.2s',
                          fontFamily: "'DM Sans', sans-serif",
                        }}
                      >
                        {saving ? '...' : '💾 Save'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        {fetched && bookings.length > 0 && (
          <div style={{
            padding: '12px 20px', borderTop: `1px solid ${COLORS.grayLight}`,
            fontSize: 13, color: COLORS.gray, display: 'flex', justifyContent: 'space-between',
          }}>
            <span>{bookings.length} record{bookings.length !== 1 ? 's' : ''} found</span>
            <span style={{ color: COLORS.primary, fontWeight: 500 }}>
              {bookings.filter(r => r._edited).length > 0
                ? `⚠️ ${bookings.filter(r => r._edited).length} unsaved change${bookings.filter(r => r._edited).length > 1 ? 's' : ''}`
                : '✓ All saved'}
            </span>
          </div>
        )}
      </div>

    </div>
  )
}