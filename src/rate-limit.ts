import { consumeWriteLimit } from './db'
import { HttpError } from './http'

export const writeLimits = { join: 10, join_decision: 30, request: 20, request_decision: 60 } as const
export type WriteRoute = keyof typeof writeLimits

export async function requireWriteLimit(db: D1Database, userId: string, route: WriteRoute, now = Date.now()) {
  const windowStart = Math.floor(now / 60_000) * 60_000
  // ponytail: one D1 write per attempt; an approved Rate Limiting binding can replace this if D1 budgets demand it.
  const result = await consumeWriteLimit(db, userId, route, windowStart, writeLimits[route])
  if (result.meta.changes === 0) throw new HttpError(429, 'rate_limited', Math.max(1, Math.ceil((windowStart + 60_000 - now) / 1000)))
}
