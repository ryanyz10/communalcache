import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { BoxMark } from '../components/Box'
import { Cat } from '../components/Cat'
import { landingCopy as copy, SOURCE_CODE_URL } from '../lib/landingCopy'
import { SupportLink } from '../components/Support'
import { LegalLinks } from '../components/LegalLinks'
import { siteTitle } from '../lib/siteName'

export function LandingPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(0)
  useEffect(() => {
    const previousTitle = document.title
    document.title = siteTitle(copy.title)
    return () => { document.title = previousTitle }
  }, [])

  return <div className="cc-landing">
    <meta name="description" content={copy.description} />
    <header className="cc-landing-header">
      <Link to="/" className="cc-landing-brand"><BoxMark size={34} />{copy.brand}</Link>
      <div className="cc-landing-header-actions">
        <a href={SOURCE_CODE_URL} className="cc-landing-source" target="_blank" rel="noopener noreferrer">
          <svg width="22" height="22" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.65 7.65 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" /></svg>
          <span className="sr-only">{copy.sourceCode} {copy.opensNewTab}</span>
        </a>
        <Link to="/login" className="cc-landing-secondary cc-landing-signin">{copy.signIn}</Link>
      </div>
    </header>
    <main>
      <section className="cc-landing-hero" aria-labelledby="landing-heading">
        <h1 id="landing-heading">{copy.hero}</h1>
        <p>{copy.description}</p>
        <div className="cc-landing-actions">
          <Link to="/login" className="cc-landing-primary">{copy.getStarted}</Link>
          <Link to="/login?invite=1" className="cc-landing-secondary">{copy.invite}</Link>
        </div>
      </section>
      {/* These fictional people are fixed export artwork, never visitor data. */}
      <section className="cc-landing-shelf" aria-hidden="true">
        <div className="cc-landing-boxes">
          {copy.shelf.map(box => <div key={box.label} className={`cc-landing-box cc-landing-box-${box.key}`}>
            {!!box.cats.length && <div className="cc-landing-roof">
              {box.cats.map(cat => <span key={cat.id} style={{ width: cat.width }}><Cat userId={cat.id} pose={cat.pose} /></span>)}
            </div>}
            <div className="cc-landing-box-face">
              {box.key === 'neighbors' && <div className="cc-landing-handle">
                <svg viewBox="0 0 60 20" width="46">
                  <g className="cc-landing-eyes">
                    <ellipse cx="20" cy="10" rx="4.5" ry="5.5" fill="#f6a06b" />
                    <ellipse cx="40" cy="10" rx="4.5" ry="5.5" fill="#f6a06b" />
                    <ellipse cx="20" cy="10" rx="1.3" ry="4" fill="#201e1d" />
                    <ellipse cx="40" cy="10" rx="1.3" ry="4" fill="#201e1d" />
                  </g>
                </svg>
              </div>}
              <span>{box.label}</span>{box.key === 'neighbors' && <small>{copy.handleWithCare}</small>}
            </div>
          </div>)}
        </div>
        <div className="cc-landing-shelf-edge" /><div className="cc-landing-shelf-shadow" />
      </section>
      <div className="cc-landing-content">
        <section className="cc-landing-how" aria-labelledby="landing-how-heading">
          <h2 id="landing-how-heading">{copy.howHeading}</h2>
          <ol>{copy.steps.map((step, index) => {
            let illustration: ReactNode
            if (index === 0) {
              illustration = <div className="cc-landing-step-box"><span><Cat userId="step-one-hana" pose="peek" /></span><i /></div>
            } else if (index === 1) {
              illustration = <div className="cc-landing-step-item"><span><Cat userId="step-two-eli" pose="loaf" /></span><i>{copy.sampleItem}</i></div>
            } else {
              illustration = <div className="cc-landing-step-meet"><span><Cat userId="step-three-sol" /></span><span><Cat userId="step-three-bea" /></span></div>
            }
            return <li key={step.title} className="cc-landing-step">
              <div className="cc-landing-step-art" aria-hidden="true"><span className="cc-landing-number">{index + 1}</span>{illustration}</div>
              <h3>{step.title}</h3><p>{step.body}</p>
            </li>
          })}</ol>
        </section>
        <section className="cc-landing-community" aria-labelledby="landing-community-heading">
          <div><h2 id="landing-community-heading">{copy.communityHeading}</h2><p>{copy.communityDescription}</p></div>
          <div className="cc-landing-packing-slip">
            <div className="cc-landing-slip-header"><strong>{copy.packingSlip}</strong><span>{copy.contents}</span></div>
            <ul>{copy.promises.map(promise => <li key={promise}>
              <span aria-hidden="true" className="cc-landing-check">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              </span>
              {promise}
            </li>)}</ul>
          </div>
        </section>
        <section className="cc-landing-faq" aria-labelledby="landing-faq-heading">
          <div className="cc-landing-faq-intro">
            <h2 id="landing-faq-heading">{copy.faq.heading}</h2><p>{copy.faq.intro}</p>
          </div>
          <div className="cc-landing-faq-list">
            {copy.faq.items.map((item, index) => {
              const expanded = openFaq === index
              const questionId = `landing-faq-question-${index}`
              const answerId = `landing-faq-answer-${index}`
              return <div key={item.question} className="cc-landing-faq-box" style={{ zIndex: copy.faq.items.length - index }}>
                {index === 0 && <span className="cc-landing-faq-cat" aria-hidden="true"><Cat userId="faq-pip" pose="loaf" /></span>}
                <h3><button
                  type="button" id={questionId} aria-expanded={expanded} aria-controls={answerId}
                  onClick={() => setOpenFaq(current => current === index ? null : index)}
                >
                  <span>{item.question}</span>
                  <span className="cc-landing-faq-icon" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round"><path d="M5 12h14M12 5v14" /></svg></span>
                </button></h3>
                <div id={answerId} className="cc-landing-faq-answer" role="region" aria-labelledby={questionId} aria-hidden={!expanded} inert={!expanded}>
                  <div><p>{item.answer}</p></div>
                </div>
              </div>
            })}
          </div>
        </section>
        <section className="cc-landing-bottom" aria-labelledby="landing-bottom-heading">
          <div className="cc-landing-bottom-cats" aria-hidden="true">
            <span><Cat userId="footer-zara" pose="loaf" /></span><span><Cat userId="footer-arlo" /></span><span><Cat userId="footer-june" /></span>
          </div>
          <div className="cc-landing-bottom-box">
            <div><h2 id="landing-bottom-heading">{copy.bottomHeading}</h2></div>
            <Link to="/login" className="cc-landing-primary">{copy.getStarted}</Link>
          </div>
        </section>
      </div>
    </main>
    <footer className="cc-landing-footer">
      <span>{copy.brand}</span><p>{copy.support.description}</p>
      <SupportLink className="cc-landing-secondary">{copy.support.button}</SupportLink>
      <LegalLinks />
    </footer>
  </div>
}
