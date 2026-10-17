import { useEffect, useState } from 'react'

type ToastNotice = { message: string; sequence: number }

export function useToast() {
  const [toast, setToast] = useState<ToastNotice | null>(null)
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(timer)
  }, [toast])
  function showToast(message: string) {
    // Repeated copies need a fresh live-region child even when the text matches.
    setToast(previous => ({ message, sequence: (previous?.sequence ?? 0) + 1 }))
  }
  return { toast, showToast, dismissToast: () => setToast(null) }
}

export function Toast({ toast }: { toast: ToastNotice | null }) {
  return <div className="cc-toast-region" role="status" aria-live="polite" aria-atomic="true">
    {toast && <p key={toast.sequence} className="cc-toast-message">{toast.message}</p>}
  </div>
}
