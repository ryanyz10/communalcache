import { useEffect, useRef, useState } from 'react'
import { resizePhoto } from './photos'

export function usePhotoSelection() {
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')
  const operation = useRef(0)
  const objectUrl = useRef<string | null>(null)

  useEffect(() => () => {
    operation.current++
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
    objectUrl.current = null
  }, [])

  function clear() {
    operation.current++
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
    objectUrl.current = null
    setPhoto(null)
    setPreview(null)
    setProcessing(false)
    setError('')
  }

  async function select(file: File | null) {
    clear()
    if (!file) return
    const current = operation.current
    setProcessing(true)
    try {
      const resized = await resizePhoto(file)
      // A newer choice, dismissal or unmount must not restore an old preview.
      if (current !== operation.current) return
      objectUrl.current = URL.createObjectURL(resized)
      setPhoto(resized)
      setPreview(objectUrl.current)
    } catch (failure) {
      if (current === operation.current) setError((failure as Error).message)
    } finally {
      if (current === operation.current) setProcessing(false)
    }
  }

  return { photo, preview, processing, error, select, clear }
}
