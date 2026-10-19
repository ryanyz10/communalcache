const routes = [
  '/', '/login', '/privacy', '/terms', '/account', '/auth/link', '/admin',
  '/items', '/items/new', '/items/:id', '/items/:id/edit',
  '/requests', '/requests/:id', '/join/:token',
  '/caches/:id', '/caches/:id/settings', '/caches/:id/items/new',
  '/caches/:id/items/:id', '/caches/:id/items/:id/edit',
  '/api', '/api/healthz', '/api/config', '/api/me', '/api/me/summary',
  '/api/auth/email-otp/send-verification-otp', '/api/auth/sign-in/email-otp',
  '/api/auth/sign-in/magic-link', '/api/auth/sign-in/social', '/api/auth/callback/google',
  '/api/auth/magic-link/verify', '/api/auth/get-session', '/api/auth/sign-out',
  '/api/push/subscribe', '/api/me/photo', '/api/users/:id/photo',
  '/api/me/contact', '/api/me/contact/preview',
  '/api/me/items', '/api/me/items/:id', '/api/me/items/:id/photo', '/api/me/items/:id/attachments/:id',
  '/api/requests', '/api/me/requests/:id', '/api/me/requests/:id/contact',
  '/api/me/requests/:id/approve', '/api/me/requests/:id/reject',
  '/api/caches', '/api/caches/:id', '/api/caches/:id/invite/rotate', '/api/caches/:id/invite/preview',
  '/api/caches/:id/leave', '/api/caches/:id/join', '/api/caches/:id/join-requests',
  '/api/caches/:id/join-requests/:id/approve', '/api/caches/:id/join-requests/:id/reject',
  '/api/caches/:id/members/:id', '/api/caches/:id/items', '/api/caches/:id/items/:id',
  '/api/caches/:id/items/:id/photo', '/api/caches/:id/items/:id/requests',
  '/api/caches/:id/requests/:id/approve', '/api/caches/:id/requests/:id/reject',
  '/api/admin', '/api/admin/overview', '/api/admin/caches', '/api/admin/users', '/api/admin/failed-outbox',
  '/api/admin/flags', '/api/admin/flags/google_sign_in', '/api/admin/caches/:id/plan', '/api/admin/users/:id/plan',
]
const patterns = routes.map(route => ({ route, pattern: new RegExp(`^${route.replace(/:[a-z]+/g, '[^/]+')}/?$`, 'i') }))

export function logRoute(url: string) {
  let path: string
  try { path = new URL(url).pathname }
  catch { return '/*' }
  // Only emit fixed labels: unknown paths may themselves contain credentials or names.
  const match = patterns.find(({ pattern }) => pattern.test(path))
  if (match) return match.route
  if (path === '/api' || path.startsWith('/api/')) return '/api/*'
  if (path.startsWith('/join/')) return '/join/*'
  if (path.startsWith('/admin/')) return '/admin/*'
  return '/*'
}

export function logMethod(method: string) {
  return ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(method) ? method : 'OTHER'
}
