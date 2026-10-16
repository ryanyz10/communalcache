export const CAT_COATS = ['ginger', 'grey', 'dusk', 'oat', 'ash', 'toffee'] as const
export type CatCoat = typeof CAT_COATS[number]

export function isCatCoat(value: unknown): value is CatCoat {
  return typeof value === 'string' && CAT_COATS.some(coat => coat === value)
}
