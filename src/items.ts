import { HttpError } from './http'

export type ItemChanges = {
  title?: string; description?: string | null; is_consumable?: boolean
  quantity?: number | null; available?: boolean; unavailable_note?: string | null
}

export function itemChanges(body: Record<string, unknown>, creating: boolean): ItemChanges {
  if (Object.hasOwn(body, 'owner_id')) throw new HttpError(404, 'not_found')
  if (!creating && Object.hasOwn(body, 'is_consumable')) throw new HttpError(400, 'immutable_is_consumable')
  const changes: ItemChanges = {}
  if (creating) {
    if (typeof body.is_consumable !== 'boolean') throw new HttpError(400, 'invalid_is_consumable')
    changes.is_consumable = body.is_consumable
  }
  for (const [field, limit] of [['title', 120], ['description', 2000], ['unavailable_note', 200]] as const) {
    if (!Object.hasOwn(body, field) && !(creating && field === 'title')) continue
    const value = body[field]
    if (field !== 'title' && value === null) { changes[field] = null; continue }
    if (typeof value !== 'string' || [...value.trim()].length > limit || (field === 'title' && !value.trim())) throw new HttpError(400, `invalid_${field}`)
    if (field === 'title') changes.title = value.trim()
    else changes[field] = value.trim() || null
  }
  if (creating || Object.hasOwn(body, 'quantity')) {
    const quantity = body.quantity
    if (quantity !== null && quantity !== undefined && (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 0 || quantity > 9999)) throw new HttpError(400, 'invalid_quantity')
    if (creating && (body.is_consumable ? quantity === null || quantity === undefined : quantity !== null && quantity !== undefined)) throw new HttpError(400, 'invalid_quantity')
    if (!creating && quantity === undefined) throw new HttpError(400, 'invalid_quantity')
    changes.quantity = quantity === undefined ? null : quantity as number | null
  }
  if (Object.hasOwn(body, 'available')) {
    if (typeof body.available !== 'boolean') throw new HttpError(400, 'invalid_available')
    changes.available = body.available
  }
  if (!Object.keys(changes).length) throw new HttpError(400, 'invalid_json')
  return changes
}
