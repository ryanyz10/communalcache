import { HttpError } from './http'

function decode(segment: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) throw new Error('Invalid JWT encoding')
  return Uint8Array.from(atob(segment.replaceAll('-', '+').replaceAll('_', '/')), character => character.charCodeAt(0))
}

function claims(segment: string): Record<string, unknown> {
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(decode(segment)))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid JWT object')
  return value
}

export async function verifyAccessJwt(request: Request, env: Pick<Env, 'CF_ACCESS_TEAM_DOMAIN' | 'CF_ACCESS_AUD'>) {
  try {
    const issuer = env.CF_ACCESS_TEAM_DOMAIN
    const audience = env.CF_ACCESS_AUD
    if (!issuer || !audience || !/^[0-9a-f]{64}$/.test(audience)) throw new Error('Missing Access configuration')
    const origin = new URL(issuer)
    if (origin.origin !== issuer || origin.protocol !== 'https:' || !origin.hostname.endsWith('.cloudflareaccess.com') || origin.port || origin.username || origin.password) throw new Error('Invalid Access issuer')
    // Only the edge assertion header is accepted; a browser cookie is not a fallback.
    const token = request.headers.get('Cf-Access-Jwt-Assertion')
    if (!token || token.length > 16_384) throw new Error('Missing Access assertion')
    const parts = token.split('.')
    if (parts.length !== 3) throw new Error('Invalid Access assertion')
    const header = claims(parts[0]), payload = claims(parts[1])
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid || header.kid.length > 256 || header.crit !== undefined) throw new Error('Invalid JWT header')
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
    const now = Date.now() / 1000
    if (payload.iss !== issuer || !audiences.every(value => typeof value === 'string') || !audiences.includes(audience)) throw new Error('Invalid JWT authority')
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || payload.exp <= now - 30) throw new Error('Expired JWT')
    if (payload.nbf !== undefined && (typeof payload.nbf !== 'number' || !Number.isFinite(payload.nbf) || payload.nbf > now + 30)) throw new Error('Future JWT')
    // Fetch only the configured team's fixed URL, never iss/jku/x5u from a token.
    const response = await fetch(issuer + '/cdn-cgi/access/certs', {
      redirect: 'manual', signal: AbortSignal.timeout(5_000), headers: { Accept: 'application/json' },
    })
    if (!response.ok) { await response.body?.cancel(); throw new Error('Access keys unavailable') }
    const jwks = await response.json() as { keys?: (JsonWebKey & { kid?: string })[] }
    if (!Array.isArray(jwks.keys) || jwks.keys.length > 32) throw new Error('Invalid Access keys')
    const jwk = jwks.keys.find(key => key.kid === header.kid && key.kty === 'RSA' && (!key.alg || key.alg === 'RS256') && (!key.use || key.use === 'sig'))
    if (!jwk || typeof jwk.n !== 'string' || typeof jwk.e !== 'string') throw new Error('Access key not found')
    const key = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decode(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]))
    if (!valid) throw new Error('Invalid Access signature')
  } catch { throw new HttpError(404, 'not_found') }
}
