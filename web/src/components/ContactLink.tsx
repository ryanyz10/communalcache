import { platforms, type Contact, type ContactKind } from '../lib/contacts'

export function PlatformIcon({ kind }: { kind: ContactKind }) {
  const glyph = {
    sms: <path d="M5 6h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-8l-4 3v-3H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" fill="white" />,
    whatsapp: <>
      <circle cx="12" cy="12" r="7" fill="none" stroke="white" strokeWidth="2" />
      <path d="m6 19 1.5-4M9 9c1 3 3 5 6 6l1-2-2-1-1 1-2-2 1-1-1-2z" stroke="white" fill="white" />
    </>,
    signal: <>
      <circle cx="12" cy="12" r="8" fill="none" stroke="white" strokeWidth="2" strokeDasharray="3 2" />
      <circle cx="12" cy="12" r="5" fill="white" />
    </>,
    messenger: <>
      <path d="M12 4a8 8 0 0 0-5 14v3l3-2h2a8 8 0 1 0 0-15" fill="white" />
      <path d="m7 14 4-5 2 3 4-2-4 5-2-3z" fill="#7a4dff" />
    </>,
    instagram: <>
      <rect x="5" y="5" width="14" height="14" rx="4" fill="none" stroke="white" strokeWidth="2" />
      <circle cx="12" cy="12" r="3" fill="none" stroke="white" strokeWidth="2" />
      <circle cx="16" cy="8" r="1" fill="white" />
    </>,
    email: <>
      <rect x="4" y="6" width="16" height="12" rx="2" fill="none" stroke="white" strokeWidth="2" />
      <path d="m4 7 8 6 8-6" fill="none" stroke="white" strokeWidth="2" />
    </>,
  }[kind]
  return <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" className="shrink-0 rounded-md" style={{ background: platforms[kind].color }}>{glyph}</svg>
}

export function ContactLink({ contact, name }: { contact: Contact; name: string }) {
  const external = contact.link.startsWith('https://')
  return <a href={contact.link} target={external ? '_blank' : undefined} rel={external ? 'noopener' : undefined} className="mt-3 flex min-h-11 items-center gap-3 rounded-lg border border-slate-300 p-3">
    <PlatformIcon kind={contact.kind} />
    <span className="min-w-0">
      <span className="block font-semibold">Message {name} on {platforms[contact.kind].name}</span>
      <span className="block break-all text-sm text-slate-600">{contact.link}</span>
    </span>
  </a>
}
