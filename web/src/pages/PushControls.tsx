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
  return <section className="mt-6 lg:mt-0 lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:grid-rows-[auto_1fr] lg:items-start lg:gap-x-8 lg:border-b lg:border-slate-200 lg:py-6" aria-labelledby="push-heading">
    <h2 id="push-heading" className="cc-section-title lg:col-start-1 lg:row-start-1 lg:mb-1 lg:ml-0 lg:text-[17px] lg:tracking-normal lg:text-slate-900 lg:normal-case">Notifications on this device</h2>
    <p className="hidden lg:col-start-1 lg:row-start-2 lg:block lg:text-sm lg:text-slate-600">On this device.</p>
    <div className="contents lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:block">
    <div className="cc-list"><label className="cc-row"><span className="min-w-0 flex-1"><span className="block font-semibold">Push notifications</span><span id="push-help" className="block text-sm text-slate-600">Otherwise you get email.</span></span><input type="checkbox" role="switch" aria-label="Push notifications" aria-describedby="push-help" aria-checked={hasSubscription} checked={hasSubscription} disabled={pending || (!hasSubscription && (!registration || !config.data?.vapid_public_key || (support.ios && !support.standalone)))} onChange={() => { if (hasSubscription) void disable(); else void enable() }} className="cc-switch" /></label></div>
    <p className="mt-3 text-sm text-slate-600">Enable for the account you are using. Signing out removes this browser's subscription.</p>
    {support.ios && !support.standalone && <p className="mt-3">On iPhone or iPad, tap Share, then Add to Home Screen. Open the installed app and turn on Push notifications.</p>}
    {!support.supported && <p className="mt-3">Push notifications are not supported in this browser. You can still use email notifications.</p>}
    {config.isPending && <p role="status" className="mt-3">Loading notification configuration…</p>}
    {config.isError && <div className="mt-3"><p role="alert" className="text-red-700">Could not load notification configuration.</p><button type="button" disabled={config.isFetching} onClick={() => void config.refetch()} className="mt-2 underline">Try notification configuration again</button></div>}
    {config.isSuccess && !config.data.vapid_public_key && <p className="mt-3 text-slate-600">Push is not configured yet. Email notifications remain available.</p>}
    {hasSubscription && <p className="mt-3 text-sm">This browser has a subscription for this account.</p>}
    {pending && <p role="status" className="mt-3 text-sm">Updating notifications…</p>}
    {error && <p role="alert" className="mt-3 text-red-700">{error}</p>}
    {status && <p role="status" className="mt-3 text-emerald-700">{status}</p>}
    </div>
  </section>
}
