export const COATS = [
  { key: 'ginger', name: 'Ginger', fill: '#d67f48', eye: '#201e1d' },
  { key: 'grey', name: 'Grey', fill: '#82796a', eye: '#201e1d' },
  { key: 'dusk', name: 'Dusk', fill: '#474238', eye: '#ffc6a5' },
  { key: 'oat', name: 'Oat', fill: '#c0b6a5', eye: '#201e1d' },
  { key: 'ash', name: 'Ash', fill: '#a19786', eye: '#201e1d' },
  { key: 'toffee', name: 'Toffee', fill: '#b2622d', eye: '#201e1d' },
] as const
export const PATTERNS = ['Solid', 'Tabby', 'Tuxedo', 'Socks', 'Calico'] as const

export function catHash(id: string) {
  let hash = 2166136261
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function catTraits(id: string) {
  const hash = catHash(id)
  return {
    coat: COATS[hash % 6], pattern: PATTERNS[(hash >>> 3) % 5],
    folded: ((hash >>> 7) % 5) === 0, tip: ((hash >>> 10) % 3) === 0,
    delay: ((hash >>> 13) % 30) / 10,
  }
}
