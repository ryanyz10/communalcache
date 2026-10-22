import { expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { adminOverviewQuery, adminCachesQuery, adminUsersQuery, adminOutboxQuery, adminFlagsQuery } from './admin'
import { cacheListQuery, cacheDetailQuery, cacheItemsQuery, homeSummaryQuery, invalidateCacheViews } from './caches'
import { configQuery } from './config'
import { ownContactQuery, contactPreviewQuery, requestContactQuery } from './contacts'
import { cacheItemQuery, libraryItemQuery, libraryQuery } from './items'
import { invitePreviewQuery, joinRequestsQuery } from './joining'
import { meQuery, refreshProfileViews } from './profile'
import { itemRequestsQuery, requestDetailQuery, requestsQuery, invalidateRequestViews } from './requests'

// Literal keys from before centralization, including disabled, null and paginated variants.
it.each([
  ['cache list', ['caches'], cacheListQuery()],
  ['cache detail', ['cache', 'c'], cacheDetailQuery('c')],
  ['disabled cache detail', ['cache', undefined], cacheDetailQuery(undefined)],
  ['cache contents', ['items', 'c'], cacheItemsQuery('c')],
  ['home summary', ['home-summary'], homeSummaryQuery()],
  ['cache item', ['item', 'c', 'i'], cacheItemQuery('c', 'i')],
  ['disabled cache item', ['item', undefined, 'i'], cacheItemQuery(undefined, 'i')],
  ['unattached item', ['item', null, 'i'], cacheItemQuery(null, 'i')],
  ['library item', ['library-item', 'u', 'i'], libraryItemQuery('u', 'i')],
  ['disabled library item', ['library-item', undefined, ''], libraryItemQuery(undefined, '')],
  ['library', ['library', 'u'], libraryQuery('u')],
  ['disabled library', ['library', undefined], libraryQuery(undefined)],
  ['requests', ['requests'], requestsQuery()],
  ['incoming', ['requests', 'incoming'], requestsQuery('incoming')],
  ['item incoming', ['requests', 'incoming', 'i'], requestsQuery('incoming', 'i')],
  ['ignored item without view', ['requests'], requestsQuery(undefined, 'i')],
  ['cache item requests', ['item-requests', 'c', 'i'], itemRequestsQuery('c', 'i')],
  ['unattached item requests', ['item-requests', null, 'i'], itemRequestsQuery(null, 'i')],
  ['request detail', ['request-detail', 'u', 'r'], requestDetailQuery('u', 'r')],
  ['invite preview', ['invite-preview', 'u', 'token'], invitePreviewQuery('u', 'token')],
  ['signed-out invite', ['invite-preview', undefined, ''], invitePreviewQuery(undefined, '')],
  ['join requests', ['join-requests', 'c'], joinRequestsQuery('c')],
  ['own contact', ['own-contact', 'u'], ownContactQuery('u')],
  ['disabled own contact', ['own-contact', ''], ownContactQuery('')],
  ['contact preview', ['contact-preview', 'u', 'email', 'chosen@example.test'], contactPreviewQuery('u', 'email', 'chosen@example.test')],
  ['disabled contact preview', ['contact-preview', undefined, 'sms', ''], contactPreviewQuery(undefined, 'sms', '')],
  ['request contact', ['request-contact', 'u', 'r'], requestContactQuery('u', 'r')],
  ['config', ['config'], configQuery()],
  ['me', ['me'], meQuery(async () => {})],
  ['admin overview', ['admin', 'u', 'overview'], adminOverviewQuery('u')],
  ['disabled admin', ['admin', undefined, 'overview'], adminOverviewQuery(undefined)],
  ['admin caches', ['admin', 'u', 'caches', null], adminCachesQuery('u', null)],
  ['admin caches cursor', ['admin', 'u', 'caches', 'a/b'], adminCachesQuery('u', 'a/b')],
  ['admin users', ['admin', 'u', 'users', null], adminUsersQuery('u', null)],
  ['admin users cursor', ['admin', 'u', 'users', 'next'], adminUsersQuery('u', 'next')],
  ['admin outbox', ['admin', 'u', 'failed-outbox', null], adminOutboxQuery('u', null)],
  ['admin outbox cursor', ['admin', 'u', 'failed-outbox', 'next'], adminOutboxQuery('u', 'next')],
  ['admin flags', ['admin', 'u', 'flags'], adminFlagsQuery('u')],
])('%s keeps its original key', (_name, literal, options) => {
  expect(options.queryKey).toStrictEqual(literal)
  expect(options.queryFn).toBeTypeOf('function')
})

const requestPrefixes = ['item-requests', 'requests', 'item', 'items', 'library', 'library-item', 'home-summary', 'caches', 'cache', 'request-detail', 'request-contact'].map(key => [key])
it.each([
  ['cache settings/member removal', (client: QueryClient) => invalidateCacheViews(client, 'c'), [['cache', 'c'], ['caches']]],
  ['request/item mutations', invalidateRequestViews, requestPrefixes],
  ['profile mutations', refreshProfileViews, [['me'], ['cache'], ['join-requests'], ...requestPrefixes]],
] as const)('%s keeps the original invalidation sequence', async (_name, refresh, expected) => {
  const client = new QueryClient()
  const calls: unknown[] = []
  client.invalidateQueries = async filters => { calls.push(filters?.queryKey) }
  await refresh(client)
  expect(calls).toStrictEqual(expected)
  client.clear()
})
