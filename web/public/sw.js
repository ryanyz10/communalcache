function notificationPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f]/.test(value)) return '/'
  try {
    const url = new URL(value, self.location.origin)
    return url.origin === self.location.origin ? url.pathname + url.search + url.hash : '/'
  } catch { return '/' }
}

self.addEventListener('install', event => { event.waitUntil(self.skipWaiting()) })
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()) })

// No fetch handler: private API/photo responses never enter a service-worker cache.
self.addEventListener('push', event => {
  let data = {}
  try { data = event.data?.json() ?? {} } catch { /* A malformed payload still gets a visible notification. */ }
  if (!data || typeof data !== 'object') data = {}
  event.waitUntil((async () => {
    let matches = false
    try {
      const cache = await caches.open('communalcache-push-account')
      const account = await cache.match('/__push-account')
      const userId = await account?.text()
      if (typeof data.recipient_id === 'string' && data.recipient_id && data.recipient_id === userId) {
        // A stale tab must not turn an old cached identity into notification permission.
        const response = await fetch('/api/me', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(5000) })
        matches = response.ok && (await response.json()).id === userId
      }
    } catch { /* Missing identity, offline or failed checks always use generic text. */ }
    const title = matches && typeof data.title === 'string' ? data.title.slice(0, 120) : 'Communal Cache'
    const body = matches && typeof data.body === 'string' ? data.body.slice(0, 2000) : 'You have an update in Communal Cache'
    const path = matches ? notificationPath(data.path) : '/'
    await self.registration.showNotification(title, { body, icon: '/favicon.svg', data: { path } })
  })())
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const target = new URL(notificationPath(event.notification.data?.path), self.location.origin).href
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const existing = windows.find(client => client.url === target)
    if (existing) await existing.focus()
    else await self.clients.openWindow(target)
  })())
})
