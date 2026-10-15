import type { ReactNode } from 'react'

export function AuthScreen({ children }: { children: ReactNode }) {
  return <main className="cc-auth lg:grid lg:max-w-none lg:grid-cols-2 lg:bg-none lg:p-0">
    <section className="hidden lg:flex lg:min-h-dvh lg:flex-col lg:justify-center lg:gap-5 lg:bg-[radial-gradient(120%_80%_at_0%_0%,#c7d2fe_0%,#e0e7ff_35%,#f1f5f9_100%)] lg:p-16" aria-label="About Communal Cache">
      <BrandMark />
      <h2 className="lg:text-5xl lg:leading-[54px] lg:font-bold lg:tracking-[-.03em]">Share more,<br />buy less.</h2>
      <p className="lg:max-w-[420px] lg:text-lg lg:text-slate-600">Borrow and lend with your neighbors on Communal Cache.</p>
      <ul className="lg:mt-4 lg:space-y-3 lg:text-[15px]">
        <li><span aria-hidden="true">🧺</span> List what you're happy to lend</li>
        <li><span aria-hidden="true">🙋</span> Ask for something in one tap</li>
        <li><span aria-hidden="true">🤝</span> Hand it off in person</li>
      </ul>
    </section>
    <div className="contents lg:flex lg:min-h-dvh lg:items-center lg:justify-center lg:bg-white lg:px-12 lg:py-16">
      <div className="contents lg:flex lg:w-full lg:max-w-[400px] lg:flex-col">{children}</div>
    </div>
  </main>
}

export function BrandMark() {
  return <div aria-hidden="true" className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-slate-900 shadow-[0_6px_16px_rgb(15_23_42/25%)]">
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true"><path d="M3 9.5 12 4l9 5.5v9.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" /><path d="M8 20v-6h8v6M8 14h8" /></svg>
  </div>
}

export function MailIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-[30px]" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>
}
