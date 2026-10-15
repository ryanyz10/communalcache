import type { ReactNode } from 'react'
import { BoxMark, PixelHorizon } from './PixelArt'

export function AuthScreen({ children }: { children: ReactNode }) {
  return <main className="cc-auth lg:grid lg:max-w-none lg:grid-cols-2 lg:bg-none lg:p-0">
    <section className="hidden lg:flex lg:min-h-dvh lg:flex-col lg:justify-between lg:gap-8 cc-auth-brand" aria-label="About Communal Cache">
      <div className="cc-auth-story lg:space-y-5"><BrandMark />
      <h2 className="lg:text-5xl lg:leading-[54px] lg:font-bold lg:tracking-[-.03em]">Share more,<br />buy less.</h2>
      <p className="lg:max-w-[420px] lg:text-lg lg:text-slate-600">Borrow and lend with your neighbors on Communal Cache.</p>
      <ul className="lg:mt-4 lg:space-y-3 lg:text-[15px]">
        <li><span aria-hidden="true">🧺</span> List what you're happy to lend</li>
        <li><span aria-hidden="true">🙋</span> Ask for something in one tap</li>
        <li><span aria-hidden="true">🤝</span> Hand it off in person</li>
      </ul></div>
      <PixelHorizon tall kind="boxes" entries={['Share','Borrow','Lend'].map(name=>({id:name,name}))} />
    </section>
    <div className="contents lg:flex lg:min-h-dvh lg:items-center lg:justify-center lg:bg-white lg:px-12 lg:py-16">
      <div className="contents lg:flex lg:w-full lg:max-w-[440px] lg:flex-col">{children}</div>
    </div>
  </main>
}

export function BrandMark() {
  return <div aria-hidden="true" className="cc-home-mark flex size-14 shrink-0 items-center justify-center rounded-2xl">
    <BoxMark px={3} />
  </div>
}

export function MailIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-[30px]" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>
}
