import { useState, type FormEvent, type RefObject } from 'react'
import { useNavigate } from 'react-router'
import { parseInvite } from '../lib/pendingJoin'

export function JoinInviteSheet({ dialog }: { dialog: RefObject<HTMLDialogElement | null> }) {
  const navigate = useNavigate()
  const [inviteInput, setInviteInput] = useState('')
  const [error, setError] = useState('')

  function submit(event: FormEvent) {
    event.preventDefault()
    const token = parseInvite(inviteInput)
    if (!token) {
      setError('That does not look like an invite. Paste the full invite link or its code.')
      return
    }
    dialog.current?.close()
    navigate(`/join/${token}`)
  }

  return <dialog ref={dialog} className="cc-sheet cc-invite-paste lg:w-[440px] lg:p-6" aria-labelledby="join-invite-heading" onClose={() => { setInviteInput(''); setError('') }}>
    <div className="flex items-center justify-between gap-3">
      <h2 id="join-invite-heading" className="text-xl font-semibold">Join with an invite</h2>
      <button type="button" className="cc-outline min-h-11" onClick={() => dialog.current?.close()}>Close</button>
    </div>
    <p className="mt-3 text-sm text-slate-600">Paste an invite link or code from someone in the cache.</p>
    <form className="mt-4 space-y-3" onSubmit={submit}>
      <label htmlFor="join-invite-code" className="block text-sm font-medium">Invite link or code</label>
      <input
        id="join-invite-code" autoFocus required autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={2048}
        value={inviteInput} onChange={event => { setInviteInput(event.target.value); setError('') }}
        placeholder="https://communalcache.com/join/…" className="cc-input"
        aria-describedby={error ? 'join-invite-error' : undefined} aria-invalid={!!error}
      />
      {error && <p id="join-invite-error" role="alert" className="text-red-700">{error}</p>}
      <button type="submit" disabled={!inviteInput.trim()} className="cc-pill min-h-11">Open invite</button>
    </form>
  </dialog>
}
