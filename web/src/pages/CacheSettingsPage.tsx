import { useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { apiFetch, errorMessage } from '../lib/api'
import type { CacheDetail, CacheInfo } from '../lib/caches'
import { OnboardingPage } from './OnboardingPage'
import { JoinRequests } from './JoinRequests'

function OwnerSettings({ cache }: { cache: CacheDetail }) {
  const client = useQueryClient()
  const [name, setName] = useState(cache.name)
  const [editing, setEditing] = useState(false)
  const edit = useRef<HTMLButtonElement>(null)
  const update = useMutation({
    mutationFn: (changes: { name?: string; requires_approval?: boolean }) => apiFetch<CacheInfo>(`/api/caches/${cache.id}`, { method: 'PATCH', body: changes }),
    onSuccess: async (_result, changes) => {
      await Promise.all([client.invalidateQueries({ queryKey: ['cache', cache.id] }), client.invalidateQueries({ queryKey: ['caches'] })])
      if (changes.name !== undefined) { setEditing(false); edit.current?.focus() }
    },
  })
  function submit(event: FormEvent) { event.preventDefault(); update.mutate({ name }) }
  return <section className="mt-6" aria-labelledby="settings-heading">
    <h2 id="settings-heading" className="cc-section-title">Cache</h2>
    <div className="cc-list">
      <div className="cc-row"><div className="min-w-0 flex-1"><p className="font-semibold">Name</p><p className="break-words text-sm text-slate-600">{cache.name}</p></div><button ref={edit} type="button" className="text-sm underline" aria-expanded={editing} onClick={() => { setName(cache.name); update.reset(); setEditing(true) }}>Edit<span className="sr-only"> cache name</span></button></div>
      {editing && <form onSubmit={submit} className="border-t border-slate-100 p-4"><label htmlFor="settings-name" className="block text-sm font-medium">Cache name</label><input autoFocus id="settings-name" className="cc-input" type="text" required maxLength={60} value={name} onChange={event => setName(event.target.value)} /><div className="mt-3 flex gap-2"><button disabled={update.isPending || !name.trim()} className="cc-pill">{update.isPending ? 'Saving…' : 'Save settings'}</button><button type="button" disabled={update.isPending} className="cc-outline" onClick={() => { setEditing(false); edit.current?.focus() }}>Cancel</button></div></form>}
      <label className="cc-row"><span className="min-w-0 flex-1"><span className="block font-semibold">Approve new members</span><span className="block text-sm text-slate-600">Off: anyone with the invite joins</span></span><input type="checkbox" role="switch" aria-checked={cache.requires_approval} checked={cache.requires_approval} disabled={update.isPending} onChange={() => update.mutate({ requires_approval: !cache.requires_approval })} className="cc-switch" /></label>
    </div>
    {update.isError && <p role="alert" className="mt-3 text-sm text-red-700">{errorMessage(update.error)}</p>}
    {update.isSuccess && <p role="status" className="mt-3 text-sm text-emerald-700">Settings saved.</p>}
  </section>
}

function RemoveMember({ cache, member }: { cache: CacheDetail; member: CacheDetail['members'][number] }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const client = useQueryClient()
  const name = member.display_name ?? 'this member'
  const remove = useMutation({
    mutationFn: () => apiFetch<void>(`/api/caches/${cache.id}/members/${member.user_id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      dialog.current?.close()
      await Promise.all(['cache', 'items', 'requests'].map(key => client.invalidateQueries({ queryKey: key === 'requests' ? [key] : [key, cache.id] })))
      // Removal unmounts its trigger; focus the surviving section heading.
      document.getElementById('members-heading')?.focus()
    },
  })
  return <>
    <button type="button" aria-label={`Remove ${name}`} className="shrink-0 text-sm text-red-800 underline" onClick={() => { remove.reset(); dialog.current?.showModal() }}>Remove</button>
    <dialog ref={dialog} onCancel={event => { if (remove.isPending) event.preventDefault() }} className="w-[calc(100%-2rem)] max-w-md rounded-lg bg-white p-6 text-slate-900" aria-labelledby={`remove-${member.user_id}`}>
      <h3 id={`remove-${member.user_id}`} className="text-lg font-semibold">Remove {name}?</h3>
      <p className="mt-3">They lose access immediately and cannot rejoin with an invite. Their items are deleted; their pending requests are rejected as “left the cache.”</p>
      {remove.isError && <p role="alert" className="mt-3 text-red-700">{errorMessage(remove.error)}</p>}
      <div className="mt-6 flex gap-3"><button type="button" autoFocus disabled={remove.isPending} onClick={() => dialog.current?.close()} className="cc-outline">Cancel</button><button type="button" disabled={remove.isPending} onClick={() => remove.mutate()} className="rounded-full bg-red-700 px-3.5 py-1.5 text-sm font-medium text-white disabled:opacity-60">{remove.isPending ? 'Removing…' : 'Confirm removal'}</button></div>
    </dialog>
  </>
}

export function CacheSettingsPage() {
  const { cacheId = '' } = useParams()
  const { me } = useAuth()
  const client = useQueryClient()
  const dialog = useRef<HTMLDialogElement>(null)
  const [copyStatus, setCopyStatus] = useState('')
  const [rotationStatus, setRotationStatus] = useState('')
  const query = useQuery({ queryKey: ['cache', cacheId], queryFn: () => apiFetch<CacheDetail>(`/api/caches/${cacheId}`), enabled: !!me?.display_name })
  const rotate = useMutation({
    mutationFn: () => apiFetch<CacheInfo>(`/api/caches/${cacheId}/invite/rotate`, { body: {} }),
    onSuccess: async () => {
      dialog.current?.close(); setCopyStatus(''); setRotationStatus('Invite rotated. The old link no longer works.')
      await client.invalidateQueries({ queryKey: ['cache', cacheId] })
    },
  })
  if (!me) return <Navigate to="/login" replace />
  if (!me.display_name) return <OnboardingPage />
  if (query.isPending) return <main className="cc-page"><p role="status">Loading cache settings…</p></main>
  if (query.isError) return <main className="cc-page"><Link to={`/caches/${cacheId}`} className="text-sm underline">‹ Back to cache</Link><p role="alert" className="mt-4 text-red-700">{errorMessage(query.error)}</p><button className="mt-4 underline" onClick={() => void query.refetch()}>Try again</button></main>
  const cache = query.data, owner = cache.owner_id === me.id
  const invite = new URL(`/join/${cache.invite_token}`, location.origin).href
  async function copy() {
    try { await navigator.clipboard.writeText(invite); setCopyStatus('Invite copied.') }
    catch { setCopyStatus('Could not copy automatically. Select the invite link and copy it.') }
  }
  return <main className="cc-page">
    <Link to={`/caches/${cache.id}`} className="text-sm underline">‹ {cache.name}</Link>
    <h1 className="mt-3 text-2xl font-semibold tracking-tight">Cache settings</h1>
    {owner && <JoinRequests cacheId={cache.id} />}
    <section className="mt-6" aria-labelledby="members-heading"><h2 id="members-heading" tabIndex={-1} className="cc-section-title">Members</h2><ul className="cc-list">{cache.members.map(member => <li key={member.user_id} className="cc-row"><div className="min-w-0 flex-1"><p className="break-words font-semibold">{member.display_name ?? 'Member'}</p>{member.user_id === cache.owner_id && <p className="text-sm text-slate-600">Owner</p>}</div>{owner && member.user_id !== cache.owner_id && <RemoveMember cache={cache} member={member} />}</li>)}</ul></section>
    <section className="mt-6" aria-labelledby="invite-heading"><h2 id="invite-heading" className="cc-section-title">Invite link</h2><div className="cc-list"><div className="cc-row"><a href={invite} className="min-w-0 flex-1 font-mono text-sm break-all select-all">{invite}</a><button type="button" className="cc-pill" onClick={() => void copy()}>Copy</button></div>{owner && <button type="button" className="cc-row w-full text-left" onClick={() => { rotate.reset(); dialog.current?.showModal() }}><span className="flex-1"><span className="block font-semibold">Reset link</span><span className="block text-sm text-slate-600">Old link stops working</span></span><span aria-hidden="true" className="text-xl leading-none text-slate-500">›</span></button>}</div>
      {copyStatus && <p role="status" className="mt-3 text-sm">{copyStatus}</p>}{rotationStatus && <p role="status" className="mt-3 text-sm text-emerald-700">{rotationStatus}</p>}
    </section>
    {owner && <OwnerSettings cache={cache} />}
    {owner && <dialog ref={dialog} onCancel={event => { if (rotate.isPending) event.preventDefault() }} className="w-[calc(100%-2rem)] max-w-md rounded-lg bg-white p-6 text-slate-900" aria-labelledby="rotate-heading"><h2 id="rotate-heading" className="text-xl font-semibold">Reset this invite?</h2><p className="mt-3">The old link will stop working. Existing members keep access.</p>{rotate.isError && <p role="alert" className="mt-3 text-red-700">{errorMessage(rotate.error)}</p>}<div className="mt-6 flex gap-3"><button type="button" autoFocus disabled={rotate.isPending} onClick={() => dialog.current?.close()} className="cc-outline">Cancel</button><button type="button" disabled={rotate.isPending} onClick={() => rotate.mutate()} className="cc-pill">{rotate.isPending ? 'Resetting…' : 'Confirm reset'}</button></div></dialog>}
  </main>
}
