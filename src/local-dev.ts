export function localDevAuth(env: {LOCAL_DEV_AUTH?: string}, requestUrl?: string) {
  if (env.LOCAL_DEV_AUTH !== '1' || !requestUrl) return false
  try { return ['localhost','127.0.0.1','[::1]'].includes(new URL(requestUrl).hostname) }
  catch { return false }
}
