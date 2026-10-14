export class ApiError extends Error {
  status: number
  code: string
  constructor(status: number, code: string) {
    super(code)
    this.status = status
    this.code = code
  }
}

export type Me = { id: string; email: string; display_name: string | null }

type ApiOptions = { method?: string; body?: unknown }

export async function apiFetch<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string; code?: string }
    throw new ApiError(res.status, data.error ?? data.code ?? 'request_failed')
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export function errorMessage(error: unknown) {
  if (!(error instanceof ApiError)) return 'Could not connect. Please try again.'
  if (error.status === 429) return 'Too many tries. Please wait a minute and try again.'
  if (error.code === 'email_unavailable') return 'Could not send the code. Your invite is saved; please try again.'
  if (['INVALID_OTP', 'OTP_EXPIRED', 'TOO_MANY_ATTEMPTS', 'invalid_otp'].includes(error.code)) return 'That code is invalid or expired. Request a new code and use the newest email.'
  if (error.code === 'invalid_display_name') return 'Choose a name between 1 and 60 characters.'
  if (error.code === 'invalid_name') return 'Use a cache name between 1 and 60 characters.'
  if (error.code === 'member_removed') return 'You were removed from this cache and cannot rejoin with an invite.'
  if (error.code === 'join_not_pending') return 'This join request has already been decided. The list has been refreshed.'
  if (error.code === 'invalid_title') return 'Use an item title between 1 and 120 characters.'
  if (error.code === 'invalid_description') return 'Keep the description within 2000 characters.'
  if (error.code === 'invalid_quantity') return 'Use a whole stock quantity from 0 to 9999 for consumables; reusable items have no quantity.'
  if (error.code === 'invalid_is_consumable' || error.code === 'immutable_is_consumable') return 'Choose an item type when adding it. The type cannot be changed later.'
  if (error.code === 'quantity_reserved') return 'Stock cannot be lower than the quantity reserved by pending requests. Refresh the item and try again.'
  if (error.status === 404) return 'This cache, item or invite is not available, or you are no longer a member.'
  if (error.status === 401) return 'Your session has expired. Sign in again.'
  return 'Could not complete that request. Please try again.'
}
