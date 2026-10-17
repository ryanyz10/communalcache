import { HttpError } from './http'

export function requestQuantity(body: Record<string, unknown>) {
  if (Object.hasOwn(body, 'owner_id') || Object.hasOwn(body, 'requester_id')) throw new HttpError(404, 'not_found')
  const quantity = body.quantity ?? null
  if (quantity !== null && (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > 9999)) {
    throw new HttpError(400, 'invalid_request_quantity')
  }
  return quantity as number | null
}

export type DecisionInput = {
  reason: string | null
  mark_lent_out: boolean
  approval_message?: string | null
  unavailable_note?: string | null
}

export function decisionInput(body: Record<string, unknown>, action: 'approve' | 'reject'): DecisionInput {
  if (Object.hasOwn(body, 'owner_id') || Object.hasOwn(body, 'requester_id')) throw new HttpError(404, 'not_found')
  let reason: string | null = null
  if (action === 'reject') {
    if (typeof body.reason !== 'string' || !body.reason.trim() || [...body.reason.trim()].length > 500) {
      throw new HttpError(400, 'invalid_reason')
    }
    reason = body.reason.trim()
  }
  if (Object.hasOwn(body, 'mark_lent_out') && typeof body.mark_lent_out !== 'boolean') throw new HttpError(400, 'invalid_lent_out')
  if (action === 'reject' && body.mark_lent_out === true) throw new HttpError(400, 'invalid_lent_out')
  const input: DecisionInput = { reason, mark_lent_out: body.mark_lent_out === true }
  if (Object.hasOwn(body, 'approval_message')) {
    if (action !== 'approve' || typeof body.approval_message !== 'string' || [...body.approval_message.trim()].length > 500 || body.approval_message.includes('\u0000')) {
      throw new HttpError(400, 'invalid_approval_message')
    }
    input.approval_message = body.approval_message.trim() || null
  }
  if (Object.hasOwn(body, 'unavailable_note')) {
    if (body.unavailable_note !== null && (typeof body.unavailable_note !== 'string' || [...body.unavailable_note.trim()].length > 200)) {
      throw new HttpError(400, 'invalid_unavailable_note')
    }
    input.unavailable_note = typeof body.unavailable_note === 'string' ? body.unavailable_note.trim() || null : null
  }
  return input
}
