import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch, errorMessage } from '../lib/api'
import type { Item } from '../lib/items'
import { PHOTO_READ_ERROR, resizePhoto, uploadPhoto } from '../lib/photos'
import { invalidateRequestViews } from '../lib/requests'

export function ItemForm({ cacheId, item, onSaved, onCancel, onBusy }: { cacheId: string | null; item?: Item; onSaved: (item: Item) => void; onCancel: () => void; onBusy?: (busy: boolean) => void }) {
  const client = useQueryClient()
  const [title, setTitle] = useState(item?.title ?? '')
  const [description, setDescription] = useState(item?.description ?? '')
  const [consumable, setConsumable] = useState(item?.is_consumable ?? false)
  const [quantity, setQuantity] = useState(String(item?.quantity ?? 1))
  const [file, setFile] = useState<File | null>(null)
  const [saved, setSaved] = useState<Item | null>(null)
  const save = useMutation({
    mutationFn: async () => {
      const photo = file ? await resizePhoto(file) : null
      const persisted = saved ?? await apiFetch<Item>(`${cacheId ? `/api/caches/${cacheId}/items` : '/api/me/items'}${item ? `/${item.id}` : ''}`, {
        method: item ? 'PATCH' : 'POST',
        body: { title, description: description.trim() || null, quantity: consumable ? Number(quantity) : null, ...(!item ? { is_consumable: consumable } : {}) },
      })
      setSaved(persisted)
      // Keep the created item on photo failure; retry uploads, never create it again.
      return photo ? uploadPhoto(null, persisted.id, photo) : persisted
    },
    onSuccess: persisted => onSaved(persisted),
    onSettled: async () => { onBusy?.(false); await invalidateRequestViews(client) },
  })
  function submit(event: FormEvent) { event.preventDefault(); onBusy?.(true); save.mutate() }
  const locked = save.isPending || !!saved
  return <form className="mt-4 space-y-4 lg:max-w-[640px]" onSubmit={submit}>
    <fieldset disabled={locked} className="space-y-4">
      {!item && <div><label htmlFor="new-item-photo" className="block text-sm font-medium">Photo (optional)</label><input id="new-item-photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={event => setFile(event.target.files?.[0] ?? null)} className="mt-1 block w-full rounded-md border border-slate-300 p-2" /><p className="mt-1 text-sm text-slate-600">JPEG, PNG or WebP. Resized before upload.</p></div>}
      <div><label htmlFor="item-title" className="block text-sm font-medium">Name</label><input autoFocus id="item-title" type="text" required maxLength={120} value={title} onChange={event => setTitle(event.target.value)} className="cc-input" /></div>
      {item ? <p className="text-sm text-slate-600">{consumable ? 'Give some away' : 'Lend it'} · Item type cannot be changed.</p> : <fieldset><legend className="text-sm font-medium">How would you like to share it?</legend><div className="mt-2 flex flex-wrap gap-4"><label className="flex min-h-11 items-center gap-2"><input type="radio" name="item-type" checked={!consumable} onChange={() => setConsumable(false)} />Lend it</label><label className="flex min-h-11 items-center gap-2"><input type="radio" name="item-type" checked={consumable} onChange={() => setConsumable(true)} />Give some away</label></div></fieldset>}
      {consumable && <div><label htmlFor="item-quantity" className="block text-sm font-medium">Stock quantity</label><input id="item-quantity" type="number" inputMode="numeric" required min={0} max={9999} step={1} value={quantity} onChange={event => setQuantity(event.target.value)} aria-describedby="quantity-help" className="cc-input" /><p id="quantity-help" className="mt-1 text-sm text-slate-600">0–9999. One stock count across all caches; pending requests must stay covered.</p></div>}
      <div><label htmlFor="item-description" className="block text-sm font-medium">Description (optional)</label><textarea id="item-description" rows={3} maxLength={2000} value={description} onChange={event => setDescription(event.target.value)} className="cc-input" /></div>
    </fieldset>
    {saved && save.isError && <p role="status">Your item is saved{cacheId ? ' and shared here' : ' in your library'}. Only the photo needs retrying.</p>}
    {save.isError && <p role="alert" className="text-red-700">{save.error instanceof Error && save.error.message === PHOTO_READ_ERROR ? PHOTO_READ_ERROR : errorMessage(save.error)}</p>}
    <div className="flex flex-wrap items-center gap-3">
      <button type="submit" disabled={save.isPending || !title.trim()} className="cc-pill">{save.isPending ? 'Saving…' : saved ? 'Retry photo' : item ? 'Save item' : cacheId ? 'Create and add here' : 'Create item'}</button>
      {saved ? <button type="button" disabled={save.isPending} onClick={() => onSaved(saved)} className="cc-outline">Continue without photo</button> : <button type="button" disabled={save.isPending} onClick={onCancel} className="cc-outline">Cancel</button>}
    </div>
  </form>
}
