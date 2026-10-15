import type { RequestInfo } from './cache'
import { HttpError } from './http'
import { displayNames, requestCachePage } from './db'

export function requestQuantity(body: Record<string, unknown>) {
  if (Object.hasOwn(body, 'owner_id') || Object.hasOwn(body, 'requester_id')) throw new HttpError(404, 'not_found')
  const quantity = body.quantity ?? null
  if (quantity !== null && (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > 9999)) throw new HttpError(400, 'invalid_request_quantity')
  return quantity as number | null
}

export type DecisionInput = { reason: string | null; mark_lent_out: boolean; unavailable_note?: string | null }

export function decisionInput(body: Record<string, unknown>, action: 'approve' | 'reject'): DecisionInput {
  if (Object.hasOwn(body, 'owner_id') || Object.hasOwn(body, 'requester_id')) throw new HttpError(404, 'not_found')
  let reason: string | null = null
  if (action === 'reject') {
    if (typeof body.reason !== 'string' || !body.reason.trim() || [...body.reason.trim()].length > 500) throw new HttpError(400, 'invalid_reason')
    reason = body.reason.trim()
  }
  if (Object.hasOwn(body, 'mark_lent_out') && typeof body.mark_lent_out !== 'boolean') throw new HttpError(400, 'invalid_lent_out')
  if (action === 'reject' && body.mark_lent_out === true) throw new HttpError(400, 'invalid_lent_out')
  const input: DecisionInput = { reason, mark_lent_out: body.mark_lent_out === true }
  if (Object.hasOwn(body, 'unavailable_note')) {
    if (body.unavailable_note !== null && (typeof body.unavailable_note !== 'string' || [...body.unavailable_note.trim()].length > 200)) throw new HttpError(400, 'invalid_unavailable_note')
    input.unavailable_note = typeof body.unavailable_note === 'string' ? body.unavailable_note.trim() || null : null
  }
  return input
}

export async function enrichRequests(db: D1Database, requests: RequestInfo[]) {
  const names = await displayNames(db, [...new Set(requests.flatMap(row => [row.requester_id, row.owner_id]))])
  return requests.map(row => ({ ...row, requester_name: names.get(row.requester_id) ?? null, owner_name: names.get(row.owner_id) ?? null }))
}

export async function aggregateRequests(env: Env, userId: string, after: string | null) {
  const discovered = (await requestCachePage(env.DB, userId, after)).results
  // ponytail: 25 caches/page (below the 50 ceiling), five RPCs at once, leaving binding budget for auth/names.
  // Raise only with measured budgets; use continuation rather than a registry-wide fan-out.
  const page = discovered.slice(0, 25)
  const requests: RequestInfo[] = []
  const unavailable: string[] = []
  for (let offset = 0; offset < page.length; offset += 5) {
    const results = await Promise.all(page.slice(offset, offset + 5).map(async ({ cache_id }) => {
      try { return { cache_id, requests: await env.CACHES.get(env.CACHES.idFromName(cache_id.toLowerCase())).requestsForMember(userId) } }
      catch (error) { return { cache_id, requests: [], unavailable: !(error instanceof Error && error.message === 'not_found') } }
    }))
    for (const result of results) {
      requests.push(...result.requests)
      if (result.unavailable) unavailable.push(result.cache_id)
    }
  }
  requests.sort((left, right) => right.created_at - left.created_at || left.id.localeCompare(right.id))
  return { requests: await enrichRequests(env.DB, requests), unavailable_cache_ids: unavailable, next_cursor: discovered.length > 25 ? page.at(-1)!.cache_id : null }
}
