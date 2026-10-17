import { afterEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { PHOTO_READ_ERROR } from './photos'
import type { usePhotoSelection } from './usePhotoSelection'
import { PhotoPreview } from '../components/PhotoPreview'

const cleanups: (() => void)[] = []
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); vi.restoreAllMocks() })

function fixture() {
  const states: unknown[] = [], refs: { current: unknown }[] = []
  let stateIndex = 0, refIndex = 0, mounted = false, cleanup: (() => void) | undefined
  const resized = new Blob(['resized JPEG'], { type: 'image/jpeg' })
  const resizePhoto = vi.fn(async (_file: File) => resized)
  let urlIndex = 0
  const createUrl = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:preview-' + ++urlIndex)
  const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const react = {
    useState(initial: unknown) {
      const index = stateIndex++
      if (!(index in states)) states[index] = initial
      return [states[index], (value: unknown) => { states[index] = value }]
    },
    useRef(initial: unknown) { const index = refIndex++; return refs[index] ?? (refs[index] = { current: initial }) },
    useEffect(effect: () => () => void) { if (!mounted) { mounted = true; cleanup = effect() } },
  }
  const source = readFileSync(new URL('./usePhotoSelection.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} as { usePhotoSelection: typeof usePhotoSelection } }
  new Function('require', 'module', 'exports', compiled)((name: string) => name === 'react' ? react : { resizePhoto }, module, module.exports)
  const render = () => { stateIndex = 0; refIndex = 0; return module.exports.usePhotoSelection() }
  render()
  const unmount = () => cleanup?.()
  cleanups.push(unmount)
  return { render, unmount, resizePhoto, resized, createUrl, revokeUrl }
}

const firstFile = new File(['original'], 'camera-photo.heic', { type: 'image/heic' })
const secondFile = new File(['second'], 'replacement.png', { type: 'image/png' })

it('previews the resized JPEG instead of the original filename or original file, and revokes on replacement/clear/unmount', async () => {
  const page = fixture()
  await page.render().select(firstFile)
  expect(page.createUrl).toHaveBeenCalledExactlyOnceWith(page.resized)
  expect(page.render()).toMatchObject({ photo: page.resized, preview: 'blob:preview-1', processing: false, error: '' })
  const markup = renderToStaticMarkup(createElement(PhotoPreview, { src: page.render().preview, alt: 'Selected photo preview' }))
  expect(markup).toContain('<img src="blob:preview-1" alt="Selected photo preview"')
  expect(markup).not.toContain(firstFile.name)
  await page.render().select(secondFile)
  expect(page.revokeUrl).toHaveBeenCalledExactlyOnceWith('blob:preview-1')
  page.render().clear()
  expect(page.revokeUrl.mock.calls).toEqual([['blob:preview-1'], ['blob:preview-2']])
  expect(page.render()).toMatchObject({ photo: null, preview: null, processing: false, error: '' })
  await page.render().select(firstFile)
  page.unmount()
  expect(page.revokeUrl.mock.calls).toEqual([['blob:preview-1'], ['blob:preview-2'], ['blob:preview-3']])
})

it('clears the old preview immediately, shows friendly decode failure, and allows another choice', async () => {
  const page = fixture()
  await page.render().select(firstFile)
  page.resizePhoto.mockRejectedValueOnce(new Error(PHOTO_READ_ERROR))
  const pending = page.render().select(secondFile)
  expect(page.render()).toMatchObject({ photo: null, preview: null, processing: true })
  expect(page.revokeUrl).toHaveBeenCalledWith('blob:preview-1')
  await pending
  expect(page.render()).toMatchObject({ photo: null, preview: null, processing: false, error: PHOTO_READ_ERROR })
  expect(page.createUrl).toHaveBeenCalledOnce()
  await page.render().select(secondFile)
  expect(page.render()).toMatchObject({ photo: page.resized, preview: 'blob:preview-2', error: '' })
})

it('ignores a slower previous choice without creating a leaked or stale preview', async () => {
  const page = fixture()
  let resolve!: (photo: Blob) => void
  page.resizePhoto.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const slow = page.render().select(firstFile)
  await page.render().select(secondFile)
  resolve(new Blob(['stale JPEG'], { type: 'image/jpeg' }))
  await slow
  expect(page.createUrl).toHaveBeenCalledExactlyOnceWith(page.resized)
  expect(page.render()).toMatchObject({ photo: page.resized, preview: 'blob:preview-1', processing: false })
})

it.each(['clear', 'unmount'] as const)('does not create an object URL if %s happens during camera decoding', async action => {
  const page = fixture()
  let resolve!: (photo: Blob) => void
  page.resizePhoto.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const pending = page.render().select(firstFile)
  if (action === 'clear') page.render().clear()
  else page.unmount()
  resolve(page.resized)
  await pending
  expect(page.createUrl).not.toHaveBeenCalled()
  expect(page.render().preview).toBeNull()
})
