import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { useQuery } from '@tanstack/react-query'
import { configQuery as appConfigQuery } from '../lib/config'
import { loadTurnstile, mountTurnstile, turnstileTheme } from '../lib/turnstile'

export type TurnstileStatus = 'checking' | 'verified' | 'failed'
export type TurnstileHandle = { reset(): void; retry(): void }
export function Turnstile({ action, onToken, onStatus, ref }: {
  action: 'signin' | 'create_cache'
  onToken: (token: string) => void
  onStatus?: (status: TurnstileStatus) => void
  ref?: Ref<TurnstileHandle>
}) {
  const configQuery = useQuery(appConfigQuery())
  const container = useRef<HTMLDivElement>(null)
  const widget = useRef<ReturnType<typeof mountTurnstile> | null>(null)
  const autoRetried = useRef(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [verified, setVerified] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const sitekey = configQuery.data?.turnstile_site_key
  const unavailable = configQuery.isError || (configQuery.isSuccess && !sitekey)

  const { isError: configError, refetch: refetchConfig } = configQuery
  const retryCheck = useCallback((automatic = false) => {
    onToken('')
    onStatus?.('checking')
    setVerified(false)
    setError('')
    if (!automatic) autoRetried.current = false
    if (configError || (automatic && unavailable)) void refetchConfig()
    else if (unavailable) location.reload()
    else setRetry(value => value + 1)
  }, [onToken, onStatus, configError, refetchConfig, unavailable])

  useEffect(() => {
    const preference = matchMedia('(prefers-color-scheme: dark)')
    function sync() { setTheme(turnstileTheme()) }
    sync()
    preference.addEventListener('change', sync)
    return () => preference.removeEventListener('change', sync)
  }, [])
  useImperativeHandle(ref, () => ({
    reset() {
      autoRetried.current = false
      onToken('')
      onStatus?.('checking')
      setVerified(false)
      setError('')
      widget.current?.reset()
    },
    retry() { retryCheck() },
  }))
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

  useEffect(() => {
    if (configQuery.isFetching) { onStatus?.('checking'); return }
    if (error || unavailable) {
      if (!autoRetried.current) {
        autoRetried.current = true
        retryCheck(true)
        return
      }
      onStatus?.('failed')
      return
    }
    onStatus?.(verified ? 'verified' : 'checking')
  }, [error, unavailable, verified, configQuery.isFetching, onStatus, retryCheck])

  return <section className="mt-3" aria-label="Bot protection">
    <div ref={container} />
  </section>
}
