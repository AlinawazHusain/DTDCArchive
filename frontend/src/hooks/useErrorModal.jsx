import { useState } from 'react'
import Modal from '../components/common/Modal'
import Button from '../components/common/Button'

export function useErrorModal() {
  const [modal, setModal] = useState({ open: false, title: '', message: '' })

  const showError = (err, fallback = 'Something went wrong. Please try again.') => {
    let message = fallback
    try {
      const raw = typeof err === 'string' ? err : err?.message || ''
      const jsonPart = raw.substring(raw.indexOf('{'))
      const parsed = JSON.parse(jsonPart)
      if (parsed?.detail) message = parsed.detail
    } catch { /* use fallback */ }

    setModal({ open: true, message })
  }

  const ErrorModal = () => (
    <Modal
      isOpen={modal.open}
      onClose={() => setModal({ open: false, message: '' })}
      title="⚠️ Error"
      footer={
        <Button onClick={() => setModal({ open: false, message: '' })}>Close</Button>
      }
    >
      <div style={{
        background: '#fff5f5', border: '1px solid #fca5a5',
        borderRadius: 8, padding: '16px 20px',
        color: '#b91c1c', fontSize: 14, lineHeight: 1.6,
      }}>
        {modal.message}
      </div>
    </Modal>
  )

  return { showError, ErrorModal }
}