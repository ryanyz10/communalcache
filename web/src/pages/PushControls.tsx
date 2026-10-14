import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ApiError, errorMessage } from '../lib/api'
import { loadConfig } from '../lib/config'
import { disablePush, enablePush, pushSupport, subscriptionForAccount } from '../lib/push'

export function PushControls({ userId }: { userId: string }) {
  const support = pushSupport()
  const config = useQuery({ queryKey: ['config'], queryFn: loadConfig })
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null)
  const [hasSubscription, setHasSubscription] = useState(false)
  const [pending, setPending] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    if (!support.supported) return
    let mounted = true
    void navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(async () => {
      const ready = await navigator.serviceWorker.ready
      if (!mounted) return
      const subscription = await subscriptionForAccount(ready, userId)
      if (mounted) { setRegistration(ready); setHasSubscription(!!subscription) }
    }).catch(() => { if (mounted) setError('Could not start notifications. Reload and try again.') })
    return () => { mounted = false }
  }, [support.supported, userId])
  async function enable() {
    if (!registration || !config.data?.vapid_public_key) return
    setPending(true); setError(''); setStatus('')
    try { await enablePush(registration, config.data.vapid_public_key, userId); setHasSubscription(true); setStatus('Notifications enabled for this account on this browser.') }
    catch (error) { setHasSubscription(false); setError(error instanceof ApiError ? errorMessage(error) : error instanceof Error ? error.message : 'Could not enable notifications.') }
    finally { setPending(false) }
  }
  async function disable() {
    setPending(true); setError(''); setStatus('')
    try { await disablePush(); setHasSubscription(false); setStatus('Notifications disabled on this browser.') }
    catch (error) { setError(errorMessage(error)) }
    finally { setPending(false) }
  }
  return <section className="mt-8" aria-labelledby="push-heading">
    <h2 id="push-heading" className="text-xl font-semibold">Notifications on this browser</h2>
    <p className="mt-2 text-sm text-slate-600">Enable for the account you are using. Signing out removes this browser's subscription. Without a live subscription, notifications use email.</p>
    {support.ios && !support.standalone && <p className="mt-3">On iPhone or iPad, tap Share, then Add to Home Screen. Open the installed app and tap Enable notifications.</p>}
    {!support.supported && <p className="mt-3">Push notifications are not supported in this browser. You can still use email notifications.</p>}
    {config.isPending && <p role="status" className="mt-3">Loading notification configuration…</p>}
    {config.isError && <div className="mt-3"><p role="alert" className="text-red-700">Could not load notification configuration.</p><button type="button" disabled={config.isFetching} onClick={() => void config.refetch()} className="mt-2 underline">Try notification configuration again</button></div>}
    {config.isSuccess && !config.data.vapid_public_key && <p className="mt-3 text-slate-600">Push is not configured yet. Email notifications remain available.</p>}
    {hasSubscription && <p className="mt-3 text-sm">This browser has a subscription. Enable for this account to confirm its assignment.</p>}
    <div className="mt-4 flex flex-wrap gap-3">
      <button type="button" disabled={pending || !registration || !config.data?.vapid_public_key || (support.ios && !support.standalone)} onClick={() => void enable()} className="rounded-md bg-slate-900 px-4 py-2 text-white disabled:opacity-60">{pending ? 'Updating…' : 'Enable notifications'}</button>
      {hasSubscription && <button type="button" disabled={pending} onClick={() => void disable()} className="rounded-md border border-slate-300 px-4 py-2 disabled:opacity-60">Disable notifications</button>}
    </div>
    {error && <p role="alert" className="mt-3 text-red-700">{error}</p>}
    {status && <p role="status" className="mt-3 text-emerald-700">{status}</p>}
  </section>
}
