import { useLayoutEffect, useRef, type ReactNode } from 'react'

export function ItemEditorDialog({ children, onDismiss, busy, dirty, committed, returnFocus }: {
  children: (dismiss: () => void) => ReactNode
  onDismiss: () => void
  busy: boolean
  dirty: boolean
  committed: boolean
  returnFocus: string
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => {
    const modal = dialog.current!
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const rootOverflow = document.documentElement.style.overflow
    const bodyOverflow = document.body.style.overflow
    modal.showModal()
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    modal.querySelector<HTMLElement>('#item-editor-heading')?.focus()
    const viewport = window.visualViewport
    function measure() {
      modal.style.setProperty('--cc-editor-height', `${viewport?.height ?? window.innerHeight}px`)
      modal.style.setProperty('--cc-editor-bottom', `${viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0}px`)
    }
    measure()
    viewport?.addEventListener('resize', measure)
    viewport?.addEventListener('scroll', measure)
    window.addEventListener('resize', measure)
    return () => {
      modal.close()
      document.documentElement.style.overflow = rootOverflow
      document.body.style.overflow = bodyOverflow
      viewport?.removeEventListener('resize', measure)
      viewport?.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
      requestAnimationFrame(() => {
        if (document.querySelector('dialog.cc-item-editor[open]')) return
        const trigger = [...document.querySelectorAll<HTMLElement>('[data-item-editor-trigger]')]
          .find(node => node.dataset.itemEditorTrigger === returnFocus && node.getBoundingClientRect().width > 0)
        const target = previous?.isConnected && previous !== document.body ? previous : trigger ?? document.querySelector<HTMLElement>('main h1')
        if (target) {
          if (!target.matches('a,button,input,[tabindex]')) target.setAttribute('tabindex', '-1')
          target.focus()
        }
      })
    }
  }, [returnFocus])

  function dismiss() {
    if (busy) return
    const message = committed
      ? 'Your item is already saved. Leave without finishing its remaining photo or sharing changes?'
      : 'Discard your unsaved item changes?'
    if (dirty && !window.confirm(message)) return
    onDismiss()
  }

  return <dialog ref={dialog} className="cc-item-editor" aria-labelledby="item-editor-heading" aria-modal="true"
    onCancel={event => { event.preventDefault(); dismiss() }}
    onClick={event => {
      if (event.target !== event.currentTarget) return
      const bounds = event.currentTarget.getBoundingClientRect()
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dismiss()
    }}>
    <div className="cc-item-editor-content">{children(dismiss)}</div>
  </dialog>
}
