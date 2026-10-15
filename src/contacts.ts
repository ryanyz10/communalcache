import { HttpError } from './http'

export type ContactKind = 'sms' | 'whatsapp' | 'signal' | 'messenger' | 'instagram' | 'email'
export type Contact = { kind: ContactKind; value: string; link: string }

export function contactInput(body: Record<string, unknown>): Contact {
  const { kind } = body
  if (typeof body.value !== 'string' || body.value.length > 254 || /[\x00-\x1f\x7f]/.test(body.value)) throw new HttpError(400, 'invalid_contact')
  const value = body.value.trim()
  if (kind === 'sms' || kind === 'whatsapp' || kind === 'signal') {
    if (!/^\+?[0-9]{7,15}$/.test(value)) throw new HttpError(400, 'invalid_contact')
    const digits = value.replace(/^\+/, '')
    const link = kind === 'sms' ? `sms:+${digits}` : kind === 'whatsapp' ? `https://wa.me/${digits}` : `https://signal.me/#p/+${digits}`
    return { kind, value: `+${digits}`, link }
  }
  if (kind === 'messenger' || kind === 'instagram') {
    const valid = kind === 'messenger' ? /^[A-Za-z0-9.]{5,50}$/.test(value) : /^[A-Za-z0-9._]{1,30}$/.test(value)
    if (!valid || value.startsWith('.') || value.endsWith('.') || value.includes('..')) throw new HttpError(400, 'invalid_contact')
    return { kind, value, link: `https://${kind === 'messenger' ? 'm.me' : 'instagram.com'}/${value}` }
  }
  if (kind === 'email') {
    // Deliberately simple ASCII address, excluding mailto parameters and header escapes.
    const parts = value.split('@'), local = parts[0], domain = parts[1]
    if (parts.length !== 2 || !/^[A-Za-z0-9._+\-]{1,64}$/.test(local) || local.startsWith('.') || local.endsWith('.') || local.includes('..') || !domain || domain.length > 189 || !domain.includes('.') || domain.split('.').some(label => !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label))) throw new HttpError(400, 'invalid_contact')
    return { kind, value, link: `mailto:${encodeURIComponent(local)}@${domain}` }
  }
  throw new HttpError(400, 'invalid_contact')
}
