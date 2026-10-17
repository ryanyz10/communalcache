import { useRef, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError, apiFetch, errorMessage } from '../lib/api'
import { approvalBody, DEFAULT_MARK_LENT_OUT, invalidateRequestViews, relativeWhen, type ItemRequest } from '../lib/requests'
import { Cat } from '../components/Cat'
import { useToast } from '../components/Toast'
import { transientActionFailure } from '../lib/feedback'

export function RequestDecision({ request }: { request: ItemRequest }) {
  const client = useQueryClient()
  const { showToast } = useToast()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [mode, setMode] = useState<'approve' | 'decline'>('approve')
  const [message, setMessage] = useState('')
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [markLentOut, setMarkLentOut] = useState(DEFAULT_MARK_LENT_OUT)
  const [noteEdited, setNoteEdited] = useState(false)
  const messageTooLong = [...message.trim()].length > 500
  const noteTooLong = [...note.trim()].length > 200
  const reasonTooLong = [...reason.trim()].length > 500
  const decisionMutation = useMutation({
    mutationFn: (action: 'approve' | 'reject') => {
      const body = action === 'reject'
        ? { reason: reason.trim() }
        : approvalBody(request.quantity, message, markLentOut, note, noteEdited)
      return apiFetch<ItemRequest>(`/api/me/requests/${request.id}/${action}`, { body })
    },
    onSuccess: (_data, action) => { showToast(action === 'approve' ? 'Request approved.' : 'Request declined.'); dialogRef.current?.close() },
    onError: error => { if (transientActionFailure(error)) showToast(errorMessage(error), 'error') },
  })

  function open(nextMode: 'approve' | 'decline') {
    decisionMutation.reset()
    setMode(nextMode)
    setMessage('')
    setReason('')
    setNote('')
    setNoteEdited(false)
    setMarkLentOut(DEFAULT_MARK_LENT_OUT)
    dialogRef.current?.showModal()
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    decisionMutation.mutate(mode === 'approve' ? 'approve' : 'reject')
  }

  const requesterName = request.requester_name ?? 'this neighbor'
  const isReusable = request.quantity === null
  let heading: string
  if (mode === 'decline') heading = 'Decline this ask?'
  else if (isReusable) heading = `Lend your ${request.item_title} to ${requesterName}?`
  else heading = `Give ${requesterName} ${request.quantity} ${request.item_title}?`

  const decisionError = decisionMutation.error instanceof ApiError && decisionMutation.error.code === 'request_not_pending'
    ? 'This ask has already been decided. Close this sheet to refresh the list.'
    : errorMessage(decisionMutation.error)

  return <div className="cc-request-decision">
    <div className="cc-request-actions">
      <button type="button" className="cc-request-primary" aria-label={`Approve request from ${requesterName}`} aria-haspopup="dialog" onClick={() => open('approve')}>Approve</button>
      <button type="button" className="cc-request-secondary" aria-label={`Decline request from ${requesterName}`} aria-haspopup="dialog" onClick={() => open('decline')}>Decline</button>
    </div>
    <dialog
      ref={dialogRef}
      className="cc-action-sheet cc-approval-sheet"
      aria-labelledby={`decision-heading-${request.id}`}
      onCancel={event => { if (decisionMutation.isPending) event.preventDefault() }}
      onClose={() => void invalidateRequestViews(client)}
    >
      <span className="cc-sheet-person cc-sheet-person-right" aria-hidden="true">
        <Cat userId={request.requester_id} coat={request.requester_cat_coat} pose="peek" />
      </span>
      <form className="cc-action-sheet-body" onSubmit={submit}>
        <button type="button" className="cc-sheet-close" aria-label="Close decision sheet" disabled={decisionMutation.isPending} onClick={() => dialogRef.current?.close()}>×</button>
        <div className="cc-sheet-heading">
          <h2 id={`decision-heading-${request.id}`}>{heading}</h2>
          <p>{request.cache_name} · asked {relativeWhen(request.created_at)}</p>
        </div>
        {mode === 'approve' ? <>
          <div className="cc-approval-message">
            <label htmlFor={`approval-message-${request.id}`}>Message (optional)</label>
            <textarea
              id={`approval-message-${request.id}`}
              value={message}
              maxLength={1000}
              disabled={decisionMutation.isPending}
              onChange={event => setMessage(event.target.value)}
              aria-describedby={`message-help-${request.id}`}
            />
            <p id={`message-help-${request.id}`}>Only the two of you see this. Contact details are shared while you're both in this cache.<span className="sr-only"> Up to 500 characters.</span></p>
          </div>
          {messageTooLong && <p role="alert" className="cc-form-error">Keep the message within 500 characters.</p>}
          {isReusable && <div className="cc-approval-lent">
            <label>
              <span>Mark as lent out</span>
              <input
                type="checkbox"
                role="switch"
                aria-checked={markLentOut}
                checked={markLentOut}
                disabled={decisionMutation.isPending}
                onChange={event => setMarkLentOut(event.target.checked)}
                className="cc-switch"
              />
            </label>
            {markLentOut && <>
              <label className="sr-only" htmlFor={`approval-note-${request.id}`}>Lent out note (optional)</label>
              <input
                id={`approval-note-${request.id}`}
                value={note}
                maxLength={400}
                disabled={decisionMutation.isPending}
                onChange={event => { setNote(event.target.value); setNoteEdited(true) }}
                placeholder="Lent out note (optional)"
              />
              <span className="sr-only">Up to 200 characters. Leave untouched to keep an existing availability note.</span>
            </>}
            {markLentOut && noteTooLong && <p role="alert" className="cc-form-error">Keep the note within 200 characters.</p>}
          </div>}
          <button
            type="submit"
            className="cc-profile-primary"
            disabled={decisionMutation.isPending || messageTooLong || (isReusable && markLentOut && noteTooLong)}
          >{decisionMutation.isPending ? 'Saving decision…' : 'Approve'}</button>
          <button type="button" className="cc-sheet-text-button" disabled={decisionMutation.isPending} onClick={() => { decisionMutation.reset(); setMode('decline') }}>Decline with a reason</button>
        </> : <>
          <div className="cc-approval-message">
            <label htmlFor={`decline-reason-${request.id}`}>Reason for declining</label>
            <textarea
              autoFocus
              id={`decline-reason-${request.id}`}
              required
              maxLength={1000}
              value={reason}
              disabled={decisionMutation.isPending}
              onChange={event => setReason(event.target.value)}
            />
            <p>Up to 500 characters. The requester will see your reason.</p>
          </div>
          {reasonTooLong && <p role="alert" className="cc-form-error">Keep the reason within 500 characters.</p>}
          <button type="submit" className="cc-profile-primary" disabled={decisionMutation.isPending || !reason.trim() || reasonTooLong}>{decisionMutation.isPending ? 'Saving decision…' : 'Decline ask'}</button>
          <button type="button" className="cc-sheet-text-button" disabled={decisionMutation.isPending} onClick={() => { decisionMutation.reset(); setMode('approve') }}>Back to approval</button>
        </>}
        {decisionMutation.isError && !transientActionFailure(decisionMutation.error) && <p role="alert" className="cc-form-error">{decisionError}</p>}
      </form>
    </dialog>
  </div>
}
