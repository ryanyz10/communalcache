import { HttpError } from './http'

export async function requireTurnstile(
  request: Request,
  env: { TURNSTILE_SECRET?: string; TURNSTILE_HOSTNAMES?: string },
  action: 'signin' | 'create_cache',
) {
  const token = request.headers.get('X-Turnstile-Token')
  const hostnames = env.TURNSTILE_HOSTNAMES?.split(',').map(host => host.trim()).filter(Boolean) ?? []
  if (!env.TURNSTILE_SECRET || !hostnames.length || !token?.trim() || token.length > 2048) throw new HttpError(403, 'turnstile_failed')
  try {
    const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token })
    const ip = request.headers.get('CF-Connecting-IP')
    if (ip) body.set('remoteip', ip)
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10_000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error('Rejected')
    }
    const verification = await response.json() as { success?: unknown; action?: unknown; hostname?: unknown }
    if (
      verification.success !== true || verification.action !== action ||
      typeof verification.hostname !== 'string' || !hostnames.includes(verification.hostname)
    ) throw new Error('Rejected')
  } catch {
    // Never expose provider errors, tokens, IPs or secret configuration.
    throw new HttpError(403, 'turnstile_failed')
  }
}
