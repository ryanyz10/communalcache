export function bindAccountMenu(root: HTMLElement, trigger: HTMLButtonElement, menu: HTMLElement, close: () => void) {
  const items = () => Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'))
  function dismiss() { close(); trigger.focus() }
  function pointer(event: PointerEvent) {
    if (!root.contains(event.target as Node | null)) dismiss()
  }
  function key(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); dismiss(); return }
    if (event.key === 'Tab') { dismiss(); return }
    if (event.key === ' ') {
      event.preventDefault()
      items().find(item => item === document.activeElement)?.click()
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const choices = items()
    if (!choices.length) return
    const current = Math.max(0, choices.indexOf(document.activeElement as HTMLElement))
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1
      : event.key === 'ArrowDown' ? (current + 1) % choices.length : (current - 1 + choices.length) % choices.length
    choices[next]?.focus()
  }
  items()[0]?.focus()
  document.addEventListener('pointerdown', pointer)
  document.addEventListener('keydown', key)
  return () => {
    document.removeEventListener('pointerdown', pointer)
    document.removeEventListener('keydown', key)
  }
}

export function accountMenuLabel(count: number) {
  return count > 0 ? `Account menu, ${count} ${count === 1 ? 'request needs' : 'requests need'} your answer` : 'Account menu'
}
