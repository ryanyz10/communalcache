import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { apiFetch } from '../lib/api'
import { adminListPath, setAdminFlag, setAdminPlan, type AdminCache, type AdminFlag, type AdminOutbox, type AdminOverview, type AdminPageRows, type AdminPlan, type AdminUser } from '../lib/admin'

function PlanControl({ kind, id, plan, plans, onSaved }: { kind: 'caches' | 'users'; id: string; plan: string; plans: AdminPlan[]; onSaved: () => Promise<void> }) {
  const [selected, setSelected] = useState(plan)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  async function save(event: FormEvent) {
    event.preventDefault()
    setPending(true); setMessage('')
    try {
      await setAdminPlan(kind, id, selected)
      await onSaved()
      setMessage('Saved')
    } catch { setMessage('Could not save. Refresh and try again.') }
    finally { setPending(false) }
  }
  return <form className="cc-admin-plan" onSubmit={save}>
    <select aria-label={`Plan for ${id}`} value={selected} disabled={pending} onChange={event => { setSelected(event.target.value); setMessage('') }}>
      {plans.map(option => <option key={option.plan} value={option.plan}>{option.plan}</option>)}
    </select>
    <button type="submit" className="cc-outline" disabled={pending || selected === plan || !plans.some(option => option.plan === selected)}>{pending ? 'Saving…' : 'Save'}</button>
    {message && <span role="status">{message}</span>}
  </form>
}

export function FlagControl({ flag, onSaved }: { flag: AdminFlag; onSaved: () => Promise<void> }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  async function change() {
    setPending(true)
    setError('')
    try {
      await setAdminFlag(flag.key, !flag.enabled)
      await onSaved()
    } catch { setError('Could not change switch. Refresh and try again.') }
    finally { setPending(false) }
  }
  return <div className="cc-admin-plan">
    <label htmlFor={`flag-${flag.key}`}>Google sign-in</label>
    <input id={`flag-${flag.key}`} type="checkbox" role="switch" aria-label="Google sign-in" aria-checked={flag.enabled} checked={flag.enabled} disabled={pending} onChange={() => void change()} className="cc-switch" />
    {pending && <span role="status">Saving…</span>}
    {error && <span role="alert">{error}</span>}
  </div>
}

function Pager({ label, after, next, pending, change }: { label: string; after: string | null; next?: string | null; pending: boolean; change: (cursor: string | null) => void }) {
  return <div className="cc-admin-pager">
    <button className="cc-outline" disabled={!after || pending} onClick={() => change(null)}>First {label} page</button>
    <button className="cc-outline" disabled={!next || pending} onClick={() => change(next!)}>Next {label} page</button>
  </div>
}

function usage(used: number, limit: number | null) { return `${used} / ${limit ?? 'policy missing'}` }
function timestamp(value: number) { return new Date(value).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' }

export function AdminPage() {
  const { me } = useAuth()
  const client = useQueryClient()
  const [cacheAfter, setCacheAfter] = useState<string | null>(null)
  const [userAfter, setUserAfter] = useState<string | null>(null)
  const [outboxAfter, setOutboxAfter] = useState<string | null>(null)
  const prefix = ['admin', me?.id]
  const overview = useQuery({ queryKey: [...prefix, 'overview'], queryFn: () => apiFetch<AdminOverview>('/api/admin/overview'), enabled: !!me, retry: false })
  const enabled = !!me && overview.isSuccess
  const caches = useQuery({ queryKey: [...prefix, 'caches', cacheAfter], queryFn: () => apiFetch<AdminPageRows<AdminCache>>(adminListPath('caches', cacheAfter)), enabled, retry: false })
  const users = useQuery({ queryKey: [...prefix, 'users', userAfter], queryFn: () => apiFetch<AdminPageRows<AdminUser>>(adminListPath('users', userAfter)), enabled, retry: false })
  const outbox = useQuery({ queryKey: [...prefix, 'failed-outbox', outboxAfter], queryFn: () => apiFetch<AdminPageRows<AdminOutbox>>(adminListPath('failed-outbox', outboxAfter)), enabled, retry: false })
  const flags = useQuery({ queryKey: [...prefix, 'flags'], queryFn: () => apiFetch<{ flags: AdminFlag[] }>('/api/admin/flags'), enabled, retry: false })
  async function refresh() { await client.invalidateQueries({ queryKey: prefix }) }
  if (!me || overview.isError) return <main className="cc-admin-page"><p role="alert">This page is not available.</p><Link to="/">Back to Home</Link></main>
  if (!overview.data) return <main className="cc-admin-page" aria-busy="true"><p role="status">Loading…</p></main>
  const totals = overview.data
  return <main className="cc-admin-page">
    <header><div><p className="cc-admin-eyebrow">Private operations</p><h1>Admin</h1></div><Link to="/">Back to Home</Link><button className="cc-outline" onClick={() => void refresh()}>Refresh</button></header>
    <p>Names, IDs and operational counts only. Plan changes do not delete data or bypass sharing rules. Tables scroll sideways on small screens.</p>
    <section aria-label="Overview" className="cc-admin-overview">
      <div><strong>{totals.users}</strong><span>Users</span></div><div><strong>{totals.caches}</strong><span>Caches</span></div>
      <div><strong>{totals.items}</strong><span>Items</span></div><div><strong>{totals.pending_requests}</strong><span>Pending requests</span></div>
    </section>
    <p className="cc-admin-backlog">Outbox: <b>{totals.outbox_pending}</b> pending · <b>{totals.outbox_failed}</b> failed · oldest pending age: <b>{totals.outbox_oldest_age_ms === null ? 'None' : `${Math.floor(totals.outbox_oldest_age_ms / 60_000)} min`}</b></p>
    <p className="cc-admin-backlog">Photo cleanup: <b>{totals.cleanup_pending}</b> pending · oldest pending age: <b>{totals.cleanup_oldest_age_ms === null ? 'None' : `${Math.floor(totals.cleanup_oldest_age_ms / 60_000)} min`}</b></p>
    <section aria-labelledby="admin-switches-heading">
      <h2 id="admin-switches-heading">Switches</h2>
      <p>Switches take effect on the server without a redeploy. Google still requires configured credentials.</p>
      {flags.isPending && <p role="status">Loading switches…</p>}
      {flags.isError && <p role="alert">Could not load switches. Use Refresh to retry.</p>}
      {flags.data?.flags.map(flag => <FlagControl key={flag.key} flag={flag} onSaved={async () => {
        await client.invalidateQueries({ queryKey: [...prefix, 'flags'] }, { throwOnError: true })
        await client.invalidateQueries({ queryKey: ['config'] })
      }} />)}
      {flags.data && !flags.data.flags.length && <p>No switches configured.</p>}
    </section>
    <section aria-labelledby="admin-caches-heading">
      <h2 id="admin-caches-heading">Caches</h2>
      {caches.isPending && <p role="status">Loading caches…</p>}
      {caches.isError && <p role="alert">Could not load caches. Use Refresh to retry.</p>}
      {caches.data && <>
        <div className="cc-admin-table-scroll" role="region" aria-label="Caches table" tabIndex={0}><table>
          <thead><tr><th scope="col">Cache</th><th scope="col">Owner</th><th scope="col">Members / limit</th><th scope="col">Shared items</th><th scope="col">Plan</th></tr></thead>
          <tbody>{caches.data.rows.map(row => <tr key={row.id}>
            <td>{row.name}<code>{row.id}</code></td><td>{row.owner_name ?? 'Name not set'}<code>{row.owner_id ?? 'No owner'}</code></td>
            <td>{usage(row.member_count, row.member_limit)}</td><td>{row.item_count}</td>
            <td><PlanControl key={`${row.id}:${row.plan}`} kind="caches" id={row.id} plan={row.plan} plans={totals.plans} onSaved={refresh} /></td>
          </tr>)}</tbody>
        </table></div>
        {!caches.data.rows.length && <p>No caches.</p>}
        <Pager label="caches" after={cacheAfter} next={caches.data.next_cursor} pending={caches.isFetching} change={setCacheAfter} />
      </>}
    </section>
    <section aria-labelledby="admin-users-heading">
      <h2 id="admin-users-heading">Users</h2>
      {users.isPending && <p role="status">Loading users…</p>}
      {users.isError && <p role="alert">Could not load users. Use Refresh to retry.</p>}
      {users.data && <>
        <div className="cc-admin-table-scroll" role="region" aria-label="Users table" tabIndex={0}><table>
          <thead><tr><th scope="col">User</th><th scope="col">Owned caches</th><th scope="col">Items</th><th scope="col">Pending outgoing</th><th scope="col">Memberships</th><th scope="col">New caches / 24h</th><th scope="col">Profile photos</th><th scope="col">Plan</th></tr></thead>
          <tbody>{users.data.rows.map(row => <tr key={row.id}>
            <td>{row.display_name ?? 'Name not set'}<code>{row.id}</code></td><td>{usage(row.owned_caches, row.owned_cache_limit)}</td>
            <td>{usage(row.owned_items, row.owned_item_limit)}</td><td>{usage(row.pending_outgoing, row.pending_limit)}</td><td>{usage(row.memberships, row.membership_limit)}</td>
            <td>{usage(row.new_caches_24h, row.new_cache_limit)}</td><td>{usage(row.profile_photos, row.profile_photo_limit)}</td>
            <td><PlanControl key={`${row.id}:${row.plan}`} kind="users" id={row.id} plan={row.plan} plans={totals.plans} onSaved={refresh} /></td>
          </tr>)}</tbody>
        </table></div>
        {!users.data.rows.length && <p>No users.</p>}
        <Pager label="users" after={userAfter} next={users.data.next_cursor} pending={users.isFetching} change={setUserAfter} />
      </>}
    </section>
    <section aria-labelledby="admin-outbox-heading">
      <h2 id="admin-outbox-heading">Failed outbox</h2>
      <p>Delivery errors have no stored classification yet. No message contents or recipient details are available here.</p>
      {outbox.isPending && <p role="status">Loading failed outbox…</p>}
      {outbox.isError && <p role="alert">Could not load failed outbox. Use Refresh to retry.</p>}
      {outbox.data && <>
        <div className="cc-admin-table-scroll" role="region" aria-label="Failed outbox table" tabIndex={0}><table>
          <thead><tr><th scope="col">ID</th><th scope="col">Kind</th><th scope="col">Created</th><th scope="col">Failed</th><th scope="col">Attempts</th><th scope="col">Error class</th></tr></thead>
          <tbody>{outbox.data.rows.map(row => <tr key={row.id}><td><code>{row.id}</code></td><td>{row.kind}</td><td>{timestamp(row.created_at)}</td><td>{timestamp(row.failed_at)}</td><td>{row.attempts}</td><td>{row.error_class ?? 'Not recorded'}</td></tr>)}</tbody>
        </table></div>
        {!outbox.data.rows.length && <p>No failed deliveries.</p>}
        <Pager label="outbox" after={outboxAfter} next={outbox.data.next_cursor} pending={outbox.isFetching} change={setOutboxAfter} />
      </>}
    </section>
  </main>
}
