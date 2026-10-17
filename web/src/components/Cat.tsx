import { createElement, type CSSProperties, type ReactNode, type SVGAttributes } from 'react'
import { catTraits, COATS, type CatCoat, type CatTraits } from '../lib/cats'

type CatProps = (
  | { userId: string; coat?: CatCoat | null; traits?: never }
  | { traits: CatTraits; userId?: never; coat?: never }
) & {
  pose?: 'sit' | 'loaf' | 'peek'
  motion?: boolean
}

export function Cat({ userId, coat, traits, pose = 'sit', motion = true }: CatProps) {
  const appearance = traits ?? catTraits(userId!, coat)
  const coatColors = COATS.find(candidate => candidate.key === appearance.coat)!
  const coatFill = coatColors.fill
  const eyeFill = coatColors.eye
  const animationDelay = appearance.delay
  const hasFoldedEars = appearance.folded
  const hasWhiteTailTip = appearance.tip

  const whiteFur = '#fffaf3'
  const patchOutline = 'rgba(32,30,29,.2)'
  const patternInk = 'rgba(32,30,29,.28)'
  const innerEarFill = '#ffc6a5'
  const noseFill = '#8c491a'

  const motionStyle = (animation: string, base: CSSProperties = {}): CSSProperties => ({
    ...base,
    ...(motion ? { animation } : {}),
  })
  const transformStyle = (origin = 'center'): CSSProperties => ({
    transformBox: 'fill-box',
    transformOrigin: origin,
  })
  const blinkStyle = motionStyle(`cc-blink 5.5s ${animationDelay}s infinite`, transformStyle())
  const renderSvg = (viewBox: string, children: ReactNode[]) => createElement('svg', {
    viewBox,
    'aria-hidden': true,
    focusable: false,
    className: `cc-cat cc-cat-${pose}`,
    'data-coat': appearance.coat,
    'data-pattern': appearance.pattern,
    style: {
      display: 'block',
      width: '100%',
      height: 'auto',
      overflow: 'visible',
    },
  }, ...children)

  let primaryCalicoFill: string
  let secondaryCalicoFill: string
  if (appearance.coat === 'ginger') {
    primaryCalicoFill = '#474238'
    secondaryCalicoFill = whiteFur
  } else if (appearance.coat === 'dusk') {
    primaryCalicoFill = '#d67f48'
    secondaryCalicoFill = whiteFur
  } else {
    primaryCalicoFill = '#d67f48'
    secondaryCalicoFill = '#474238'
  }

  const whitePatchAttributes = (attributes: SVGAttributes<SVGElement>): SVGAttributes<SVGElement> => ({
    fill: whiteFur,
    stroke: patchOutline,
    strokeWidth: .9,
    ...attributes,
  })
  const earFold = (path: string) => createElement('path', {
    d: path,
    fill: patternInk,
  })
  const tabbyStripe = (path: string) => createElement('path', {
    d: path,
    fill: 'none',
    stroke: patternInk,
    strokeWidth: 2.2,
    strokeLinecap: 'round',
  })

  if (pose === 'peek') {
    const leftEar = createElement('path', {
      d: hasFoldedEars
        ? 'M10 24 L14 9 L25 13 Z'
        : 'M9 24 L12 4 Q13 1.5 15.5 3.5 L26 12 Z',
      fill: coatFill,
    })
    const leftEarFold = hasFoldedEars ? earFold('M14 9 L21 11 L18 14 Z') : null
    const rightEar = createElement('path', {
      d: hasFoldedEars
        ? 'M50 24 L46 9 L35 13 Z'
        : 'M51 24 L48 4 Q47 1.5 44.5 3.5 L34 12 Z',
      fill: coatFill,
    })
    const rightEarFold = hasFoldedEars ? earFold('M46 9 L39 11 L42 14 Z') : null
    const innerEars = hasFoldedEars ? null : createElement('path', {
      d: 'M13.5 14 L14.5 7 L21 11.5 Z M46.5 14 L45.5 7 L39 11.5 Z',
      fill: innerEarFill,
      opacity: .75,
    })
    const head = createElement('path', {
      d: 'M4 64 L4 40 C4 18 14 9 30 9 C46 9 56 18 56 40 L56 64 Z',
      fill: coatFill,
    })
    const foreheadStripes = appearance.pattern === 'Tabby'
      ? tabbyStripe('M26 12.5 l1 4 M30 11.5 l0 4.5 M34 12.5 l-1 4')
      : null
    const leftFacePatch = appearance.pattern === 'Calico' ? createElement('ellipse', {
      cx: 17,
      cy: 19,
      rx: 7,
      ry: 6,
      fill: primaryCalicoFill,
    }) : null
    const rightFacePatch = appearance.pattern === 'Calico' ? createElement('ellipse',
      secondaryCalicoFill === whiteFur
        ? whitePatchAttributes({ cx: 45, cy: 31, rx: 6, ry: 5 })
        : { cx: 45, cy: 31, rx: 6, ry: 5, fill: secondaryCalicoFill },
    ) : null
    const muzzle = appearance.pattern === 'Tuxedo' ? createElement('path', whitePatchAttributes({
      d: 'M21 34 C21 27 25 25 30 25 C35 25 39 27 39 34 L39 40 L21 40 Z',
    })) : null
    const leftEye = createElement('ellipse', {
      cx: 22,
      cy: 22,
      rx: 2.6,
      ry: 3.4,
      fill: eyeFill,
      style: blinkStyle,
    })
    const rightEye = createElement('ellipse', {
      cx: 38,
      cy: 22,
      rx: 2.6,
      ry: 3.4,
      fill: eyeFill,
      style: blinkStyle,
    })
    const nose = createElement('path', {
      d: 'M28 27 L32 27 L30 29.5 Z',
      fill: noseFill,
    })

    const peekingHead = createElement('g', {
      style: motionStyle(`cc-peek 7s ${animationDelay}s ease-in-out infinite`),
    },
    leftEar,
    leftEarFold,
    rightEar,
    rightEarFold,
    innerEars,
    head,
    foreheadStripes,
    leftFacePatch,
    rightFacePatch,
    muzzle,
    leftEye,
    rightEye,
    nose,
    )

    return renderSvg('0 0 60 34', [peekingHead])
  }

  if (pose === 'loaf') {
    const tailPath = createElement('path', {
      d: 'M86 47 C99 47 99 31 88 31',
      fill: 'none',
      stroke: coatFill,
      strokeWidth: 6,
      strokeLinecap: 'round',
    })
    const tailTip = hasWhiteTailTip
      ? createElement('circle', whitePatchAttributes({ cx: 88, cy: 31, r: 3.2 }))
      : null
    const tail = createElement('g', {
      style: motionStyle(`cc-sway 3.6s ${animationDelay}s ease-in-out infinite`, transformStyle('0% 100%')),
    }, tailPath, tailTip)
    const body = createElement('rect', {
      x: 20,
      y: 20,
      width: 70,
      height: 30,
      rx: 15,
      fill: coatFill,
    })
    const bodyStripes = appearance.pattern === 'Tabby'
      ? tabbyStripe('M52 22 l2 6 M62 22 l2 6 M72 22 l2 6')
      : null
    const bodyPatch = appearance.pattern === 'Calico' ? createElement('ellipse', {
      cx: 64,
      cy: 34,
      rx: 10,
      ry: 8,
      fill: primaryCalicoFill,
    }) : null
    const paws = appearance.pattern === 'Socks' || appearance.pattern === 'Tuxedo'
      ? createElement('path', whitePatchAttributes({ d: 'M40 50 a6 4 0 0 1 12 0 Z' }))
      : null
    const ears = createElement('path', {
      d: hasFoldedEars
        ? 'M13 31 L15 13 L26 19 Z M28 19 L40 13 L41 31 Z'
        : 'M13 31 L12 9 L26 19 Z M28 19 L42 9 L41 31 Z',
      fill: coatFill,
    })
    const earFolds = hasFoldedEars ? earFold('M15 13 L21 15 L18 18 Z M40 13 L34 15.5 L37 18.5 Z') : null
    const head = createElement('circle', {
      cx: 27,
      cy: 33,
      r: 16,
      fill: coatFill,
    })
    const muzzle = appearance.pattern === 'Tuxedo' ? createElement('path', whitePatchAttributes({
      d: 'M20 40 C20 35 23 34 27 34 C31 34 34 35 34 40 C34 46 31 49 27 49 C23 49 20 46 20 40 Z',
    })) : null
    const facePatch = appearance.pattern === 'Calico' ? createElement('ellipse',
      secondaryCalicoFill === whiteFur
        ? whitePatchAttributes({ cx: 19, cy: 25, rx: 6, ry: 5 })
        : { cx: 19, cy: 25, rx: 6, ry: 5, fill: secondaryCalicoFill },
    ) : null
    const sleepingEyes = createElement('path', {
      d: 'M18 33 q3.5 3 7 0 M29 33 q3.5 3 7 0',
      fill: 'none',
      stroke: eyeFill,
      strokeWidth: 1.8,
      strokeLinecap: 'round',
    })
    const nose = createElement('path', {
      d: 'M25.5 38 L28.5 38 L27 40 Z',
      fill: noseFill,
    })
    const breathingBody = createElement('g', {
      style: motionStyle(`cc-breathe 4.2s ${animationDelay}s ease-in-out infinite`, transformStyle('50% 100%')),
    },
    body,
    bodyStripes,
    bodyPatch,
    paws,
    ears,
    earFolds,
    head,
    muzzle,
    facePatch,
    sleepingEyes,
    nose,
    )
    const firstSleepMark = createElement('text', {
      x: 46,
      y: 10,
      className: 'cc-cat-z',
      style: motionStyle(`cc-z 4s ${animationDelay}s ease-in-out infinite`, {
        font: '400 14px Caprasimo',
        fill: 'var(--cc-sub)',
        opacity: motion ? 0 : 1,
      }),
    }, 'z')
    const secondSleepMark = createElement('text', {
      x: 57,
      y: 0,
      className: 'cc-cat-z',
      style: motionStyle(`cc-z 4s ${animationDelay + 1.4}s ease-in-out infinite`, {
        font: '400 10px Caprasimo',
        fill: 'var(--cc-sub)',
        opacity: motion ? 0 : 1,
      }),
    }, 'z')

    return renderSvg('0 0 100 50', [tail, breathingBody, firstSleepMark, secondSleepMark])
  }

  const tailPath = createElement('path', {
    d: 'M44 77 C60 77 62 58 52 52',
    fill: 'none',
    stroke: coatFill,
    strokeWidth: 6,
    strokeLinecap: 'round',
  })
  const tailTip = hasWhiteTailTip
    ? createElement('circle', whitePatchAttributes({ cx: 52, cy: 52, r: 3.2 }))
    : null
  const tail = createElement('g', {
    style: motionStyle(`cc-sway 3.2s ${animationDelay}s ease-in-out infinite`, transformStyle('0% 100%')),
  }, tailPath, tailTip)
  const body = createElement('path', {
    d: 'M12 80 C9 58 16 40 30 40 C44 40 51 58 48 80 Z',
    fill: coatFill,
  })
  const bodyStripes = appearance.pattern === 'Tabby'
    ? tabbyStripe('M14 60 q4 -1 6 2 M13 68 q4 -1 6 2 M46 60 q-4 -1 -6 2 M47 68 q-4 -1 -6 2')
    : null
  const bib = appearance.pattern === 'Tuxedo' ? createElement('path', whitePatchAttributes({
    d: 'M23 42 L37 42 C38 52 37 64 30 74 C23 64 22 52 23 42 Z',
  })) : null
  const bodyPatch = appearance.pattern === 'Calico' ? createElement('ellipse', {
    cx: 40,
    cy: 63,
    rx: 7.5,
    ry: 10,
    fill: primaryCalicoFill,
  }) : null
  const legPatch = appearance.pattern === 'Calico' ? createElement('ellipse',
    secondaryCalicoFill === whiteFur
      ? whitePatchAttributes({ cx: 21, cy: 71, rx: 6, ry: 6 })
      : { cx: 21, cy: 71, rx: 6, ry: 6, fill: secondaryCalicoFill },
  ) : null
  const paws = appearance.pattern === 'Socks' || appearance.pattern === 'Tuxedo'
    ? createElement('path', whitePatchAttributes({ d: 'M17 80 a5 3.5 0 0 1 10 0 Z M33 80 a5 3.5 0 0 1 10 0 Z' }))
    : null
  const leftEar = hasFoldedEars
    ? createElement('g', null,
      createElement('path', {
        d: 'M15 24 L18 11 L27 16 Z',
        fill: coatFill,
      }),
      earFold('M18 11 L24 13.5 L21 16.5 Z'),
    )
    : createElement('path', {
      d: 'M16 25 L17 7 L28 16 Z',
      fill: coatFill,
      style: motionStyle(`cc-twitch 7s ${animationDelay}s ease-in-out infinite`, transformStyle('50% 100%')),
    })
  const rightEar = hasFoldedEars
    ? createElement('g', null,
      createElement('path', {
        d: 'M45 24 L42 11 L33 16 Z',
        fill: coatFill,
      }),
      earFold('M42 11 L36 13.5 L39 16.5 Z'),
    )
    : createElement('path', {
      d: 'M44 25 L43 7 L32 16 Z',
      fill: coatFill,
    })
  const head = createElement('circle', {
    cx: 30,
    cy: 28,
    r: 14,
    fill: coatFill,
  })
  const foreheadStripes = appearance.pattern === 'Tabby'
    ? tabbyStripe('M26 16.5 l1 3.5 M30 15.5 l0 4 M34 16.5 l-1 3.5')
    : null
  const facePatch = appearance.pattern === 'Calico' ? createElement('ellipse', {
    cx: 22,
    cy: 21,
    rx: 6,
    ry: 5,
    fill: secondaryCalicoFill === whiteFur ? primaryCalicoFill : secondaryCalicoFill,
  }) : null
  const muzzle = appearance.pattern === 'Tuxedo' ? createElement('path', whitePatchAttributes({
    d: 'M23.5 34 C23.5 30 26 29.5 30 29.5 C34 29.5 36.5 30 36.5 34 C36.5 38 34 42 30 42 C26 42 23.5 38 23.5 34 Z',
  })) : null
  const leftEye = createElement('ellipse', {
    cx: 25,
    cy: 28,
    rx: 2.3,
    ry: 3,
    fill: eyeFill,
    style: blinkStyle,
  })
  const rightEye = createElement('ellipse', {
    cx: 35,
    cy: 28,
    rx: 2.3,
    ry: 3,
    fill: eyeFill,
    style: blinkStyle,
  })
  const nose = createElement('path', {
    d: 'M28.5 32.5 L31.5 32.5 L30 34.5 Z',
    fill: noseFill,
  })

  return renderSvg('0 0 60 80', [
    tail,
    body,
    bodyStripes,
    bib,
    bodyPatch,
    legPatch,
    paws,
    leftEar,
    rightEar,
    head,
    foreheadStripes,
    facePatch,
    muzzle,
    leftEye,
    rightEye,
    nose,
  ])
}
