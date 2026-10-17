import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { ContactLink, PlatformIcon } from '../components/ContactLink'
import { apiFetch, errorMessage } from '../lib/api'
import { platforms, useOwnContact, type Contact, type ContactKind } from '../lib/contacts'
import { Shimmer, LoadingStatus, LoadingLines } from '../components/Skeleton'

export function ContactControls() {
  const { me } = useAuth()
  const ownContactQuery = useOwnContact(me?.id ?? '')
  const client = useQueryClient()
  const contactDialog = useRef<HTMLDialogElement>(null)
  const [editing, setEditing] = useState(false)
  const [kind, setKind] = useState<ContactKind>('sms')
  const [value, setValue] = useState('')
  const [previewValue, setPreviewValue] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setPreviewValue(value), 250)
    return () => clearTimeout(timer)
  }, [value])
  const previewQuery = useQuery({
    queryKey: ['contact-preview', me?.id, kind, previewValue],
    queryFn: () => apiFetch<{ contact: Contact }>('/api/me/contact/preview', { body: { kind, value: previewValue } }),
    enabled: editing && !!previewValue.trim(), retry: false, gcTime: 0,
  })
  const changeContact = useMutation({
    mutationFn: (remove: boolean) => apiFetch('/api/me/contact', remove ? { method: 'DELETE' } : { method: 'PUT', body: { kind, value } }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['own-contact'] }),
        client.invalidateQueries({ queryKey: ['request-contact'] }),
      ])
      contactDialog.current?.close()
    },
  })
  if (!me) return null

  function open() {
    setKind(ownContactQuery.data?.contact?.kind ?? 'sms')
    setValue(ownContactQuery.data?.contact?.value ?? '')
    setPreviewValue('')
    changeContact.reset()
    setEditing(true)
    contactDialog.current?.showModal()
  }
  function submit(event: FormEvent) {
    event.preventDefault()
    changeContact.mutate(false)
  }

  const currentPreview = value === previewValue ? previewQuery.data?.contact : null
  const contactSummary = ownContactQuery.data?.contact
    ? `${platforms[ownContactQuery.data.contact.kind].name} · ${ownContactQuery.data.contact.value}`
    : 'Add how to reach you'
  const isPhoneContact = ['sms', 'whatsapp', 'signal'].includes(kind)
  let inputMode: 'email' | 'tel' | 'text' = 'text'
  let valueHelp = 'Enter a username, not a URL or @handle.'
  if (isPhoneContact) {
    inputMode = 'tel'
    valueHelp = '7–15 digits, with an optional leading +. Include your country code.'
  } else if (kind === 'email') {
    inputMode = 'email'
    valueHelp = 'Choose a contact address. This does not change your sign-in email.'
  }

  return <section className="cc-account-contact" aria-labelledby="contact-heading">
    <div className="cc-contact-heading">
      <h2 id="contact-heading">How to reach me</h2>
      <button type="button" disabled={!ownContactQuery.isSuccess} className="cc-text-action cc-contact-edit-mobile" aria-label={ownContactQuery.data?.contact ? 'Edit contact' : 'Add contact'} aria-haspopup="dialog" aria-controls="contact-sheet" onClick={open}>{ownContactQuery.data?.contact ? 'Edit' : 'Add'}</button>
    </div>
    <p className="cc-contact-value-mobile">{ownContactQuery.isPending ? <Shimmer width={170} height={18} /> : contactSummary}</p>
    <p className="cc-contact-helper-desktop">Shown only after an ask is approved, while both of you are active in that cache.</p>
    <p className="cc-contact-helper-mobile">Shown only after an ask is approved.</p>
    <div className="cc-contact-summary">
      <span>{ownContactQuery.isPending ? <Shimmer width={170} height={18} /> : contactSummary}</span>
      <button type="button" disabled={!ownContactQuery.isSuccess} className="cc-text-action" aria-label={ownContactQuery.data?.contact ? 'Edit contact' : 'Add contact'} aria-haspopup="dialog" aria-controls="contact-sheet" onClick={open}>{ownContactQuery.data?.contact ? 'Edit' : 'Add contact'}</button>
    </div>
    {ownContactQuery.isPending && <LoadingStatus label="Loading contact…" />}
    {ownContactQuery.isError && <div>
      <p role="alert">{errorMessage(ownContactQuery.error)}</p>
      <button type="button" className="cc-outline mt-2" onClick={() => void ownContactQuery.refetch()}>Try contact again</button>
    </div>}
    <dialog
      ref={contactDialog} id="contact-sheet" className="cc-sheet lg:w-[440px] lg:rounded-2xl lg:p-6" aria-labelledby="contact-sheet-heading"
      onCancel={event => { if (changeContact.isPending) event.preventDefault() }}
      onClose={() => { setEditing(false); setValue(''); setPreviewValue('') }}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="contact-sheet-heading" className="text-xl font-semibold">How to reach me</h2>
        <button type="button" autoFocus disabled={changeContact.isPending} className="cc-outline min-h-11" onClick={() => contactDialog.current?.close()}>Close</button>
      </div>
      <p className="mt-3 text-sm text-slate-600">Only the other person on an approved ask sees it, while you're both in that cache. Your sign-in email is never used.</p>
      <form className="mt-4 space-y-3" onSubmit={submit}>
        <fieldset disabled={changeContact.isPending}>
          <legend className="text-sm font-medium">Platform</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {(Object.keys(platforms) as ContactKind[]).map(platform => <button
              key={platform} type="button" aria-pressed={kind === platform}
              onClick={() => { setKind(platform); setValue(''); setPreviewValue(''); changeContact.reset() }}
              className={`cc-outline flex min-h-11 items-center gap-2 ${kind === platform ? 'ring-2 ring-slate-700' : ''}`}
            ><PlatformIcon kind={platform} />{platforms[platform].name}</button>)}
          </div>
        </fieldset>
        <label htmlFor="contact-value" className="block text-sm font-medium">{platforms[kind].label}</label>
        <input
          id="contact-value" className="cc-input" required maxLength={254} autoComplete="off" type="text" inputMode={inputMode}
          placeholder={platforms[kind].placeholder} value={value} disabled={changeContact.isPending}
          onChange={event => { setValue(event.target.value); changeContact.reset() }}
        />
        <p className="text-sm text-slate-600">{valueHelp}</p>
        {currentPreview && <>
          <ContactLink contact={currentPreview} name={me.display_name ?? 'You'} />
          <p className="text-sm text-slate-600">Preview: the exact button the other person sees. Test it here first.</p>
        </>}
        {editing && !!value.trim() && !currentPreview && (previewQuery.isFetching || value !== previewValue) && <LoadingLines label="Checking preview…" />}
        {previewQuery.isError && value === previewValue && <p role="alert" className="text-red-700">{errorMessage(previewQuery.error)}</p>}
        <button type="submit" className="cc-pill min-h-11" disabled={changeContact.isPending || !currentPreview}>{changeContact.isPending ? 'Saving…' : 'Save contact'}</button>
      </form>
      <button type="button" className="cc-outline mt-3 min-h-11 text-red-800" disabled={changeContact.isPending || !ownContactQuery.data?.contact} onClick={() => changeContact.mutate(true)}>Remove contact</button>
      {changeContact.isError && <p role="alert" className="mt-3 text-red-700">{errorMessage(changeContact.error)}</p>}
    </dialog>
  </section>
}
