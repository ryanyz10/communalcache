export function NamePreview({ name }: { name: string }) {
  const preview = name.trim()
  return <div className="text-center" aria-live="polite" aria-atomic="true">
    <div aria-hidden="true" className="mx-auto flex size-[72px] items-center justify-center rounded-full bg-slate-900 text-3xl font-bold text-white">{Array.from(preview)[0]?.toUpperCase() ?? '?'}</div>
    <p className="mt-2 break-words font-semibold">{preview || 'Your name'}</p>
    <p className="text-sm text-slate-600">How you'll appear to neighbors</p>
  </div>
}
