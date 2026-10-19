import { createPortal } from 'react-dom'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

type ToastTone = 'success' | 'error'
type ToastNotice = { message: string; sequence: number; tone: ToastTone }
type ToastController = { toast: ToastNotice | null; showToast: (message: string, tone?: ToastTone) => void; dismissToast: () => void }

const ToastContext = createContext<ToastController>({ toast: null, showToast: () => {}, dismissToast: () => {} })

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastNotice | null>(null)
  const sequence = useRef(0)
  const showToast = useCallback((message: string, tone: ToastTone = 'success') => {
    setToast({ message, tone, sequence: ++sequence.current })
  }, [])
  const dismissToast = useCallback(() => setToast(null), [])
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(current => current?.sequence === toast.sequence ? null : current), toast.tone === 'error' ? 5000 : 2500)
    return () => clearTimeout(timer)
  }, [toast])
  return <ToastContext.Provider value={{ toast, showToast, dismissToast }}>
    {children}
    <Toast toast={toast} />
  </ToastContext.Provider>
}

export function useToast() { return useContext(ToastContext) }

export function Toast({ toast }: { toast: ToastNotice | null }) {
  const region = useRef<HTMLDivElement>(null)
  const [target, setTarget] = useState<HTMLElement | null>(null)
  useEffect(() => {
    // Popovers outside a modal are visible but still inert to assistive technology.
    const move = () => setTarget(document.querySelector<HTMLElement>('dialog[open]') ?? document.body)
    move()
    if (!toast) return
    const observer = new MutationObserver(move)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] })
    return () => observer.disconnect()
  }, [toast])
  const popover = typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype
  useEffect(() => {
    const node = region.current
    if (!popover || !target || !node) return
    if (toast && !node.matches(':popover-open')) node.showPopover()
    else if (!toast && node.matches(':popover-open')) node.hidePopover()
  }, [toast, popover, target])
  const error = toast?.tone === 'error'
  const notice = <div ref={region} popover={popover ? 'manual' : undefined} className="cc-toast-region" role={error ? 'alert' : 'status'} aria-live={error ? 'assertive' : 'polite'} aria-atomic="true">
    {toast && <p key={toast.sequence} className={`cc-toast-message${error ? ' cc-toast-error' : ''}`}>{toast.message}</p>}
  </div>
  return target ? createPortal(notice, target) : notice
}
