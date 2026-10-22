import { useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useProfile } from '../auth/AuthProvider'
import { apiFetch, errorMessage } from '../lib/api'
import { cacheDetailQuery, type CacheDetail, type CacheInfo } from '../lib/caches'
import { invalidateRequestViews } from '../lib/requests'
import { JoinRequests } from './JoinRequests'
import { WideBreadcrumbs } from '../components/WideBreadcrumbs'
import { Avatar } from '../components/Avatar'
import { useToast } from '../components/Toast'
import { transientActionFailure } from '../lib/feedback'
import { CacheSettingsSkeleton } from '../components/skeletons/CacheSkeleton'

function OwnerSettings({ cache }: { cache: CacheDetail }) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [cacheName, setCacheName] = useState(cache.name)
  const [isEditingName, setIsEditingName] = useState(false)
  const editNameButton = useRef<HTMLButtonElement>(null)
  const updateSettings = useMutation({
    mutationFn: (changes: { name?: string; requires_approval?: boolean }) => apiFetch<CacheInfo>(
      `/api/caches/${cache.id}`, { method: 'PATCH', body: changes },
    ),
    onSuccess: async (_result, changes) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['cache', cache.id] }),
        queryClient.invalidateQueries({ queryKey: ['caches'] }),
      ])
      showToast('Settings saved.')
      if (changes.name !== undefined) {
        setIsEditingName(false)
        editNameButton.current?.focus()
      }
    },
    onError: error => { if (transientActionFailure(error)) showToast(errorMessage(error), 'error') },
  })

  function saveName(event: FormEvent) {
    event.preventDefault()
    updateSettings.mutate({ name: cacheName })
  }

  return <section
    className="mt-6 lg:mt-0 lg:scroll-mt-[84px] lg:rounded-[14px] lg:border lg:border-slate-200 lg:bg-white lg:p-4"
    aria-labelledby="settings-heading"
    id="cache"
  >
    <h2
      id="settings-heading"
      className="cc-section-title lg:mb-3 lg:ml-0 lg:text-[17px] lg:tracking-normal lg:text-slate-900 lg:normal-case"
    >
      Cache
    </h2>
    <div className="cc-list lg:border-0">
      <div className="cc-row">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Name</p>
          <p className="break-words text-sm text-slate-600">{cache.name}</p>
        </div>
        <button
          ref={editNameButton}
          type="button"
          className="text-sm underline"
          aria-expanded={isEditingName}
          onClick={() => {
            setCacheName(cache.name)
            updateSettings.reset()
            setIsEditingName(true)
          }}
        >
          Edit<span className="sr-only"> cache name</span>
        </button>
      </div>
      {isEditingName && <form onSubmit={saveName} className="border-t border-slate-100 p-4">
        <label htmlFor="settings-name" className="block text-sm font-medium">Cache name</label>
        <input
          autoFocus
          id="settings-name"
          className="cc-input"
          type="text"
          required
          maxLength={60}
          value={cacheName}
          onChange={event => setCacheName(event.target.value)}
        />
        <div className="mt-3 flex gap-2">
          <button disabled={updateSettings.isPending || !cacheName.trim()} className="cc-pill">
            {updateSettings.isPending ? 'Saving…' : 'Save settings'}
          </button>
          <button
            type="button"
            disabled={updateSettings.isPending}
            className="cc-outline"
            onClick={() => {
              setIsEditingName(false)
              editNameButton.current?.focus()
            }}
          >
            Cancel
          </button>
        </div>
      </form>}
      <label className="cc-row">
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">Approve new members</span>
          <span className="block text-sm text-slate-600">
            {cache.requires_approval
              ? 'On: you review everyone who uses the invite.'
              : 'Off: anyone with the invite joins right away.'}
          </span>
        </span>
        <input
          type="checkbox"
          role="switch"
          aria-checked={cache.requires_approval}
          checked={cache.requires_approval}
          disabled={updateSettings.isPending}
          onChange={() => updateSettings.mutate({ requires_approval: !cache.requires_approval })}
          className="cc-switch"
        />
      </label>
    </div>
    {updateSettings.isError && !transientActionFailure(updateSettings.error) && <p role="alert" className="mt-3 text-sm text-red-700">
      {errorMessage(updateSettings.error)}
    </p>}
  </section>
}

function RemoveMember({ cache, member }: { cache: CacheDetail; member: CacheDetail['members'][number] }) {
  const removeDialog = useRef<HTMLDialogElement>(null)
  const queryClient = useQueryClient()
  const memberName = member.display_name ?? 'this member'
  const { showToast } = useToast()
  const removeMember = useMutation({
    mutationFn: () => apiFetch<void>(`/api/caches/${cache.id}/members/${member.user_id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      removeDialog.current?.close()
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['cache', cache.id] }),
        queryClient.invalidateQueries({ queryKey: ['caches'] }),
        invalidateRequestViews(queryClient),
      ])
      showToast('Member removed.')
      // Removal unmounts its trigger; focus the surviving section heading.
      document.getElementById('members-heading')?.focus()
    },
    onError: error => { if (transientActionFailure(error)) showToast(errorMessage(error), 'error') },
  })

  return <>
    <button
      type="button"
      aria-label={`Remove ${memberName}`}
      className="shrink-0 text-sm text-red-800 underline"
      onClick={() => {
        removeMember.reset()
        removeDialog.current?.showModal()
      }}
    >
      Remove
    </button>
    <dialog
      ref={removeDialog}
      onCancel={event => { if (removeMember.isPending) event.preventDefault() }}
      className="w-[calc(100%-2rem)] max-w-md rounded-lg bg-white p-6 text-slate-900"
      aria-labelledby={`remove-${member.user_id}`}
    >
      <h3 id={`remove-${member.user_id}`} className="text-lg font-semibold">Remove {memberName}?</h3>
      <ul className="mt-3 list-disc space-y-2 pl-5">
        <li>They lose access immediately and cannot rejoin with an invite.</li>
        <li>Their pending requests here, and pending requests on their items here, are rejected.</li>
        <li>Their items stop being shared here. Their library, photos and other caches are kept.</li>
      </ul>
      {removeMember.isError && !transientActionFailure(removeMember.error) && <p role="alert" className="mt-3 text-red-700">{errorMessage(removeMember.error)}</p>}
      <div className="mt-6 flex gap-3">
        <button
          type="button"
          autoFocus
          disabled={removeMember.isPending}
          onClick={() => removeDialog.current?.close()}
          className="cc-outline"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={removeMember.isPending}
          onClick={() => removeMember.mutate()}
          className="rounded-full bg-red-700 px-3.5 py-1.5 text-sm font-medium text-white disabled:opacity-60"
        >
          {removeMember.isPending ? 'Removing…' : 'Confirm removal'}
        </button>
      </div>
    </dialog>
  </>
}

function LeaveCache({ cache }: { cache: CacheDetail }) {
  const { showToast } = useToast()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const leaveDialog = useRef<HTMLDialogElement>(null)
  const leaveCache = useMutation({
    mutationFn: () => apiFetch<void>(`/api/caches/${cache.id}/leave`, { body: {} }),
    onSuccess: async () => {
      leaveDialog.current?.close()
      queryClient.removeQueries({ queryKey: ['cache', cache.id] })
      queryClient.removeQueries({ queryKey: ['join-requests', cache.id] })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['caches'] }),
        invalidateRequestViews(queryClient),
      ])
      showToast('Left cache.')
      navigate('/')
    },
    onError: error => { if (transientActionFailure(error)) showToast(errorMessage(error), 'error') },
  })

  return <section className="mt-6">
    <button
      type="button"
      className="cc-outline text-red-800"
      onClick={() => {
        leaveCache.reset()
        leaveDialog.current?.showModal()
      }}
    >
      Leave cache
    </button>
    <dialog
      ref={leaveDialog}
      onCancel={event => { if (leaveCache.isPending) event.preventDefault() }}
      className="w-[calc(100%-2rem)] max-w-md rounded-lg bg-white p-6 text-slate-900"
      aria-labelledby="leave-cache-heading"
    >
      <h2 id="leave-cache-heading" className="text-xl font-semibold">Leave {cache.name}?</h2>
      <ul className="mt-3 list-disc space-y-2 pl-5">
        <li>You lose access to this cache.</li>
        <li>Pending requests here involving you or your items are rejected.</li>
        <li>Your library, photos and other caches are kept; your items stop being shared here.</li>
        <li>You may rejoin with a current invite; approval still applies. Old items are not re-shared automatically.</li>
      </ul>
      {leaveCache.isError && !transientActionFailure(leaveCache.error) && <p role="alert" className="mt-3 text-red-700">{errorMessage(leaveCache.error)}</p>}
      <div className="mt-6 flex gap-3">
        <button
          type="button"
          autoFocus
          disabled={leaveCache.isPending}
          onClick={() => leaveDialog.current?.close()}
          className="cc-outline"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={leaveCache.isPending}
          onClick={() => leaveCache.mutate()}
          className="cc-pill"
        >
          {leaveCache.isPending ? 'Leaving…' : 'Confirm leave'}
        </button>
      </div>
    </dialog>
  </section>
}

export function CacheSettingsPage() {
  const { cacheId = '' } = useParams()
  const me = useProfile()
  const queryClient = useQueryClient()
  const rotateDialog = useRef<HTMLDialogElement>(null)
  const { showToast } = useToast()
  const cacheQuery = useQuery({ ...cacheDetailQuery(cacheId), enabled: !!me.display_name })
  const rotateInvite = useMutation({
    mutationFn: () => apiFetch<CacheInfo>(`/api/caches/${cacheId}/invite/rotate`, { body: {} }),
    onSuccess: async () => {
      rotateDialog.current?.close()
      showToast('Invite rotated. The old link no longer works.')
      await queryClient.invalidateQueries({ queryKey: ['cache', cacheId] })
    },
    onError: error => { if (transientActionFailure(error)) showToast(errorMessage(error), 'error') },
  })

  if (cacheQuery.isPending) return <CacheSettingsSkeleton cacheId={cacheId} />
  if (cacheQuery.isError) return <main className="cc-page">
    <Link to={`/caches/${cacheId}`} className="text-sm underline">‹ Back to cache</Link>
    <p role="alert" className="mt-4 text-red-700">{errorMessage(cacheQuery.error)}</p>
    <button className="mt-4 underline" onClick={() => void cacheQuery.refetch()}>Try again</button>
  </main>

  const cache = cacheQuery.data
  const isOwner = cache.owner_id === me.id
  const inviteUrl = new URL(`/join/${cache.invite_token}`, location.origin).href

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(inviteUrl)
      showToast('Invite copied.')
    } catch {
      showToast('Could not copy automatically. Select the invite link and copy it.', 'error')
    }
  }

  return <main className="cc-page cc-cache-settings-page">
    <WideBreadcrumbs>
      <Link to="/">Caches</Link>
      <span aria-hidden="true">›</span>
      <Link to={`/caches/${cache.id}`}>{cache.name}</Link>
      <span aria-hidden="true">›</span>
      <span>Settings</span>
    </WideBreadcrumbs>
    <Link to={`/caches/${cache.id}`} className="text-sm underline lg:hidden">‹ {cache.name}</Link>
    <h1 className="mt-3 text-2xl font-semibold tracking-tight lg:text-[28px] lg:font-bold">Cache settings</h1>
    <div className="contents lg:mt-6 lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:items-start lg:gap-8">
      <nav aria-label="Settings sections" className="hidden lg:sticky lg:top-[84px] lg:flex lg:flex-col lg:gap-0.5">
        {isOwner && <a
          href="#join-requests"
          className="lg:rounded-lg lg:px-3 lg:py-2 lg:font-medium lg:text-slate-700 lg:hover:bg-slate-200"
        >
          Join requests
        </a>}
        <a href="#members" className="lg:rounded-lg lg:px-3 lg:py-2 lg:font-medium lg:text-slate-700 lg:hover:bg-slate-200">
          Members
        </a>
        <a href="#invite" className="lg:rounded-lg lg:px-3 lg:py-2 lg:font-medium lg:text-slate-700 lg:hover:bg-slate-200">
          Invite link
        </a>
        {isOwner && <a
          href="#cache"
          className="lg:rounded-lg lg:px-3 lg:py-2 lg:font-medium lg:text-slate-700 lg:hover:bg-slate-200"
        >
          Cache
        </a>}
      </nav>
      <div className="contents lg:block lg:min-w-0 lg:space-y-5">
        {isOwner && <JoinRequests cacheId={cache.id} />}
        <section
          className="mt-6 lg:mt-0 lg:scroll-mt-[84px] lg:rounded-[14px] lg:border lg:border-slate-200 lg:bg-white lg:p-4"
          aria-labelledby="members-heading"
          id="members"
        >
          <h2
            id="members-heading"
            tabIndex={-1}
            className="cc-section-title lg:mb-3 lg:ml-0 lg:text-[17px] lg:tracking-normal lg:text-slate-900 lg:normal-case"
          >
            Members
          </h2>
          <ul className="cc-list lg:border-0">
            {!cache.members.length && <li className="cc-list-empty">No members yet.</li>}
            {cache.members.map(member => <li key={member.user_id} className="cc-row">
              <Avatar
                userId={member.user_id}
                name={member.display_name ?? 'Member'}
                photoVersion={member.profile_photo_version}
                coat={member.cat_coat}
              />
              <div className="min-w-0 flex-1">
                <p className="break-words font-semibold">{member.display_name ?? 'Member'}</p>
                {member.user_id === cache.owner_id && <p className="text-sm text-slate-600">Owner</p>}
              </div>
              {isOwner && member.user_id !== cache.owner_id && <RemoveMember cache={cache} member={member} />}
            </li>)}
          </ul>
        </section>
        <section
          className="mt-6 lg:mt-0 lg:scroll-mt-[84px] lg:rounded-[14px] lg:border lg:border-slate-200 lg:bg-white lg:p-4"
          aria-labelledby="invite-heading"
          id="invite"
        >
          <h2
            id="invite-heading"
            className="cc-section-title lg:mb-3 lg:ml-0 lg:text-[17px] lg:tracking-normal lg:text-slate-900 lg:normal-case"
          >
            Invite link
          </h2>
          <div className="cc-list lg:border-0">
            <div className="cc-row">
              <a href={inviteUrl} className="min-w-0 flex-1 font-mono text-sm break-all select-all">{inviteUrl}</a>
              <button type="button" className="cc-pill" onClick={() => void copyInvite()}>Copy</button>
            </div>
            {isOwner && <button
              type="button"
              className="cc-row w-full text-left"
              onClick={() => {
                rotateInvite.reset()
                rotateDialog.current?.showModal()
              }}
            >
              <span className="flex-1">
                <span className="block font-semibold">Reset link</span>
                <span className="block text-sm text-slate-600">Old link stops working</span>
              </span>
              <span aria-hidden="true" className="text-xl leading-none text-slate-500">›</span>
            </button>}
          </div>
        </section>
        {isOwner ? <OwnerSettings cache={cache} /> : <LeaveCache cache={cache} />}
        {isOwner && <dialog
          ref={rotateDialog}
          onCancel={event => { if (rotateInvite.isPending) event.preventDefault() }}
          className="w-[calc(100%-2rem)] max-w-md rounded-lg bg-white p-6 text-slate-900"
          aria-labelledby="rotate-heading"
        >
          <h2 id="rotate-heading" className="text-xl font-semibold">Reset this invite?</h2>
          <p className="mt-3">The old link will stop working. Existing members keep access.</p>
          {rotateInvite.isError && !transientActionFailure(rotateInvite.error) && <p role="alert" className="mt-3 text-red-700">{errorMessage(rotateInvite.error)}</p>}
          <div className="mt-6 flex gap-3">
            <button
              type="button"
              autoFocus
              disabled={rotateInvite.isPending}
              onClick={() => rotateDialog.current?.close()}
              className="cc-outline"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={rotateInvite.isPending}
              onClick={() => rotateInvite.mutate()}
              className="cc-pill"
            >
              {rotateInvite.isPending ? 'Resetting…' : 'Confirm reset'}
            </button>
          </div>
        </dialog>}
      </div>
    </div>
  </main>
}
