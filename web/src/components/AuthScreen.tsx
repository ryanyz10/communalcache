import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { BoxMark } from './Box'
import { Stamp } from './Stamp'

export function AuthScreen({ children, illustration, className = '' }: { children: ReactNode; illustration?: ReactNode; className?: string }) {
  return <main className={`cc-auth-page${illustration ? ' cc-auth-split' : ''} ${className}`}>
    {illustration && <section className="cc-auth-illustration" aria-hidden="true">{illustration}</section>}
    <div className="cc-auth-pane"><div className="cc-auth-form">{children}</div></div>
  </main>
}

export function AuthBrand({ className = '' }: { className?: string }) {
  return <Link to="/" aria-label="Home" className={`cc-auth-brand-link ${className}`}><BoxMark size={32} /><span>Communal Cache</span></Link>
}

export function SignInBox() {
  return <div className="cc-signin-box">
    <span className="cc-signin-handle"><BoxEyes /></span>
    <span className="cc-signin-up"><Stamp tone="muted">↑ THIS SIDE UP</Stamp></span>
    <span className="cc-signin-care"><Stamp tone="warn">HANDLE WITH CARE</Stamp></span>
    <div className="cc-signin-box-copy">
      <h1>Share more, buy less.</h1>
      <p>Borrow and lend with your neighbors. List what you're happy to share, ask in a tap, and hand it off in person.</p>
    </div>
  </div>
}

function BoxEyes() {
  return <svg viewBox="0 0 60 20" aria-hidden="true" focusable="false" className="cc-box-eyes">
    <ellipse cx="20" cy="10" rx="4.5" ry="5.5" fill="#f6a06b" />
    <ellipse cx="40" cy="10" rx="4.5" ry="5.5" fill="#f6a06b" />
    <ellipse cx="20" cy="10" rx="1.3" ry="4" fill="#201e1d" />
    <ellipse cx="40" cy="10" rx="1.3" ry="4" fill="#201e1d" />
  </svg>
}

export function BrandMark() {
  return <span aria-hidden="true" className="cc-auth-mark"><BoxMark size={32} /></span>
}
