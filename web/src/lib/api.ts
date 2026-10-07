import type { Session } from '@supabase/supabase-js'

export class ApiError extends Error {
  status: number
  code: string

  constructor(status: number, code: string) {
    super(code)
    this.status = status
    this.code = code
  }
}

export type Me = {
  id: string
  email: string
  display_name: string | null
}

export type Cache = {
  id: string
  name: string
  owner_id: string
  invite_token: string
  requires_approval: boolean
}

export type CacheDetail = Cache & {
  members: { user_id: string; display_name: string | null }[]
}

type ApiOptions = {
  method?: string
  body?: unknown
  session: Session | null
  onProfileIncomplete?: () => void
}

export async function apiFetch<T>(path: string, opts: ApiOptions): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  }
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }
  if (opts.session?.access_token) {
    headers.Authorization = `Bearer ${opts.session.access_token}`
  }

  const res = await fetch(path, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })

  if (res.status === 409) {
    let code = 'conflict'
    try {
      const data = (await res.json()) as { error?: string }
      code = data.error ?? code
    } catch {
      /* ignore */
    }
    if (code === 'profile_incomplete') {
      opts.onProfileIncomplete?.()
    }
    throw new ApiError(res.status, code)
  }

  if (!res.ok) {
    let code = 'request_failed'
    try {
      const data = (await res.json()) as { error?: string }
      code = data.error ?? code
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, code)
  }

  if (res.status === 204) {
    return undefined as T
  }
  return (await res.json()) as T
}
