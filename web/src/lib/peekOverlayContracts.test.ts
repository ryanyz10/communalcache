import { afterEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import ts from 'typescript'

type ModelElement = {
  className: string
  innerHTML: string
  style: Record<string, string>
  setAttribute: (name: string, value: string) => void
  remove: () => void
  animate: (frames: unknown, options: { duration: number }) => { finished: Promise<void>; cancel: () => void }
}
const parent = '2dfffd47f1bd59d39eb3fd52d8ad859898194cba'
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

function fixture(destination = true) {
  vi.useFakeTimers()
  const trace: unknown[][] = [], elements: ModelElement[] = []
  const sourceRect = { left: 10, top: 20, width: 100, height: 30 }
  const destinationRect = { left: 60, top: 30, width: 80, height: 20 }
  function element(): ModelElement {
    const node: ModelElement = {
      className: '', innerHTML: '', style: {} as Record<string, string>,
      setAttribute: (name: string, value: string) => trace.push(['attribute', name, value]),
      remove() { trace.push(['remove', this.className]) },
      animate(frames: unknown, options: { duration: number }) {
        trace.push(['animate', this.className, frames, options])
        return { finished: new Promise<void>(resolve => setTimeout(resolve, options.duration)), cancel: () => trace.push(['cancel', this.className]) }
      },
    }
    elements.push(node)
    return node
  }
  vi.stubGlobal('innerWidth', 390); vi.stubGlobal('innerHeight', 844)
  vi.stubGlobal('performance', { now: () => Date.now() })
  vi.stubGlobal('scrollTo', (...args: unknown[]) => trace.push(['scroll', ...args]))
  vi.stubGlobal('document', {
    createElement: element,
    body: { append: (...nodes: ModelElement[]) => trace.push(['append', ...nodes.map(node => node.className)]) },
    querySelector: () => destination ? { getBoundingClientRect: () => destinationRect } : null,
  })
  const source = process.env.CONTROL_CONTRACT_PARENT === '1'
    ? execFileSync('git', ['show', `${parent}:web/src/components/peekOverlay.ts`], { encoding: 'utf8' })
    : readFileSync(new URL('../components/peekOverlay.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} as { openCacheWithPeek: (event: unknown, cacheId: string, navigate: () => void) => void } }
  let enabled = true, hasHandle = true
  new Function('require', 'module', 'exports', compiled)(() => ({ shouldPeek: () => enabled, markPeeked: (id: string) => trace.push(['mark', id]) }), module, module.exports)
  const event = () => ({ defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, preventDefault: vi.fn(), currentTarget: { querySelector: () => hasHandle ? { getBoundingClientRect: () => sourceRect } : null } })
  return { trace, elements, event, open: (input = event()) => { module.exports.openCacheWithPeek(input, 'cache', () => trace.push(['navigate'])); return input }, disable: () => { enabled = false }, removeHandle: () => { hasHandle = false } }
}

it('preserves grow→navigate/mark/scroll→hold→destination shrink timing, geometry and cleanup', async () => {
  const page = fixture(), input = page.open()
  expect(input.preventDefault).toHaveBeenCalledOnce()
  expect(page.trace).toContainEqual(['append', 'cc-hole-overlay', 'cc-peek-eyes'])
  expect(page.elements[1].innerHTML).toContain('class="cc-peek-look"')
  expect(page.elements[1].innerHTML).toContain('rx="4.5" ry="5.5"')
  expect(page.trace).toContainEqual(['animate', 'cc-hole-overlay', [{ transform: 'scale(1)' }, { transform: 'scale(61)' }], { duration: 700, easing: 'cubic-bezier(.55,0,.85,.35)', fill: 'forwards' }])
  const concurrent = page.open(); expect(concurrent.preventDefault).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(699); expect(page.trace).not.toContainEqual(['navigate'])
  await vi.advanceTimersByTimeAsync(1)
  expect(page.trace.filter(row => ['navigate', 'mark', 'scroll'].includes(row[0] as string))).toEqual([['navigate'], ['mark', 'cache'], ['scroll', 0, 0]])
  await vi.advanceTimersByTimeAsync(650)
  expect(page.elements[0].style).toEqual({ left: '60px', top: '30px', width: '80px', height: '20px' })
  expect(page.trace).toContainEqual(['animate', 'cc-hole-overlay', [{ transform: 'scale(88)' }, { transform: 'scale(1)' }], { duration: 750, easing: 'cubic-bezier(.15,.65,.25,1)' }])
  await vi.advanceTimersByTimeAsync(750)
  expect(page.trace.slice(-2)).toEqual([['remove', 'cc-hole-overlay'], ['remove', 'cc-peek-eyes']])
})

it('preserves modified/default-prevented/motion-off/missing-handle plain navigation', () => {
  const page = fixture()
  for (const changes of [{ defaultPrevented: true }, { button: 1 }, { metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }]) {
    const input = { ...page.event(), ...changes }; page.open(input); expect(input.preventDefault).not.toHaveBeenCalled()
  }
  page.removeHandle(); expect(page.open().preventDefault).not.toHaveBeenCalled()
  page.disable(); expect(page.open().preventDefault).not.toHaveBeenCalled()
  expect(page.trace).toEqual([])
})

it('preserves bounded missing-destination wait, fade fallback and cleanup', async () => {
  const page = fixture(false); page.open(); await vi.advanceTimersByTimeAsync(5000)
  expect(page.trace).toContainEqual(['animate', 'cc-hole-overlay', [{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' }])
  expect(page.trace.slice(-2)).toEqual([['remove', 'cc-hole-overlay'], ['remove', 'cc-peek-eyes']])
})
