import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ApiError, errorMessage } from '../lib/api'
import { loadConfig } from '../lib/config'
import { disablePush, enablePush, pushSupport, subscriptionForAccount } from '../lib/push'
import { LoadingLines } from '../components/Skeleton'

export function PushControls({ userId }: { userId: string }) {
  const support = pushSupport()
  const configQuery = useQuery({ queryKey: ['config'], queryFn: loadConfig })
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
      if (mounted) {
        setRegistration(ready)
        setHasSubscription(!!subscription)
      }
    }).catch(() => {
      if (mounted) setError('Could not start notifications. Reload and try again.')
    })
    return () => { mounted = false }
  }, [support.supported, userId])

  async function enable() {
    if (!registration || !configQuery.data?.vapid_public_key) return
    setPending(true)
    setError('')
    setStatus('')
    try {
      await enablePush(registration, configQuery.data.vapid_public_key, userId)
      setHasSubscription(true)
      setStatus('Notifications enabled for this account on this browser.')
    } catch (error) {
      setHasSubscription(false)
      if (error instanceof ApiError) setError(errorMessage(error))
      else if (error instanceof Error) setError(error.message)
      else setError('Could not enable notifications.')
    } finally {
      setPending(false)
    }
  }
  async function disable() {
    setPending(true)
    setError('')
    setStatus('')
    try {
      await disablePush()
      setHasSubscription(false)
      setStatus('Notifications disabled on this browser.')
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setPending(false)
    }
  }

  return <section className="cc-account-push" aria-labelledby="push-heading">
    <div className="cc-push-summary">
      <div>
        <h2 id="push-heading"><span className="cc-push-title-desktop">Notifications on this device</span><span className="cc-push-title-mobile">Push notifications</span></h2>
        <p id="push-help"><span className="cc-push-title-desktop">Push notifications. Otherwise you get email.</span><span className="cc-push-title-mobile">On this device. Otherwise email.</span></p>
      </div>
      <input
        type="checkbox" role="switch" aria-label="Push notifications" aria-describedby="push-help" aria-checked={hasSubscription} checked={hasSubscription}
        disabled={pending || (!hasSubscription && (!registration || !configQuery.data?.vapid_public_key || (support.ios && !support.standalone)))}
        onChange={() => { if (hasSubscription) void disable(); else void enable() }} className="cc-switch"
      />
    </div>
    {support.ios && !support.standalone && <p className="mt-3">On iPhone or iPad, tap Share, then Add to Home Screen. Open the installed app and turn on Push notifications.</p>}
    {!support.supported && <p className="mt-3">Push notifications are not supported in this browser. You can still use email notifications.</p>}
    {configQuery.isPending && <LoadingLines label="Loading notification configuration…" />}
    {configQuery.isError && <div className="mt-3">
      <p role="alert" className="text-red-700">Could not load notification configuration.</p>
      <button type="button" disabled={configQuery.isFetching} onClick={() => void configQuery.refetch()} className="mt-2 underline">Try notification configuration again</button>
    </div>}
    {pending && <p role="status" className="mt-3 text-sm">Updating notifications…</p>}
    {error && <p role="alert" className="mt-3 text-red-700">{error}</p>}
    {status && <p role="status" className="mt-3 text-emerald-700">{status}</p>}
  </section>
}
