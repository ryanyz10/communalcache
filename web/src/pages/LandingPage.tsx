import { useEffect, type ReactNode } from 'react'
import { Link } from 'react-router'
import { BoxMark } from '../components/Box'
import { Cat } from '../components/Cat'
import { landingCopy as copy } from '../lib/landingCopy'
import { SupportLink } from '../components/Support'
import { LegalLinks } from '../components/LegalLinks'

export function LandingPage() {
  useEffect(() => {
    const previousTitle = document.title
    document.title = copy.title
    return () => { document.title = previousTitle }
  }, [])

  return <div className="cc-landing">
    <meta name="description" content={copy.description} />
    <header className="cc-landing-header">
      <Link to="/" className="cc-landing-brand"><BoxMark size={34} />{copy.brand}</Link>
      <Link to="/login" className="cc-landing-secondary cc-landing-signin">{copy.signIn}</Link>
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
        <section className="cc-landing-bottom" aria-labelledby="landing-bottom-heading">
          <div className="cc-landing-bottom-cats" aria-hidden="true">
            <span><Cat userId="footer-zara" pose="loaf" /></span><span><Cat userId="footer-arlo" /></span><span><Cat userId="footer-june" /></span>
          </div>
          <div className="cc-landing-bottom-box">
            <div><h2 id="landing-bottom-heading">{copy.bottomHeading}</h2><p>{copy.footer}</p></div>
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
