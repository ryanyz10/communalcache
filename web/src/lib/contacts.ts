import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './api'

export type ContactKind = 'sms' | 'whatsapp' | 'signal' | 'messenger' | 'instagram' | 'email'
export type Contact = { kind: ContactKind; value: string; link: string }
export const platforms: Record<ContactKind, { name: string; label: string; placeholder: string; color: string }> = {
  sms: { name: 'Text', label: 'Phone number', placeholder: '+14155550148', color: '#34c759' },
  whatsapp: { name: 'WhatsApp', label: 'WhatsApp phone number', placeholder: '+14155550148', color: '#25d366' },
  signal: { name: 'Signal', label: 'Signal phone number', placeholder: '+14155550148', color: '#3a76f0' },
  messenger: { name: 'Messenger', label: 'Messenger username', placeholder: 'ryan.zhou', color: '#7a4dff' },
  instagram: { name: 'Instagram', label: 'Instagram username', placeholder: 'ryan.zhou', color: '#d62976' },
  email: { name: 'Email', label: 'Chosen contact email', placeholder: 'hello@example.com', color: '#8a6a52' },
}
export function contactAction(kind:ContactKind,name:string) {
  return kind==='sms'?`Text ${name}`:kind==='email'?`Email ${name}`:`Message ${name} on ${platforms[kind].name}`
}
export function contactOpenLabel(kind:ContactKind) { return kind==='sms'?'Open Messages':kind==='email'?'Open email':`Open ${platforms[kind].name}` }
export function contactDisplayValue(contact:Contact) {
  if(['sms','whatsapp','signal'].includes(contact.kind) && /^\+1\d{10}$/.test(contact.value))return `(${contact.value.slice(2,5)}) ${contact.value.slice(5,8)}-${contact.value.slice(8)}`
  return contact.value
}

export const contactKeys = {
  ownPrefix: () => ['own-contact'],
  own: (userId: string) => ['own-contact', userId],
  preview: (userId: string | undefined, kind: ContactKind, value: string) => ['contact-preview', userId, kind, value],
  requestPrefix: () => ['request-contact'],
  request: (callerId: string, requestId: string) => ['request-contact', callerId, requestId],
}
export const ownContactQuery = (userId: string) => ({ queryKey: contactKeys.own(userId), queryFn: () => apiFetch<{ contact: Contact | null }>('/api/me/contact') })
export const contactPreviewQuery = (userId: string | undefined, kind: ContactKind, value: string) => ({ queryKey: contactKeys.preview(userId, kind, value), queryFn: () => apiFetch<{ contact: Contact }>('/api/me/contact/preview', { body: { kind, value } }) })
export const requestContactQuery = (callerId: string, requestId: string) => ({ queryKey: contactKeys.request(callerId, requestId), queryFn: () => apiFetch<{ contact: Contact | null }>(`/api/me/requests/${requestId}/contact`) })

export function useOwnContact(userId: string) {
  return useQuery({ ...ownContactQuery(userId), enabled: !!userId })
}
