import { useEffect } from 'react'

type ToastItem = {
  id: string
  message: string
  type: 'success' | 'error'
}

interface ToastProps {
  toasts: ToastItem[]
  onRemove: (id: string) => void
}

export function Toast({ toasts, onRemove }: ToastProps) {
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <ToastMessage key={t.id} toast={t} onRemove={onRemove} />
      ))}
    </div>
  )
}

function ToastMessage({ toast, onRemove }: { toast: ToastItem; onRemove: (id: string) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onRemove(toast.id), 3500)
    return () => clearTimeout(timer)
  }, [toast.id, onRemove])

  return (
    <div className={`toast ${toast.type}`} onClick={() => onRemove(toast.id)}>
      {toast.type === 'success' ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="#22C55E" strokeWidth="2.5" width="16" height="16">
          <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2.5" width="16" height="16">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4M12 16h.01" strokeLinecap="round" />
        </svg>
      )}
      {toast.message}
    </div>
  )
}

export function useToast() {
  return {
    show: () => { },
  }
}
