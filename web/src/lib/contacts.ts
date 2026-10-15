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
export function useOwnContact(userId: string) {
  return useQuery({ queryKey: ['own-contact',userId], queryFn: () => apiFetch<{contact:Contact|null}>('/api/me/contact'), enabled: !!userId })
}
