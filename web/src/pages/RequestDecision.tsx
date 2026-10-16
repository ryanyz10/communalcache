import { useRef,useState,type FormEvent } from 'react'
import { useMutation,useQueryClient } from '@tanstack/react-query'
import { ApiError,apiFetch,errorMessage } from '../lib/api'
import { approvalBody,DEFAULT_MARK_LENT_OUT,invalidateRequestViews,relativeWhen,type ItemRequest } from '../lib/requests'
import { Cat } from '../components/Cat'

export function RequestDecision({request}:{request:ItemRequest}) {
  const client=useQueryClient(),dialog=useRef<HTMLDialogElement>(null)
  const [mode,setMode]=useState<'approve'|'decline'>('approve')
  const [message,setMessage]=useState(''),[reason,setReason]=useState(''),[note,setNote]=useState('')
  const [markLentOut,setMarkLentOut]=useState(DEFAULT_MARK_LENT_OUT),[noteEdited,setNoteEdited]=useState(false)
  const messageTooLong=[...message.trim()].length>500,noteTooLong=[...note.trim()].length>200,reasonTooLong=[...reason.trim()].length>500
  const decision=useMutation({
    mutationFn:(action:'approve'|'reject')=>apiFetch<ItemRequest>(`/api/me/requests/${request.id}/${action}`,{body:action==='reject'?{reason:reason.trim()}:approvalBody(request.quantity,message,markLentOut,note,noteEdited)}),
    onSuccess:()=>dialog.current?.close(),
  })
  function open(next:'approve'|'decline') {
    decision.reset();setMode(next);setMessage('');setReason('');setNote('');setNoteEdited(false);setMarkLentOut(DEFAULT_MARK_LENT_OUT)
    dialog.current?.showModal()
  }
  function submit(event:FormEvent) {event.preventDefault();decision.mutate(mode==='approve'?'approve':'reject')}
  const name=request.requester_name ?? 'this neighbor',reusable=request.quantity===null
  const error=decision.error instanceof ApiError && decision.error.code==='request_not_pending'
    ? 'This ask has already been decided. Close this sheet to refresh the list.' : errorMessage(decision.error)
  return <div className="cc-request-decision">
    <div className="cc-request-actions"><button type="button" className="cc-request-primary" aria-label={`Approve request from ${name}`} aria-haspopup="dialog" onClick={()=>open('approve')}>Approve</button><button type="button" className="cc-request-secondary" aria-label={`Decline request from ${name}`} aria-haspopup="dialog" onClick={()=>open('decline')}>Decline</button></div>
    <dialog ref={dialog} className="cc-action-sheet cc-approval-sheet" aria-labelledby={`decision-heading-${request.id}`} onCancel={event=>{if(decision.isPending)event.preventDefault()}} onClose={()=>void invalidateRequestViews(client)}>
      <span className="cc-sheet-person cc-sheet-person-right" aria-hidden="true"><Cat userId={request.requester_id} coat={request.requester_cat_coat} pose="peek" /></span>
      <form className="cc-action-sheet-body" onSubmit={submit}>
        <button type="button" className="cc-sheet-close" aria-label="Close decision sheet" disabled={decision.isPending} onClick={()=>dialog.current?.close()}>×</button>
        <div className="cc-sheet-heading"><h2 id={`decision-heading-${request.id}`}>{mode==='decline'?'Decline this ask?':reusable?`Lend your ${request.item_title} to ${name}?`:`Give ${name} ${request.quantity} ${request.item_title}?`}</h2><p>{request.cache_name} · asked {relativeWhen(request.created_at)}</p></div>
        {mode==='approve' ? <>
          <div className="cc-approval-message"><label htmlFor={`approval-message-${request.id}`}>Message (optional)</label><textarea id={`approval-message-${request.id}`} value={message} maxLength={1000} disabled={decision.isPending} onChange={event=>setMessage(event.target.value)} aria-describedby={`message-help-${request.id}`} /><p id={`message-help-${request.id}`}>Only the two of you see this. Contact details are shared while you're both in this cache.<span className="sr-only"> Up to 500 characters.</span></p></div>
          {messageTooLong && <p role="alert" className="cc-form-error">Keep the message within 500 characters.</p>}
          {reusable && <div className="cc-approval-lent"><label><span>Mark as lent out</span><input type="checkbox" role="switch" aria-checked={markLentOut} checked={markLentOut} disabled={decision.isPending} onChange={event=>setMarkLentOut(event.target.checked)} className="cc-switch" /></label>{markLentOut && <><label className="sr-only" htmlFor={`approval-note-${request.id}`}>Lent out note (optional)</label><input id={`approval-note-${request.id}`} value={note} maxLength={400} disabled={decision.isPending} onChange={event=>{setNote(event.target.value);setNoteEdited(true)}} placeholder="Lent out note (optional)" /><span className="sr-only">Up to 200 characters. Leave untouched to keep an existing availability note.</span></>}{markLentOut && noteTooLong && <p role="alert" className="cc-form-error">Keep the note within 200 characters.</p>}</div>}
          <button type="submit" className="cc-profile-primary" disabled={decision.isPending || messageTooLong || (reusable && markLentOut && noteTooLong)}>{decision.isPending?'Saving decision…':'Approve'}</button>
          <button type="button" className="cc-sheet-text-button" disabled={decision.isPending} onClick={()=>{decision.reset();setMode('decline')}}>Decline with a reason</button>
        </> : <>
          <div className="cc-approval-message"><label htmlFor={`decline-reason-${request.id}`}>Reason for declining</label><textarea autoFocus id={`decline-reason-${request.id}`} required maxLength={1000} value={reason} disabled={decision.isPending} onChange={event=>setReason(event.target.value)} /><p>Up to 500 characters. The requester will see your reason.</p></div>
          {reasonTooLong && <p role="alert" className="cc-form-error">Keep the reason within 500 characters.</p>}
          <button type="submit" className="cc-profile-primary" disabled={decision.isPending || !reason.trim() || reasonTooLong}>{decision.isPending?'Saving decision…':'Decline ask'}</button><button type="button" className="cc-sheet-text-button" disabled={decision.isPending} onClick={()=>{decision.reset();setMode('approve')}}>Back to approval</button>
        </>}
        {decision.isError && <p role="alert" className="cc-form-error">{error}</p>}
      </form>
    </dialog>
  </div>
}
