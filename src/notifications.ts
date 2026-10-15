import {
  advanceNotificationCursor, claimOutbox, markOutboxSent, notificationCursor,
  notificationEmail, pushSubscriptions, recordOutboxFailure, recoverableOutbox, type OutboxRow,
} from './db'
import { sendPush } from './push'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
}

export function notificationContent(row: OutboxRow, appBaseUrl: string) {
  const data = JSON.parse(row.payload) as Record<string, unknown>
  const titles: Record<string, string> = {
    join_requested: 'A neighbor asked to join your cache', join_approved: 'Your join request was approved',
    join_rejected: 'Your join request was declined', request_created: 'A neighbor asked to use your item',
    request_approved: 'Your item request was approved', request_rejected: 'Your item request was declined',
    item_deleted: 'An item you requested was deleted', member_removed: 'A request was closed after a member left',
  }
  const subject = titles[row.kind]
  if (!subject || data.event !== row.kind || typeof data.recipient_id !== 'string' || !data.recipient_id || typeof data.cache_id !== 'string' || !uuid.test(data.cache_id) || typeof data.cache_name !== 'string') throw new Error('Invalid notification payload')
  const itemId = typeof data.item_id === 'string' && uuid.test(data.item_id) ? data.item_id : null
  const path = row.kind === 'request_rejected' && data.item_detached === true ? '/requests'
    : ['join_rejected', 'member_removed'].includes(row.kind) ? '/' : itemId && row.kind !== 'item_deleted' ? `/caches/${data.cache_id}/items/${itemId}` : `/caches/${data.cache_id}`
  const base = new URL(appBaseUrl)
  if (base.origin !== appBaseUrl || (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(base.hostname)))) throw new Error('Invalid app origin')
  const link = new URL(path, base).href
  const lines = [subject, `Cache: ${data.cache_name}`]
  if (typeof data.item_title === 'string') lines.push(`Item: ${data.item_title}`)
  if (typeof data.quantity === 'number') lines.push(`Quantity: ${data.quantity}`)
  if (typeof data.reason === 'string' && data.reason) lines.push(`Reason: ${data.reason}`)
  return {
    recipientId: data.recipient_id, subject, path, pushBody: lines.slice(1).join('\n'),
    text: `${lines.join('\n')}\n\nOpen Communal Cache: ${link}`,
    html: `${lines.map(line => `<p>${escapeHtml(line)}</p>`).join('')}<p><a href="${escapeHtml(link)}">Open Communal Cache</a></p>`,
  }
}

async function beforeDeadline<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort!: () => void
  const timeout = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason)
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  })
  try { return await Promise.race([work, timeout]) }
  finally { signal.removeEventListener('abort', abort) }
}

async function sendEmail(env: Env, content: ReturnType<typeof notificationContent>, signal: AbortSignal) {
  const email = await notificationEmail(env.DB, content.recipientId)
  signal.throwIfAborted()
  if (!email) throw new Error('Notification recipient unavailable')
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST', redirect: 'manual',
    signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [email], subject: content.subject, text: content.text, html: content.html }),
  })
  await response.body?.cancel()
  signal.throwIfAborted()
  if (!response.ok) throw new Error('Notification email unavailable')
}

async function sendNotification(env: Env, row: OutboxRow, signal: AbortSignal) {
  const content = notificationContent(row, env.APP_BASE_URL)
  const subscriptions = (await pushSubscriptions(env.DB, content.recipientId)).results
  signal.throwIfAborted()
  if (subscriptions.length > 3) throw new Error('Push subscription limit exceeded')
  let live = false, failed = false
  for (const subscription of subscriptions) {
    try {
      const result = await sendPush(env, subscription, { title: content.subject, body: content.pushBody, path: content.path }, signal)
      if (result === 'sent') live = true
    } catch {
      signal.throwIfAborted()
      failed = true
    }
  }
  // Email is structural fallback only: a transient/invalid push is never escalated to email.
  if (failed) throw new Error('Push delivery incomplete')
  if (!live) await sendEmail(env, content, signal)
}

export async function deliverNotification(env: Env, id: string): Promise<'ack' | 'retry'> {
  const deadline = AbortSignal.timeout(30_000)
  const token = crypto.randomUUID()
  const row = await beforeDeadline(claimOutbox(env.DB, id, token, Date.now()), deadline)
  if (!row) return 'ack'
  try { await beforeDeadline(sendNotification(env, row, deadline), deadline) }
  catch {
    const terminal = row.attempts >= 6
    const result = await recordOutboxFailure(env.DB, id, token, Date.now(), terminal)
    if (result.meta.changes > 0) console.warn(JSON.stringify({ event: 'notification_delivery_failed', outbox_id: id, attempts: row.attempts, terminal }))
    return terminal && result.meta.changes > 0 ? 'ack' : 'retry'
  }
  const result = await markOutboxSent(env.DB, id, token, Date.now())
  return result.meta.changes > 0 ? 'ack' : 'retry'
}

export async function consumeNotifications(batch: MessageBatch<unknown>, env: Env) {
  // ponytail: three rows with up to three browsers each leave room for D1 and provider binding calls.
  for (let index = 0; index < batch.messages.length; index++) {
    const message = batch.messages[index]
    if (typeof message.body !== 'string' || !uuid.test(message.body)) { message.ack(); continue }
    if (index >= 3) { message.retry({ delaySeconds: 60 }); continue }
    try {
      const result = await deliverNotification(env, message.body)
      if (result === 'ack') message.ack()
      else message.retry({ delaySeconds: 60 })
    } catch {
      console.error('Notification processing failed; durable outbox retained')
      message.retry({ delaySeconds: 60 })
    }
  }
}

export async function sweepNotifications(env: Env) {
  const cursor = await notificationCursor(env.DB)
  const page = (await recoverableOutbox(env.DB, cursor, Date.now())).results
  if (page.length) await env.NOTIFICATIONS.sendBatch(page.map(row => ({ body: row.id })))
  await advanceNotificationCursor(env.DB, cursor, page.length === 25 ? page.at(-1)!.id : null)
}
