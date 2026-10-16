import type { CatCoat } from './cats'

export class ApiError extends Error {
  status: number
  code: string
  retryAfter?: number
  limit?: string
  constructor(status: number, code: string, retryAfter?: number, limit?: string) {
    super(code)
    this.status = status
    this.code = code
    this.retryAfter = retryAfter
    this.limit = limit
  }
}

export type Me = { id: string; email: string; display_name: string | null; cat_coat?: CatCoat | null; profile_photo_version?: string | null }

type ApiOptions = { method?: string; body?: unknown; turnstileToken?: string }

export function turnstileHeaders(token: string) {
  if (!token.trim() || token.length > 2048) throw new ApiError(403, 'turnstile_failed')
  return { 'X-Turnstile-Token': token }
}

export async function apiFetch<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(opts.turnstileToken !== undefined ? turnstileHeaders(opts.turnstileToken) : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string; code?: string; limit?: string }
    const retryAfter = Number(res.headers.get('Retry-After'))
    throw new ApiError(res.status,data.error ?? data.code ?? 'request_failed',Number.isInteger(retryAfter) && retryAfter > 0 && retryAfter <= 60 ? retryAfter : undefined,typeof data.limit === 'string' ? data.limit : undefined)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export function errorMessage(error: unknown) {
  if (!(error instanceof ApiError)) return 'Could not connect. Please try again.'
  if (error.code === 'limit_reached') {
    const messages: Record<string,string> = {
      owned_caches: 'Limit reached: you already own the maximum number of caches.',
      new_caches_per_day: 'Limit reached: you have created the maximum number of caches in the last 24 hours. Try again later.',
      member_caches: 'Limit reached: you are already in the maximum number of caches.',
      cache_members: 'Limit reached: this cache has the maximum number of active members.',
      owned_items: 'Limit reached: your item library is full.',
      open_requests: 'Limit reached: you have the maximum number of pending asks. Wait for one to be answered.',
      photos_per_item: 'Limit reached: the photo allowance for this item is unavailable.',
      profile_photos: 'Limit reached: the profile photo allowance is unavailable.',
    }
    return error.limit && Object.hasOwn(messages,error.limit) ? messages[error.limit] : 'Limit reached: this action exceeds the current allowance.'
  }
  if (error.code === 'limits_unavailable') return 'Could not check the limits. Please try again later.'
  if (error.status === 429) return error.retryAfter ? `Too many tries. Please wait ${error.retryAfter} seconds and try again.` : 'Too many tries. Please wait a minute and try again.'
  if (error.code === 'turnstile_failed') return 'Bot check failed or expired. Please complete the new check and try again.'
  if (error.code === 'email_unavailable') return 'Could not send the sign-in email. Your invite is saved; please try again.'
  if (error.code === 'invalid_magic_link') return 'That sign-in link is invalid, expired or already used. Request a new link or use an email code.'
  if (error.code === 'invalid_callback') return 'That sign-in destination is not allowed. Request a new link from this app.'
  if (['INVALID_OTP', 'OTP_EXPIRED', 'TOO_MANY_ATTEMPTS', 'invalid_otp'].includes(error.code)) return 'That code is invalid or expired. Use the most recent code you requested, or request a new one.'
  if (error.code === 'invalid_cat_coat') return 'Choose one of the six cat coats, or use your default cat.'
  if (error.code === 'invalid_display_name') return 'Choose a name between 1 and 60 characters.'
  if (error.code === 'invalid_name') return 'Use a cache name between 1 and 60 characters.'
  if (error.code === 'member_removed') return 'You were removed from this cache and cannot rejoin with an invite.'
  if (error.code === 'join_not_pending') return 'This join request has already been decided. The list has been refreshed.'
  if (error.code === 'invalid_title') return 'Use an item title between 1 and 120 characters.'
  if (error.code === 'invalid_description') return 'Keep the description within 2000 characters.'
  if (error.code === 'invalid_quantity') return 'Use a whole stock quantity from 0 to 9999 for consumables; reusable items have no quantity.'
  if (error.code === 'invalid_is_consumable' || error.code === 'immutable_is_consumable') return 'Choose an item type when adding it. The type cannot be changed later.'
  if (error.code === 'quantity_reserved') return 'Stock cannot be lower than the quantity reserved by pending requests. Refresh the item and try again.'
  if (error.code === 'invalid_request_quantity') return 'Request a whole quantity from 1 to 9999 for consumables; reusable items have no quantity.'
  if (error.code === 'item_unavailable') return 'This item is marked as lent out. Existing requests are unchanged.'
  if (error.code === 'invalid_unavailable_note') return 'Keep the Lent out note within 200 characters.'
  if (error.code === 'invalid_lent_out') return 'Mark as lent out is available only when approving a reusable item.'
  if (error.code === 'invalid_available') return 'Choose whether this item is available.'
  if (error.code === 'insufficient_stock') return 'There is not enough available stock. The item and requests have been refreshed.'
  if (error.code === 'request_not_pending') return 'This request has already been decided. The list has been refreshed.'
  if (error.code === 'invalid_contact') return 'Enter a valid phone number, platform username or chosen email address, not a URL.'
  if (error.code === 'invalid_approval_message') return 'Keep the approval message within 500 characters.'
  if (error.code === 'invalid_reason') return 'Give a rejection reason between 1 and 500 characters.'
  if (error.code === 'invalid_photo_type' || error.code === 'invalid_photo') return "Couldn't read that image, try another JPEG, PNG or WebP."
  if (error.code === 'photo_too_large') return 'That photo is too large. Try a smaller image (maximum 5 MB after resizing).'
  if (error.code === 'invalid_push_endpoint' || error.code === 'invalid_push_keys') return 'This browser returned an unsupported push subscription.'
  if (error.code === 'owner_cannot_leave') return 'The cache owner cannot leave this cache.'
  if (error.code === 'owner_cannot_be_removed') return 'The cache owner cannot be removed.'
  if (error.code === 'push_limit') return 'Notifications are already enabled on three browsers for this account. Disable one before adding another.'
  if (error.status === 404) return 'This cache, item or invite is not available, or you are no longer a member.'
  if (error.status === 401) return 'Your session has expired. Sign in again.'
  return 'Could not complete that request. Please try again.'
}
