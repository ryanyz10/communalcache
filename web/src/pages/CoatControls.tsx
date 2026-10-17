import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { CoatPicker } from '../components/CoatPicker'
import { apiFetch, errorMessage } from '../lib/api'
import type { CatCoat } from '../lib/cats'
import { refreshProfileViews } from '../lib/profile'

export function CoatControls({ className = '', resettable = false, disabled = false, onBusy }: {
  className?: string
  resettable?: boolean
  disabled?: boolean
  onBusy?: (busy: boolean) => void
}) {
  const { me } = useAuth()
  const client = useQueryClient()
  const changeCoat = useMutation({
    mutationFn: (cat_coat: CatCoat | null) => apiFetch('/api/me', { method: 'PATCH', body: { cat_coat } }),
    onMutate: () => onBusy?.(true),
    onSuccess: () => refreshProfileViews(client),
    onSettled: () => onBusy?.(false),
  })
  if (!me) return null

  return <div className={className}>
    <CoatPicker userId={me.id} value={me.cat_coat} names disabled={disabled || changeCoat.isPending} onChange={coat => changeCoat.mutate(coat)} />
    {resettable && me.cat_coat && <button type="button" className="cc-text-action" disabled={disabled || changeCoat.isPending} onClick={() => changeCoat.mutate(null)}>Use my default cat</button>}
    {changeCoat.isPending && <p role="status" className="cc-form-hint">Saving cat…</p>}
    {changeCoat.isError && <p role="alert" className="cc-form-error">{errorMessage(changeCoat.error)}</p>}
  </div>
}
