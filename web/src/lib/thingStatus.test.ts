import { expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ThingStatus } from '../components/ThingTile'
import type { Item } from './items'

const item: Item = { id: 'item', cache_id: 'cache', owner_id: 'owner', owner_name: 'Owner', title: 'Tent', description: null, is_consumable: false, quantity: null, available: true, active: true, created_at: 1, photo_version: null }
const cases: { name: string; changes?: Partial<Item>; pending?: number; compact?: boolean; label: string; tone: string }[] = [
  { name: 'available reusable', label: 'Available', tone: 'available' },
  { name: 'inactive precedes pending, Lent out and Give', changes: { active: false, available: false, is_consumable: true, quantity: 0 }, pending: 2, label: 'Inactive', tone: 'muted' },
  { name: 'one ask precedes Lent out', changes: { available: false }, pending: 1, label: '1 ask waiting', tone: 'pending' },
  { name: 'plural asks precede Give stock', changes: { is_consumable: true, quantity: 0 }, pending: 2, label: '2 asks waiting', tone: 'pending' },
  { name: 'compact singular ask', pending: 1, compact: true, label: '1 ask', tone: 'pending' },
  { name: 'compact plural asks', pending: 2, compact: true, label: '2 asks', tone: 'pending' },
  { name: 'Lent out reusable', changes: { available: false }, label: 'Lent out', tone: 'muted' },
  { name: 'Lent out precedes Give stock', changes: { available: false, is_consumable: true, quantity: 7, available_quantity: 3 }, label: 'Lent out', tone: 'muted' },
  { name: 'zero Give retains quantity status', changes: { is_consumable: true, quantity: 0 }, label: 'Give · 0', tone: 'give' },
  { name: 'available Give quantity takes precedence', changes: { is_consumable: true, quantity: 7, available_quantity: 2 }, label: 'Give · 2', tone: 'give' },
  { name: 'zero available quantity does not fall back to total', changes: { is_consumable: true, quantity: 7, available_quantity: 0 }, label: 'Give · 0', tone: 'give' },
  { name: 'missing available quantity falls back to total', changes: { is_consumable: true, quantity: 7 }, label: 'Give · 7', tone: 'give' },
  { name: 'missing quantity falls back to zero', changes: { is_consumable: true, quantity: null }, label: 'Give · 0', tone: 'give' },
]

it.each(cases)('keeps current ThingStatus output for $name', ({ changes, pending, compact, label, tone }) => {
  const html = renderToStaticMarkup(createElement(ThingStatus, { item: { ...item, ...changes }, pending, compact }))
  expect(html).toBe(`<span class="cc-thing-status cc-thing-status-${tone}"><span aria-hidden="true"></span>${label}</span>`)
})
