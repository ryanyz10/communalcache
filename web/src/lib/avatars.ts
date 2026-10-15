export function initials(name: string) {
  return name.trim().split(/\s+/).slice(0,2).map(word=>Array.from(word)[0] ?? '').join('').toUpperCase() || '?'
}

export function profilePhotoSrc(userId: string, version?: string | null) {
  return version ? `/api/users/${encodeURIComponent(userId)}/photo?v=${encodeURIComponent(version)}` : null
}
