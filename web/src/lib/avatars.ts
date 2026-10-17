export function profilePhotoSrc(userId: string, version?: string | null) {
  return version ? `/api/users/${encodeURIComponent(userId)}/photo?v=${encodeURIComponent(version)}` : null
}
