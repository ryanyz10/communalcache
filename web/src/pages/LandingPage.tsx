import { useEffect } from 'react'
import { Link } from 'react-router'
import { BoxMark, PixelHorizon } from '../components/PixelArt'
import { landingCopy as copy } from '../lib/landingCopy'

const boxes = ['Street','Friends','Club','Neighbors','Building','Garden','Community'].map(name=>({id:name,name}))

export function LandingPage() {
  // Keep index.html's single title instead of hoisting a duplicate.
  useEffect(()=>{
    const previousTitle = document.title
    document.title = copy.title
    return ()=>{ document.title = previousTitle }
  },[])
  return <div className="cc-landing">
    <meta name="description" content={copy.description} />
    <div className="cc-landing-sky">
      <header className="cc-landing-header">
        <Link to="/" className="flex min-h-11 items-center gap-2.5 font-bold"><span className="cc-home-mark flex size-[38px] items-center justify-center rounded-xl"><BoxMark /></span>{copy.brand}</Link>
        <Link to="/login" className="cc-landing-secondary cc-landing-signin">{copy.signIn}</Link>
      </header>
      <main>
        <section className="cc-landing-hero" aria-labelledby="landing-heading">
          <h1 id="landing-heading">{copy.hero}</h1>
          <p>{copy.description}</p>
          <div className="flex flex-wrap gap-2.5">
            <Link to="/login" className="cc-landing-primary">{copy.getStarted}</Link>
            <Link to="/login?invite=1" className="cc-landing-secondary">{copy.invite}</Link>
          </div>
        </section>
        <div className="lg:hidden"><PixelHorizon kind="boxes" entries={boxes.slice(0,4)} /></div>
        <div className="hidden lg:block"><PixelHorizon kind="boxes" entries={boxes} /></div>
        <div className="cc-landing-content">
          <section className="cc-landing-how" aria-labelledby="landing-how-heading">
            <h2 id="landing-how-heading">{copy.howHeading}</h2>
            <ol className="grid gap-3 lg:grid-cols-3">{copy.steps.map((step,index)=><li key={step.title} className="cc-landing-step">
              <span className="cc-landing-number" aria-hidden="true">{index+1}</span>
              <h3>{step.title}</h3><p>{step.body}</p>
            </li>)}</ol>
          </section>
          <section className="cc-landing-community" aria-labelledby="landing-community-heading">
            <h2 id="landing-community-heading">{copy.communityHeading}</h2>
            <ul className="grid gap-2 lg:grid-cols-2">{copy.promises.map(promise=><li key={promise} className="flex items-center gap-2.5"><span aria-hidden="true" className="cc-landing-check">✓</span>{promise}</li>)}</ul>
          </section>
          <footer className="cc-landing-footer">
            <Link to="/login" className="cc-landing-primary">{copy.getStarted}</Link>
            <p>{copy.footer}</p>
          </footer>
        </div>
      </main>
    </div>
  </div>
}
