import { useState } from 'react'
import { getPeekMode, motionAllowed, setPeekMode, type PeekMode } from '../lib/peek'

const OPTIONS: [PeekMode, string, string][] = [
  ['always', 'Every time', 'Plays every time you open a cache on this device.'],
  ['first', 'First time only', 'Plays the first time you open each cache on this device.'],
  ['never', 'Never', 'Caches open without the animation.'],
]

export function PeekControls() {
  const [mode, setMode] = useState(getPeekMode)
  return <section className="cc-account-push cc-account-peek" aria-labelledby="peek-heading">
    <h2 id="peek-heading">Cache opening animation</h2>
    <p id="peek-help">{OPTIONS.find(([value]) => value === mode)![2]}</p>
    <div className="cc-peek-seg" role="radiogroup" aria-labelledby="peek-heading" aria-describedby="peek-help">
      {OPTIONS.map(([value, label]) => <label key={value}>
        <input type="radio" name="peek-mode" value={value} checked={mode === value} onChange={() => { setPeekMode(value); setMode(value) }} />
        <span>{label}</span>
      </label>)}
    </div>
    {!motionAllowed() && <p className="mt-3">Reduced motion is on for this device, so the animation never plays.</p>}
  </section>
}
