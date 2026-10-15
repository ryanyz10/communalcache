import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { ContactLink, PlatformIcon } from '../components/ContactLink'
import { apiFetch, errorMessage } from '../lib/api'
import { platforms, useOwnContact, type Contact, type ContactKind } from '../lib/contacts'

export function ContactControls() {
  const { me } = useAuth()
  const own = useOwnContact(me?.id ?? ''), client = useQueryClient(), dialog = useRef<HTMLDialogElement>(null)
  const [editing, setEditing] = useState(false), [kind, setKind] = useState<ContactKind>('sms'), [value, setValue] = useState('')
  const [previewValue, setPreviewValue] = useState('')
  useEffect(()=>{ const timer = setTimeout(()=>setPreviewValue(value),250); return ()=>clearTimeout(timer) },[value])
  const preview = useQuery({
    queryKey: ['contact-preview',me?.id,kind,previewValue],
    queryFn: () => apiFetch<{contact:Contact}>('/api/me/contact/preview',{body:{kind,value:previewValue}}),
    enabled: editing && !!previewValue.trim(), retry: false, gcTime: 0,
  })
  const change = useMutation({
    mutationFn: (remove: boolean) => apiFetch('/api/me/contact',remove ? {method:'DELETE'} : {method:'PUT',body:{kind,value}}),
    onSuccess: async () => {
      await Promise.all([client.invalidateQueries({queryKey:['own-contact']}),client.invalidateQueries({queryKey:['request-contact']})])
      dialog.current?.close()
    },
  })
  if (!me) return null
  function open() {
    setKind(own.data?.contact?.kind ?? 'sms'); setValue(own.data?.contact?.value ?? ''); setPreviewValue('')
    change.reset(); setEditing(true); dialog.current?.showModal()
  }
  function submit(event: FormEvent) { event.preventDefault(); change.mutate(false) }
  const currentPreview = value === previewValue ? preview.data?.contact : null
  return <section className="mt-6 lg:border-b lg:border-slate-200 lg:py-6" aria-labelledby="contact-heading">
    <h2 id="contact-heading" className="cc-section-title lg:ml-0 lg:text-[17px] lg:tracking-normal lg:text-slate-900 lg:normal-case">How to reach me</h2>
    <div className="cc-list"><div className="cc-row">
      {own.data?.contact && <PlatformIcon kind={own.data.contact.kind} />}
      <div className="min-w-0 flex-1"><p className="break-words font-semibold">{own.data?.contact ? `${platforms[own.data.contact.kind].name} · ${own.data.contact.value}` : 'Add how to reach you'}</p><p className="text-sm text-slate-600">Shown only after an ask is approved, while both of you are active in that cache.</p></div>
      <button type="button" disabled={!own.isSuccess} className="min-h-11 text-sm underline" aria-haspopup="dialog" aria-controls="contact-sheet" onClick={open}>{own.data?.contact ? 'Edit contact' : 'Add contact'}</button>
    </div></div>
    {own.isPending && <p role="status" className="mt-2">Loading contact…</p>}
    {own.isError && <div><p role="alert">{errorMessage(own.error)}</p><button type="button" className="cc-outline mt-2" onClick={()=>void own.refetch()}>Try contact again</button></div>}
    <dialog ref={dialog} id="contact-sheet" className="cc-sheet lg:w-[440px] lg:rounded-2xl lg:p-6" aria-labelledby="contact-sheet-heading" onCancel={event=>{if(change.isPending)event.preventDefault()}} onClose={()=>{setEditing(false);setValue('');setPreviewValue('')}}>
      <div className="flex items-center justify-between gap-3"><h2 id="contact-sheet-heading" className="text-xl font-semibold">How to reach me</h2><button type="button" autoFocus disabled={change.isPending} className="cc-outline min-h-11" onClick={()=>dialog.current?.close()}>Close</button></div>
      <p className="mt-3 text-sm text-slate-600">Only the other person on an approved ask sees it, while you're both in that cache. Your sign-in email is never used.</p>
      <form className="mt-4 space-y-3" onSubmit={submit}>
        <fieldset disabled={change.isPending}><legend className="text-sm font-medium">Platform</legend><div className="mt-2 flex flex-wrap gap-2">{(Object.keys(platforms) as ContactKind[]).map(platform=><button key={platform} type="button" aria-pressed={kind===platform} onClick={()=>{setKind(platform);setValue('');setPreviewValue('');change.reset()}} className={`cc-outline flex min-h-11 items-center gap-2 ${kind===platform ? 'ring-2 ring-slate-700' : ''}`}><PlatformIcon kind={platform} />{platforms[platform].name}</button>)}</div></fieldset>
        <label htmlFor="contact-value" className="block text-sm font-medium">{platforms[kind].label}</label>
        <input id="contact-value" className="cc-input" required maxLength={254} autoComplete="off" type="text" inputMode={kind==='email' ? 'email' : ['sms','whatsapp','signal'].includes(kind) ? 'tel' : 'text'} placeholder={platforms[kind].placeholder} value={value} disabled={change.isPending} onChange={event=>{setValue(event.target.value);change.reset()}} />
        <p className="text-sm text-slate-600">{['sms','whatsapp','signal'].includes(kind) ? '7–15 digits, with an optional leading +. Include your country code.' : kind==='email' ? 'Choose a contact address. This does not change your sign-in email.' : 'Enter a username, not a URL or @handle.'}</p>
        {currentPreview && <><ContactLink contact={currentPreview} name={me.display_name ?? 'You'} /><p className="text-sm text-slate-600">Preview: the exact button the other person sees. Test it here first.</p></>}
        {editing && !!value.trim() && !currentPreview && (preview.isFetching || value!==previewValue) && <p role="status">Checking preview…</p>}
        {preview.isError && value===previewValue && <p role="alert" className="text-red-700">{errorMessage(preview.error)}</p>}
        <button type="submit" className="cc-pill min-h-11" disabled={change.isPending || !currentPreview}>{change.isPending ? 'Saving…' : 'Save contact'}</button>
      </form>
      <button type="button" className="cc-outline mt-3 min-h-11 text-red-800" disabled={change.isPending || !own.data?.contact} onClick={()=>change.mutate(true)}>Remove contact</button>
      {change.isError && <p role="alert" className="mt-3 text-red-700">{errorMessage(change.error)}</p>}
    </dialog>
  </section>
}
