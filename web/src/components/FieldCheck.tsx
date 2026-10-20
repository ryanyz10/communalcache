import type { TurnstileStatus } from './Turnstile'

export function FieldCheck({ status }: { status: TurnstileStatus }) {
  if (status === 'verified') return null
  return <span className={`cc-field-check cc-field-check-${status}`} aria-hidden="true">
    {status === 'checking'
      ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" opacity=".25" /><path d="M12 3a9 9 0 0 1 9 9" /></svg>
      : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3 10 18H2L12 3Z" /><path d="M12 9v4m0 4h.01" /></svg>}
  </span>
}
