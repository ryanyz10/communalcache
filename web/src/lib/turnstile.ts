export type TurnstileApi = {
  ready(callback: () => void): void
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
    const script = window.turnstile ? null : document.createElement('script')
    let settled = false
    function failed() {
      if (settled) return
      settled = true; clearTimeout(timer); script?.remove()
      reject(new Error('Bot check could not load. Please retry.'))
    }
    const timer = setTimeout(failed, 15_000)
    function ready() {
      const api = window.turnstile
      if (!api) { failed(); return }
      try { api.ready(() => { if (!settled) { settled = true; clearTimeout(timer); resolve(api) } }) }
      catch { failed() }
    }
    if (!script) { ready(); return }
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.onerror = failed
    script.onload = ready
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
