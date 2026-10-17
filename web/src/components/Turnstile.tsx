import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react'
import { useQuery } from '@tanstack/react-query'
import { loadConfig } from '../lib/config'
import { loadTurnstile, mountTurnstile, turnstileTheme } from '../lib/turnstile'
import { Shimmer, LoadingStatus } from './Skeleton'

export type TurnstileHandle = { reset(): void }
export function Turnstile({ action, onToken, ref }: { action: 'signin' | 'create_cache'; onToken: (token: string) => void; ref?: Ref<TurnstileHandle> }) {
  const configQuery = useQuery({ queryKey: ['config'], queryFn: loadConfig })
  const container = useRef<HTMLDivElement>(null)
  const widget = useRef<ReturnType<typeof mountTurnstile> | null>(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [verified, setVerified] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  useEffect(() => {
    const preference = matchMedia('(prefers-color-scheme: dark)')
    function sync() { setTheme(turnstileTheme()) }
    sync()
    preference.addEventListener('change', sync)
    return () => preference.removeEventListener('change', sync)
  }, [])
  useImperativeHandle(ref, () => ({
    reset() {
      onToken('')
      setVerified(false)
      setError('')
      widget.current?.reset()
    },
  }), [onToken])
  const sitekey = configQuery.data?.turnstile_site_key
  useEffect(() => {
    onToken('')
    setVerified(false)
    if (!sitekey || !container.current) return
    let cancelled = false
    setError('')
    void loadTurnstile().then(api => {
      if (cancelled || !container.current) return
      widget.current = mountTurnstile(api, container.current, sitekey, action, theme, token => {
        onToken(token)
        setVerified(!!token)
      }, setError)
    }).catch(() => {
      if (!cancelled) setError('Bot check could not load. Please retry.')
    })
    return () => {
      cancelled = true
      if (widget.current) {
        widget.current.remove()
        widget.current = null
      }
    }
  }, [sitekey, action, theme, retry, onToken])

  const unavailable = configQuery.isError || (configQuery.isSuccess && !sitekey)
  let loading: ReactNode = null
  if (configQuery.isPending) loading = <div><LoadingStatus label="Loading bot check…" /><Shimmer width={300} height={64} /></div>
  else if (sitekey && !verified && !error) loading = <p role="status" className="text-sm text-slate-600">Checking your browser…</p>

  return <section className="mt-3" aria-label="Bot protection">
    <div ref={container} />
    {loading}
    {(error || unavailable) && <div>
      <p role="alert" className="text-sm text-red-700">{error || 'Bot protection is unavailable. Please retry.'}</p>
      <button type="button" className="mt-2 text-sm underline" onClick={() => {
        if (configQuery.isError) void configQuery.refetch()
        else if (unavailable) location.reload()
        else { onToken(''); setRetry(value => value + 1) }
      }}>Retry bot check</button>
    </div>}
  </section>
}
