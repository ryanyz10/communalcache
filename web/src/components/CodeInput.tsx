import { useState, type SyntheticEvent } from 'react'

export function CodeInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [focused, setFocused] = useState(false)
  const [caret, setCaret] = useState(value.length)
  function selection(event: SyntheticEvent<HTMLInputElement>) {
    setCaret(event.currentTarget.selectionStart ?? value.length)
  }

  return <div>
    <label htmlFor="code" className="block text-sm font-medium">6-digit code</label>
    <div className="relative mt-2 h-[52px]">
      <div aria-hidden="true" className="pointer-events-none grid h-full grid-cols-6 gap-2">
        {Array.from({ length: 6 }, (_, index) => {
          const active = focused && index === Math.min(caret, 5)
          return <span
            key={index} data-code-box="" data-active={active ? 'true' : undefined}
            className={`flex min-w-0 items-center justify-center rounded-xl border bg-white font-mono text-[22px] font-semibold ${active ? 'border-blue-600 ring-1 ring-blue-600' : 'border-slate-300'}`}
          >{value[index] ?? ''}</span>
        })}
      </div>
      {/* One native field preserves paste, autofill and keyboard selection across all six boxes. */}
      <input
        id="code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required aria-describedby="code-help"
        value={value}
        onChange={event => { onChange(event.target.value); selection(event) }}
        onFocus={event => { setFocused(true); selection(event) }}
        onBlur={() => setFocused(false)} onSelect={selection}
        className="cc-code-input absolute inset-0 h-full w-full cursor-text rounded-xl border-0 bg-transparent p-0 text-transparent caret-transparent"
      />
    </div>
    <p id="code-help" className="mt-3 text-xs text-slate-600">Use the most recent code you requested. Codes expire in 5 minutes.</p>
  </div>
}
