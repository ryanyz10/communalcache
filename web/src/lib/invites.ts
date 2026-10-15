export async function shareInvite(url: string) {
  if (typeof navigator.share === 'function') {
    try { await navigator.share({ url }); return 'Invite shared.' }
    catch (error) { if (error instanceof Error && error.name === 'AbortError') return 'Sharing cancelled.' }
  }
  await navigator.clipboard.writeText(url)
  return 'Invite copied.'
}
