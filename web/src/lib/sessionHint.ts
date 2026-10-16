// A device-local paint hint, never identity, cached profile data or authorization.
const KEY = 'cc_signed_in'

export function hasSessionHint() {
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}

export function setSessionHint(signedIn: boolean) {
  try { if (signedIn) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY) } catch { /* Storage is optional. */ }
}
