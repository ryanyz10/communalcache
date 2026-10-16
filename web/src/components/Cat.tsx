import { createElement as h, type CSSProperties, type ReactNode, type SVGAttributes } from 'react'
import { catTraits } from '../lib/cats'

export function Cat({ userId, pose = 'sit', motion = true }: { userId: string; pose?: 'sit' | 'loaf' | 'peek'; motion?: boolean }) {
  const t = catTraits(userId), c = t.coat.fill, e = t.coat.eye, d = t.delay
  const WHITE = '#fffaf3', EDGE = 'rgba(32,30,29,.2)', STRIPE = 'rgba(32,30,29,.28)', LIGHT = '#ffc6a5', NOSE = '#8c491a'
  const an = (animation: string, base: CSSProperties = {}): CSSProperties => ({ ...base, ...(motion ? { animation } : {}) })
  const fb = (origin = 'center'): CSSProperties => ({ transformBox: 'fill-box', transformOrigin: origin })
  const blink = an(`cc-blink 5.5s ${d}s infinite`, fb())
  const svg = (viewBox: string, children: ReactNode[]) => h('svg', {
    viewBox, 'aria-hidden': true, focusable: false, className: `cc-cat cc-cat-${pose}`,
    'data-coat': t.coat.key, 'data-pattern': t.pattern,
    style: { display: 'block', width: '100%', height: 'auto', overflow: 'visible' },
  }, ...children)
  const [pA, pB] = t.coat.key === 'ginger' ? ['#474238', WHITE] : t.coat.key === 'dusk' ? ['#d67f48', WHITE] : ['#d67f48', '#474238']
  const W = (props: SVGAttributes<SVGElement>): SVGAttributes<SVGElement> => ({ fill: WHITE, stroke: EDGE, strokeWidth: .9, ...props })
  const flap = (path: string) => h('path', { d: path, fill: STRIPE })
  const stripe = (path: string) => h('path', { d: path, fill: 'none', stroke: STRIPE, strokeWidth: 2.2, strokeLinecap: 'round' })

  if (pose === 'peek') return svg('0 0 60 34', [h('g', { style: an(`cc-peek 7s ${d}s ease-in-out infinite`) },
    t.folded ? h('path', { d: 'M10 24 L14 9 L25 13 Z', fill: c }) : h('path', { d: 'M9 24 L12 4 Q13 1.5 15.5 3.5 L26 12 Z', fill: c }),
    t.folded ? flap('M14 9 L21 11 L18 14 Z') : null,
    t.folded ? h('path', { d: 'M50 24 L46 9 L35 13 Z', fill: c }) : h('path', { d: 'M51 24 L48 4 Q47 1.5 44.5 3.5 L34 12 Z', fill: c }),
    t.folded ? flap('M46 9 L39 11 L42 14 Z') : null,
    t.folded ? null : h('path', { d: 'M13.5 14 L14.5 7 L21 11.5 Z M46.5 14 L45.5 7 L39 11.5 Z', fill: LIGHT, opacity: .75 }),
    h('path', { d: 'M4 64 L4 40 C4 18 14 9 30 9 C46 9 56 18 56 40 L56 64 Z', fill: c }),
    t.pattern === 'Tabby' ? stripe('M26 12.5 l1 4 M30 11.5 l0 4.5 M34 12.5 l-1 4') : null,
    t.pattern === 'Calico' ? h('ellipse', { cx: 17, cy: 19, rx: 7, ry: 6, fill: pA }) : null,
    t.pattern === 'Calico' ? h('ellipse', pB === WHITE ? W({ cx: 45, cy: 31, rx: 6, ry: 5 }) : { cx: 45, cy: 31, rx: 6, ry: 5, fill: pB }) : null,
    t.pattern === 'Tuxedo' ? h('path', W({ d: 'M21 34 C21 27 25 25 30 25 C35 25 39 27 39 34 L39 40 L21 40 Z' })) : null,
    h('ellipse', { cx: 22, cy: 22, rx: 2.6, ry: 3.4, fill: e, style: blink }),
    h('ellipse', { cx: 38, cy: 22, rx: 2.6, ry: 3.4, fill: e, style: blink }),
    h('path', { d: 'M28 27 L32 27 L30 29.5 Z', fill: NOSE }))])

  if (pose === 'loaf') return svg('0 0 100 50', [
    h('g', { style: an(`cc-sway 3.6s ${d}s ease-in-out infinite`, fb('0% 100%')) },
      h('path', { d: 'M86 47 C99 47 99 31 88 31', fill: 'none', stroke: c, strokeWidth: 6, strokeLinecap: 'round' }),
      t.tip ? h('circle', W({ cx: 88, cy: 31, r: 3.2 })) : null),
    h('g', { style: an(`cc-breathe 4.2s ${d}s ease-in-out infinite`, fb('50% 100%')) },
      h('rect', { x: 20, y: 20, width: 70, height: 30, rx: 15, fill: c }),
      t.pattern === 'Tabby' ? stripe('M52 22 l2 6 M62 22 l2 6 M72 22 l2 6') : null,
      t.pattern === 'Calico' ? h('ellipse', { cx: 64, cy: 34, rx: 10, ry: 8, fill: pA }) : null,
      (t.pattern === 'Socks' || t.pattern === 'Tuxedo') ? h('path', W({ d: 'M40 50 a6 4 0 0 1 12 0 Z' })) : null,
      t.folded ? h('path', { d: 'M13 31 L15 13 L26 19 Z M28 19 L40 13 L41 31 Z', fill: c }) : h('path', { d: 'M13 31 L12 9 L26 19 Z M28 19 L42 9 L41 31 Z', fill: c }),
      t.folded ? flap('M15 13 L21 15 L18 18 Z M40 13 L34 15.5 L37 18.5 Z') : null,
      h('circle', { cx: 27, cy: 33, r: 16, fill: c }),
      t.pattern === 'Tuxedo' ? h('path', W({ d: 'M20 40 C20 35 23 34 27 34 C31 34 34 35 34 40 C34 46 31 49 27 49 C23 49 20 46 20 40 Z' })) : null,
      t.pattern === 'Calico' ? h('ellipse', pB === WHITE ? W({ cx: 19, cy: 25, rx: 6, ry: 5 }) : { cx: 19, cy: 25, rx: 6, ry: 5, fill: pB }) : null,
      h('path', { d: 'M18 33 q3.5 3 7 0 M29 33 q3.5 3 7 0', fill: 'none', stroke: e, strokeWidth: 1.8, strokeLinecap: 'round' }),
      h('path', { d: 'M25.5 38 L28.5 38 L27 40 Z', fill: NOSE })),
    h('text', { x: 46, y: 10, className: 'cc-cat-z', style: an(`cc-z 4s ${d}s ease-in-out infinite`, { font: '400 14px Caprasimo', fill: 'var(--cc-sub)', opacity: motion ? 0 : 1 }) }, 'z'),
    h('text', { x: 57, y: 0, className: 'cc-cat-z', style: an(`cc-z 4s ${d + 1.4}s ease-in-out infinite`, { font: '400 10px Caprasimo', fill: 'var(--cc-sub)', opacity: motion ? 0 : 1 }) }, 'z'),
  ])

  return svg('0 0 60 80', [
    h('g', { style: an(`cc-sway 3.2s ${d}s ease-in-out infinite`, fb('0% 100%')) },
      h('path', { d: 'M44 77 C60 77 62 58 52 52', fill: 'none', stroke: c, strokeWidth: 6, strokeLinecap: 'round' }),
      t.tip ? h('circle', W({ cx: 52, cy: 52, r: 3.2 })) : null),
    h('path', { d: 'M12 80 C9 58 16 40 30 40 C44 40 51 58 48 80 Z', fill: c }),
    t.pattern === 'Tabby' ? stripe('M14 60 q4 -1 6 2 M13 68 q4 -1 6 2 M46 60 q-4 -1 -6 2 M47 68 q-4 -1 -6 2') : null,
    t.pattern === 'Tuxedo' ? h('path', W({ d: 'M23 42 L37 42 C38 52 37 64 30 74 C23 64 22 52 23 42 Z' })) : null,
    t.pattern === 'Calico' ? h('ellipse', { cx: 40, cy: 63, rx: 7.5, ry: 10, fill: pA }) : null,
    t.pattern === 'Calico' ? h('ellipse', pB === WHITE ? W({ cx: 21, cy: 71, rx: 6, ry: 6 }) : { cx: 21, cy: 71, rx: 6, ry: 6, fill: pB }) : null,
    (t.pattern === 'Socks' || t.pattern === 'Tuxedo') ? h('path', W({ d: 'M17 80 a5 3.5 0 0 1 10 0 Z M33 80 a5 3.5 0 0 1 10 0 Z' })) : null,
    t.folded ? h('g', null, h('path', { d: 'M15 24 L18 11 L27 16 Z', fill: c }), flap('M18 11 L24 13.5 L21 16.5 Z')) : h('path', { d: 'M16 25 L17 7 L28 16 Z', fill: c, style: an(`cc-twitch 7s ${d}s ease-in-out infinite`, fb('50% 100%')) }),
    t.folded ? h('g', null, h('path', { d: 'M45 24 L42 11 L33 16 Z', fill: c }), flap('M42 11 L36 13.5 L39 16.5 Z')) : h('path', { d: 'M44 25 L43 7 L32 16 Z', fill: c }),
    h('circle', { cx: 30, cy: 28, r: 14, fill: c }),
    t.pattern === 'Tabby' ? stripe('M26 16.5 l1 3.5 M30 15.5 l0 4 M34 16.5 l-1 3.5') : null,
    t.pattern === 'Calico' ? h('ellipse', { cx: 22, cy: 21, rx: 6, ry: 5, fill: pB === WHITE ? pA : pB }) : null,
    t.pattern === 'Tuxedo' ? h('path', W({ d: 'M23.5 34 C23.5 30 26 29.5 30 29.5 C34 29.5 36.5 30 36.5 34 C36.5 38 34 42 30 42 C26 42 23.5 38 23.5 34 Z' })) : null,
    h('ellipse', { cx: 25, cy: 28, rx: 2.3, ry: 3, fill: e, style: blink }),
    h('ellipse', { cx: 35, cy: 28, rx: 2.3, ry: 3, fill: e, style: blink }),
    h('path', { d: 'M28.5 32.5 L31.5 32.5 L30 34.5 Z', fill: NOSE }),
  ])
}
