import { Link } from 'react-router'
import { legalCopy } from '../lib/legalCopy'

export function LegalLinks() {
  return <nav className="cc-legal-links" aria-label={legalCopy.navigation}>
    <Link to="/privacy">{legalCopy.privacy.title}</Link>
    <Link to="/terms">{legalCopy.terms.title}</Link>
  </nav>
}
