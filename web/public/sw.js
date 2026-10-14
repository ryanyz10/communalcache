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
  const title = typeof data.title === 'string' ? data.title.slice(0, 120) : 'Communal Cache'
  const body = typeof data.body === 'string' ? data.body.slice(0, 2000) : 'Open Communal Cache to see what changed.'
  event.waitUntil(self.registration.showNotification(title, { body, icon: '/favicon.svg', data: { path: notificationPath(data.path) } }))
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
