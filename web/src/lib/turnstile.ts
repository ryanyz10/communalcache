// No ready(): Turnstile rejects it when api.js is loaded async, as we do.
export type TurnstileApi = {
  render(container: HTMLElement, options: {
    sitekey: string; action: 'signin' | 'create_cache'; theme: 'light' | 'dark'; appearance: 'interaction-only'; retry: 'never';
    callback(token: string): void; 'expired-callback'(): void; 'timeout-callback'(): void; 'error-callback'(): boolean;
  }): string
  reset(id: string): void
  remove(id: string): void
}
declare global { interface Window { turnstile?: TurnstileApi } }
let loading: Promise<TurnstileApi> | undefined

export function loadTurnstile() {
  if (loading) return loading
  loading = new Promise<TurnstileApi>((resolve, reject) => {
    if (window.turnstile) { resolve(window.turnstile); return }
    const script = document.createElement('script')
    const timer = setTimeout(failed, 15_000)
    function failed() {
      clearTimeout(timer); script.remove()
      reject(new Error('Bot check could not load. Please retry.'))
    }
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.onerror = failed
    script.onload = () => {
      if (!window.turnstile) { failed(); return }
      clearTimeout(timer); resolve(window.turnstile)
    }
    document.head.appendChild(script)
  }).catch(error => { loading = undefined; throw error })
  return loading
}

export function mountTurnstile(api: TurnstileApi, container: HTMLElement, sitekey: string, action: 'signin' | 'create_cache', theme: 'light' | 'dark', onToken: (token: string) => void, onError: (error: string) => void) {
  let active = true
  function invalid(message: string) { if (active) { onToken(''); onError(message) } }
  const id = api.render(container, {
    sitekey, action, theme, appearance: 'interaction-only', retry: 'never',
    callback: token => { if (active) { onToken(token); onError('') } },
    'expired-callback': () => invalid('Bot check expired. Please retry.'),
    'timeout-callback': () => invalid('Bot check timed out. Please retry.'),
    'error-callback': () => { invalid('Bot check failed. Please retry.'); return true },
  })
  return {
    reset() { if (active) { onToken(''); onError(''); api.reset(id) } },
    remove() { active = false; api.remove(id) },
  }
}

export function turnstileTheme() {
  return getComputedStyle(document.documentElement).colorScheme === 'dark' ? 'dark' : 'light'
}
