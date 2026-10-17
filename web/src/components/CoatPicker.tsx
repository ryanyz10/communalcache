import { useId } from 'react'
import { Cat } from './Cat'
import { catTraits, COATS, type CatCoat } from '../lib/cats'

export function CoatPicker({ userId, value, onChange, disabled = false, label = 'Your cat', names = false }: {
  userId: string
  value?: CatCoat | null
  onChange: (coat: CatCoat) => void
  disabled?: boolean
  label?: string
  names?: boolean
}) {
  const group = useId()
  const selectedCoat = catTraits(userId, value).coat
  return <fieldset disabled={disabled} className={`cc-coat-picker${names ? ' cc-coat-picker-names' : ''}`}>
    <legend>{label}</legend>
    <div className="cc-coat-options">
      {COATS.map(coat => <label key={coat.key} className="cc-coat-option">
        <input type="radio" name={group} value={coat.key} aria-label={coat.name} checked={selectedCoat === coat.key} onChange={() => onChange(coat.key)} />
        <span className="cc-coat-swatch" data-cat-backdrop={coat.key}><span><Cat userId={userId} coat={coat.key} pose="peek" /></span></span>
        {names && <span className="cc-coat-name">{coat.name}</span>}
      </label>)}
    </div>
  </fieldset>
}
