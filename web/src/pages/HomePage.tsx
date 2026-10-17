import { useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { apiFetch, errorMessage } from '../lib/api'
import { askedWhen, cacheDetailQuery, cacheItemsQuery, greeting, incomingDescription, useHomeSummary, type CacheInfo, type CacheSummary } from '../lib/caches'
import { openCacheWithPeek } from '../components/peekOverlay'
import { useLibrary } from '../lib/items'
import { destinationAfterLogin, peekJoinToken } from '../lib/pendingJoin'
import { OnboardingPage } from './OnboardingPage'
import { Box } from '../components/Box'
import { Cat } from '../components/Cat'
import { MemberCats } from '../components/MemberCats'
import { Avatar } from '../components/Avatar'
import { Stamp } from '../components/Stamp'
import { ThingTile, ThingStatus } from '../components/ThingTile'
import { LandingPage } from './LandingPage'
import { JoinInviteSheet } from './JoinInviteSheet'
import { Turnstile, type TurnstileHandle } from '../components/Turnstile'
import { HomeBoxesSkeleton } from '../components/skeletons/HomeSkeleton'
import { SkeletonRows } from '../components/Skeleton'

export function HomePage() {
  const { me } = useAuth()
  const navigate = useNavigate(), client = useQueryClient()
  const dialog = useRef<HTMLDialogElement>(null), joinDialog = useRef<HTMLDialogElement>(null), actions = useRef<HTMLDialogElement>(null)
  const botCheck = useRef<TurnstileHandle>(null)
  const [createOpen, setCreateOpen] = useState(false), [botToken, setBotToken] = useState('')
  const [name, setName] = useState(''), [requiresApproval, setRequiresApproval] = useState(false)
  const caches = useQuery({ queryKey: ['caches'], queryFn: () => apiFetch<CacheSummary[]>('/api/caches'), enabled: !!me?.display_name })
  const summary = useHomeSummary(!!me?.display_name), library = useLibrary(me?.display_name ? me.id : undefined)
  const create = useMutation({
    mutationFn: () => apiFetch<CacheInfo>('/api/caches', { body: { name, requires_approval: requiresApproval }, turnstileToken: botToken }),
    onSettled: () => botCheck.current?.reset(),
    onSuccess: cache => {
      dialog.current?.close()
      void client.invalidateQueries({ queryKey: ['caches'] })
      navigate(`/caches/${cache.id}`)
    },
  })
  if (!me) return <LandingPage />
  if (peekJoinToken()) return <Navigate to={destinationAfterLogin()} replace />
  if (!me.display_name) return <OnboardingPage />
  function openCreate() { actions.current?.close(); create.reset(); setCreateOpen(true); dialog.current?.showModal() }
  function openJoin() { actions.current?.close(); joinDialog.current?.showModal() }
  function onCreate(event: FormEvent) { event.preventDefault(); create.mutate() }
  const incoming = summary.isError ? undefined : summary.data
  const things = library.data?.pages.flatMap(page=>page.items).slice(0,3) ?? []
  return <main className="organic-home">
    <button type="button" className="cc-home-plus" aria-label="New cache or join with an invite" aria-haspopup="dialog" onClick={()=>actions.current?.showModal()}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" aria-hidden="true"><path d="M5 12h14M12 5v14" /></svg></button>
    <section aria-labelledby="caches-heading">
      <div className="cc-home-title"><div><p>{greeting(new Date().getHours())}, {me.display_name}</p><h1 id="caches-heading">Your caches</h1></div><div className="cc-home-desktop-actions"><button type="button" className="cc-profile-secondary" aria-haspopup="dialog" onClick={openJoin}>Join with an invite</button><button type="button" className="cc-profile-primary" aria-haspopup="dialog" onClick={openCreate}>+ New cache</button></div></div>
      {summary.isError && <div className="cc-read-error"><p role="alert">{errorMessage(summary.error)} Ask summaries could not be loaded.</p><button type="button" onClick={()=>void summary.refetch()}>Try summaries again</button></div>}
      {!!incoming?.pending_answer_count && <div className="cc-answer-banner">
        <span className="cc-answer-avatars" aria-hidden="true">{incoming.incoming.map(ask=><Avatar key={ask.id} userId={ask.user_id} name={ask.display_name ?? 'Neighbor'} coat={ask.cat_coat} photoVersion={ask.profile_photo_version} size={34} />)}</span>
        <p><strong>{incoming.pending_answer_count} {incoming.pending_answer_count===1?'ask needs':'asks need'} your answer<span className="cc-desktop-copy">.</span></strong><span className="cc-desktop-copy"> {incoming.incoming.map(incomingDescription).join(' ')}</span></p><Link to="/requests" className="cc-banner-review">Review<span aria-hidden="true"> ›</span></Link>
      </div>}
      {caches.isPending && <HomeBoxesSkeleton />}
      {caches.isError && <div className="cc-read-error"><p role="alert">{errorMessage(caches.error)} Previously loaded caches may be out of date.</p><button type="button" onClick={()=>void caches.refetch()}>Try caches again</button></div>}
      {!!caches.data?.length && <ul className="cc-home-boxes">{caches.data.map(cache=><li key={cache.id}>
        <MemberCats members={cache.member_preview ?? []} total={cache.active_member_count} />
        <Link to={`/caches/${cache.id}`} className="cc-labelled-cache" onPointerDown={()=>{ void client.prefetchQuery(cacheDetailQuery(cache.id)); void client.prefetchQuery(cacheItemsQuery(cache.id)) }} onClick={event=>openCacheWithPeek(event,cache.id,()=>navigate(`/caches/${cache.id}`))}>
          <Box id={cache.id} label={cache.name}><span className="cc-box-counts">{cache.active_member_count} {cache.active_member_count===1?'neighbor':'neighbors'} · {cache.attached_item_count} {cache.attached_item_count===1?'thing':'things'}</span></Box>
          {!!cache.pending_answer_count && <span className="cc-box-asks"><Stamp tone="warn">{cache.pending_answer_count} {cache.pending_answer_count===1?'ask':'asks'}</Stamp></span>}
        </Link>
      </li>)}</ul>}
      {caches.isSuccess && !caches.data.length && <div className="cc-home-empty"><p>No caches yet. Create one to start sharing.</p><div className="cc-inline-actions"><button type="button" className="cc-profile-primary" onClick={openCreate}>New cache</button><button type="button" className="cc-profile-secondary" onClick={openJoin}>Join with an invite</button></div></div>}
    </section>
    <div className="cc-home-slips">
      <section aria-labelledby="your-things-heading"><div className="cc-slip-title"><h2 id="your-things-heading">Your things</h2><Link to="/items">{incoming?.owned_item_count ? `See all ${incoming.owned_item_count}` : 'See all'}</Link></div>
        {library.isPending && <SkeletonRows label="Loading your items…" kind="library" count={3} />}
        {library.isError && <div className="cc-read-error"><p role="alert">{errorMessage(library.error)} Previously loaded items may be out of date.</p><button type="button" onClick={()=>void library.refetch()}>Try your items again</button></div>}
        {!!things.length && <ul className="cc-packing-slip cc-home-things">{things.map(item=><li key={item.id}><Link to={`/items/${item.id}`}><ThingTile item={item} library tone="deep" /><strong>{item.title}</strong><span className="cc-thing-caches">{item.caches.map(cache=>cache.name).join(' · ') || 'Not shared yet'}</span><ThingStatus item={item} pending={item.is_consumable?0:item.pending_count} compact /></Link></li>)}</ul>}
        {library.isSuccess && !things.length && <div className="cc-packing-slip cc-empty-slip"><p>No things yet.</p><Link to="/items/new">+ New item</Link></div>}
      </section>
      <section aria-labelledby="your-asks-heading"><div className="cc-slip-title"><h2 id="your-asks-heading">Your asks</h2></div>
        {summary.isPending && <SkeletonRows label="Loading your asks…" kind="requests" count={2} />}
        {!!incoming?.outgoing.length && <ul className="cc-packing-slip cc-home-asks">{incoming.outgoing.map(ask=><li key={ask.id}><Avatar userId={ask.user_id} name={ask.display_name ?? 'Neighbor'} coat={ask.cat_coat} photoVersion={ask.profile_photo_version} size={34} /><div><p><strong>{ask.item_title}</strong> <span>from {ask.display_name ?? 'a neighbor'}</span></p><Link to="/requests">{ask.status==='approved' ? `See how to reach ${ask.display_name ?? 'the owner'}` : askedWhen(ask.created_at)}</Link></div><Stamp tone={ask.status==='approved'?'ok':'muted'}>{ask.status==='pending'?'Waiting':ask.status==='rejected'?'Declined':'Approved'}</Stamp></li>)}</ul>}
        {incoming && !incoming.outgoing.length && <div className="cc-packing-slip cc-empty-slip"><p>No asks in your current caches.</p><Link to="/requests">See all asks</Link></div>}
      </section>
    </div>
    <dialog ref={actions} className="cc-cache-actions" aria-labelledby="cache-actions-heading"><h2 id="cache-actions-heading" className="sr-only">Cache actions</h2><button type="button" className="cc-text-action" onClick={openCreate}>New cache</button><button type="button" className="cc-text-action" onClick={openJoin}>Join with an invite</button><button type="button" className="cc-text-action" onClick={()=>actions.current?.close()}>Cancel</button></dialog>
    <JoinInviteSheet dialog={joinDialog} />
    <dialog ref={dialog} className="cc-new-cache" aria-labelledby="new-cache-heading" onClose={()=>{setCreateOpen(false);setBotToken('')}} onCancel={event=>{if(create.isPending) event.preventDefault()}}>
      <div className="cc-sheet-grip" aria-hidden="true" />
      <div className="cc-create-preview"><span className="cc-preview-kicker">Preview</span><div className="cc-create-box-scene"><span className="cc-create-cat" aria-hidden="true"><Cat userId={me.id} coat={me.cat_coat} pose="sit" /></span><div className="cc-create-box"><span className="cc-box-handle" />{requiresApproval && <span className="cc-create-stamp"><Stamp>Owner approves joins</Stamp></span>}<strong>{name.trim() || 'Your cache'}</strong><span className="cc-create-counts"><span>1 member · 0 things</span><span>Just you, for now</span></span></div></div><p>That cat is you. Each person you invite adds another cat to the box.</p></div>
      <form onSubmit={onCreate} className="cc-create-form">
        <h2 id="new-cache-heading">New cache</h2><p className="cc-create-description">A cache is a shared box for one group of people. You can invite them once it's made.</p>
        <div className="cc-create-name"><label htmlFor="cache-name">Name</label><div><input autoFocus id="cache-name" type="text" required maxLength={120} value={name} onChange={event=>setName([...event.target.value].slice(0,60).join(''))} aria-describedby="cache-name-count" className="cc-profile-input" /><span id="cache-name-count">{[...name].length} / 60</span></div></div>
        <label className="cc-create-approval"><span><strong>Approve new members</strong><span>{requiresApproval ? 'On: you review everyone who uses the invite.' : 'Off: anyone with the invite joins right away.'}</span></span><input type="checkbox" role="switch" aria-checked={requiresApproval} checked={requiresApproval} onChange={event=>setRequiresApproval(event.target.checked)} className="cc-switch" /></label>
        {createOpen && <div className="cc-create-bot"><Turnstile ref={botCheck} action="create_cache" onToken={setBotToken} /></div>}
        {create.isError && <p role="alert" className="cc-form-error">{errorMessage(create.error)}</p>}
        <div className="cc-create-buttons"><button type="button" disabled={create.isPending} onClick={()=>dialog.current?.close()} className="cc-profile-secondary">Cancel</button><button type="submit" disabled={create.isPending || !name.trim() || !botToken} className="cc-profile-primary">{create.isPending?'Creating…':'Create cache'}</button></div>
      </form>
    </dialog>
  </main>
}
