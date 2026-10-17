import { useEffect } from 'react'
import { Link } from 'react-router'
import { BoxMark } from '../components/Box'
import { LegalLinks } from '../components/LegalLinks'
import { legalCopy as copy } from '../lib/legalCopy'

type Section = { heading: string; paragraphs: readonly string[]; list?: readonly string[] }

export function LegalPage({ policy }: { policy: 'privacy' | 'terms' }) {
  const page = copy[policy]
  useEffect(() => {
    const previousTitle = document.title
    document.title = `${page.title} — ${copy.brand}`
    window.scrollTo(0, 0)
    return () => { document.title = previousTitle }
  }, [page.title])

  return <div className="cc-landing cc-legal">
    <header className="cc-landing-header">
      <Link to="/" className="cc-landing-brand"><BoxMark size={34} />{copy.brand}</Link>
    </header>
    <main className="cc-legal-content">
      <Link to="/" className="cc-legal-back">‹ {copy.back}</Link>
      <article aria-labelledby="legal-heading">
        <h1 id="legal-heading">{page.title}</h1>
        <p className="cc-legal-date">{copy.effectiveLabel}: <time dateTime={copy.effectiveDate}>{copy.effectiveDate}</time></p>
        <p className="cc-legal-intro">{page.introduction}</p>
        <p>{copy.operatedBy}</p>
        {page.sections.map((section: Section) => <section key={section.heading}>
          <h2>{section.heading}</h2>
          {section.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
          {section.list && <ul>{section.list.map(item => <li key={item}>{item}</li>)}</ul>}
        </section>)}
        <section>
          <h2>{copy.contactHeading}</h2>
          <p>{copy.contactIntro} <a href={`mailto:${copy.contact}`}>{copy.contact}</a>.</p>
        </section>
      </article>
    </main>
    <footer className="cc-landing-footer"><LegalLinks /></footer>
  </div>
}
