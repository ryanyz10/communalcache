import { afterEach, expect, it, vi } from 'vitest'
import * as React from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
function load(path: string, modules: Record<string, unknown>) {
  const source = readFileSync(new URL(path,import.meta.url),'utf8')
  const compiled = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText
  const module = {exports:{} as Record<string,React.ComponentType<Record<string,unknown>>>}
  new Function('require','module','exports',compiled)((name:string) => { if (!(name in modules)) throw new Error(name); return modules[name] },module,module.exports)
  return module.exports
}

function dialogFixture(options: {busy?:boolean;dirty?:boolean;committed?:boolean;disconnected?:boolean} = {}) {
  class Element {
    isConnected = true
    dataset = {itemEditorTrigger:'new'}
    focus = vi.fn()
    setAttribute = vi.fn()
    matches = () => true
    getBoundingClientRect = () => ({left:100,right:660,top:100,bottom:700,width:560})
  }
  const previous = new Element(), trigger = new Element(), heading = new Element()
  previous.isConnected = !options.disconnected
  const style = {setProperty:vi.fn()}
  const modal = {open:false,style,showModal:vi.fn(() => {modal.open=true}),close:vi.fn(() => {modal.open=false}),querySelector:() => heading,getBoundingClientRect:previous.getBoundingClientRect}
  const root = {style:{overflow:'auto'}}, body = {style:{overflow:'scroll'}}
  const viewport = {height:800,offsetTop:0,addEventListener:vi.fn(),removeEventListener:vi.fn()}
  const confirm = vi.fn(() => false), dismiss = vi.fn()
  vi.stubGlobal('HTMLElement',Element)
  vi.stubGlobal('document',{activeElement:previous,documentElement:root,body,
    querySelector:(selector:string) => selector.startsWith('dialog') ? modal.open ? modal : null : heading,
    querySelectorAll:() => [trigger]})
  vi.stubGlobal('window',{innerHeight:800,visualViewport:viewport,confirm,addEventListener:vi.fn(),removeEventListener:vi.fn()})
  vi.stubGlobal('requestAnimationFrame',(callback:()=>void) => {callback();return 1})
  let effect!:()=>void|(()=>void)
  let node!:React.ReactElement<Record<string,unknown>>
  const components = load('../components/ItemEditorDialog.tsx',{
    react:{...React,useRef:() => ({current:modal}),useLayoutEffect:(callback:typeof effect) => {effect=callback}},
    'react/jsx-runtime':{jsx:(...args:Parameters<typeof jsx>) => {const next=jsx(...args);if(args[0]==='dialog')node=next as typeof node;return next},jsxs},
  })
  const html = renderToStaticMarkup(React.createElement(components.ItemEditorDialog,{busy:!!options.busy,dirty:!!options.dirty,committed:!!options.committed,returnFocus:'new',onDismiss:dismiss,
    children:(close:()=>void) => React.createElement('button',{onClick:close},'Cancel')}))
  const cleanup = effect() as ()=>void
  const cancel = () => {const event={preventDefault:vi.fn()};(node.props.onCancel as (event:unknown)=>void)(event);return event}
  const backdrop = () => (node.props.onClick as (event:unknown)=>void)({target:modal,currentTarget:modal,clientX:0,clientY:0})
  return {html,modal,root,body,previous,trigger,viewport,confirm,dismiss,cancel,backdrop,cleanup,style}
}

it('opens a native focus-trapping dialog, locks/restores scrolling and returns focus after close', () => {
  const view = dialogFixture()
  expect(view.html).toContain('<dialog class="cc-item-editor" aria-labelledby="item-editor-heading" aria-modal="true">')
  expect(view.modal.showModal).toHaveBeenCalledOnce()
  expect(view.root.style.overflow).toBe('hidden');expect(view.body.style.overflow).toBe('hidden')
  expect(view.cancel().preventDefault).toHaveBeenCalledOnce();expect(view.dismiss).toHaveBeenCalledOnce()
  view.cleanup()
  expect(view.root.style.overflow).toBe('auto');expect(view.body.style.overflow).toBe('scroll')
  expect(view.previous.focus).toHaveBeenCalledOnce()
})

it('confirms dirty Cancel/Escape/backdrop and explains already-committed recovery without deleting anything', () => {
  const view = dialogFixture({dirty:true,committed:true})
  view.backdrop();expect(view.dismiss).not.toHaveBeenCalled()
  expect(view.confirm).toHaveBeenCalledWith('Your item is already saved. Leave without finishing its remaining photo or sharing changes?')
  view.confirm.mockReturnValue(true);view.cancel();expect(view.dismiss).toHaveBeenCalledOnce()
  view.cleanup()
  const busy = dialogFixture({busy:true,dirty:true})
  busy.backdrop();busy.cancel();expect(busy.confirm).not.toHaveBeenCalled();expect(busy.dismiss).not.toHaveBeenCalled()
  busy.cleanup()
})

it('fits the drawer above a reduced visual viewport and finds the replaced route trigger on close', () => {
  const view = dialogFixture({disconnected:true})
  view.viewport.height=360
  const resize = view.viewport.addEventListener.mock.calls.find(call => call[0]==='resize')![1] as ()=>void
  resize()
  expect(view.style.setProperty).toHaveBeenCalledWith('--cc-editor-height','360px')
  expect(view.style.setProperty).toHaveBeenCalledWith('--cc-editor-bottom','440px')
  view.cleanup();expect(view.trigger.focus).toHaveBeenCalledOnce()
  expect(view.viewport.removeEventListener).toHaveBeenCalledWith('resize',resize)
})

function routeFixture({editing=false,inCache=false,inApp=false,loading=false,denied=false}: {editing?:boolean;inCache?:boolean;inApp?:boolean;loading?:boolean;denied?:boolean} = {}) {
  const states:unknown[]=[];let index=0
  const navigate=vi.fn(), queries:Record<string,unknown>[]=[]
  let itemReadFailed=false
  let dialog:Record<string,unknown>|undefined, form:Record<string,unknown>|undefined
  const background = (name:string) => () => React.createElement('main',{'data-background':name})
  const modules:Record<string,unknown>={
    react:{...React,useState:(initial:unknown) => {const slot=index++;if(!(slot in states))states[slot]=initial;return [states[slot],(next:unknown) => {states[slot]=next}]}},
    'react/jsx-runtime':{jsx,jsxs,Fragment:React.Fragment},
    'react-router':{useParams:()=>({cacheId:inCache?'cache':undefined,itemId:'item'}),useLocation:()=>({state:inApp?{itemEditor:true}:null}),useNavigate:()=>navigate,Navigate:()=>React.createElement('p',null,'denied')},
    '@tanstack/react-query':{useQuery:(query:Record<string,unknown>)=>{queries.push(query);return {isSuccess:!loading,isPending:loading,error:itemReadFailed && (query.queryKey as string[])[0]!=='cache' ? new Error('hidden item') : null,data:(query.queryKey as string[])[0]==='cache'?{id:'cache'}:{id:'item',owner_id:denied?'other':'owner'}}}},
    '../auth/AuthProvider':{useAuth:()=>({me:{id:'owner',display_name:'Owner'}})},
    '../lib/api':{apiFetch:vi.fn(),errorMessage:()=>''},
    '../lib/caches':{cacheDetailQuery:(id:unknown)=>({queryKey:['cache',id]})},
    '../lib/items':{libraryItemQuery:(_user:unknown,id:unknown)=>({queryKey:['library-item','owner',id]})},
    './OnboardingPage':{OnboardingPage:()=>null},
    './ItemPage':{ItemPage:background('item')},'./LibraryPage':{LibraryPage:background('library')},'./CachePage':{CachePage:background('cache')},
    './ItemForm':{ItemForm:(props:Record<string,unknown>)=>{form=props;return React.createElement('form',{'data-editor-form':true})}},
    '../components/ItemEditorDialog':{ItemEditorDialog:(props:Record<string,unknown>)=>{dialog=props;return React.createElement('dialog',null,(props.children as (close:unknown)=>React.ReactNode)(props.onDismiss))}},
    '../components/Skeleton':{LoadingStatus:({label}:{label:string})=>React.createElement('span',null,label)},
  }
  const Component = load('../pages/ItemEditorPage.tsx',modules).ItemEditorPage
  function render(){index=0;return renderToStaticMarkup(React.createElement(Component,{editing}))}
  const html=render()
  return {html,navigate,queries,render,dialog:()=>dialog!,form:()=>form!,failItemRead:()=>{itemReadFailed=true}}
}

it.each([
  [false,false,'library','/items'],[true,false,'item','/items/item'],
  [false,true,'cache','/caches/cache'],[true,true,'item','/caches/cache/items/item'],
] as const)('opens the correct background for editing=%s cache=%s and closes deep links to %s', (editing,inCache,background,path) => {
  const direct=routeFixture({editing,inCache})
  expect(direct.html).toContain(`data-background="${background}"`)
  expect(direct.html).toContain('<dialog>')
  ;(direct.form().onCancel as ()=>void)()
  expect(direct.navigate).toHaveBeenCalledWith(path,{replace:true})
  const linked=routeFixture({editing,inCache,inApp:true})
  ;(linked.form().onCancel as ()=>void)()
  expect(linked.navigate).toHaveBeenCalledWith(-1)
})

it('keeps committed cache-editor recovery mounted when deactivation hides the cache item read', () => {
  const editor=routeFixture({editing:true,inCache:true})
  ;(editor.form().onStateChange as (state:unknown)=>void)({dirty:true,committed:true})
  editor.failItemRead()
  expect(editor.render()).toContain('data-editor-form="true"')
  expect(editor.queries.at(-1)?.enabled).toBe(false)
})

it('preserves owner guards, keeps loading inside the dialog and replaces the editor route after save', () => {
  const denied=routeFixture({editing:true,denied:true})
  expect(denied.html).toBe('<p>denied</p>')
  expect(denied.dialog()).toBeUndefined()
  const loading=routeFixture({editing:true,loading:true})
  expect(loading.html).toContain('<dialog>');expect(loading.html).toContain('Loading item editor…')
  const editor=routeFixture({inCache:true})
  ;(editor.form().onStateChange as (state:unknown)=>void)({dirty:true,committed:true})
  ;(editor.form().onBusy as (busy:boolean)=>void)(true);editor.render()
  expect(editor.dialog()).toMatchObject({dirty:true,committed:true,busy:true})
  ;(editor.form().onSaved as (item:unknown)=>void)({id:'saved'})
  expect(editor.navigate).toHaveBeenCalledWith('/caches/cache/items/saved',{replace:true})
  ;(editor.form().onSaved as (item:unknown, shared:boolean)=>void)({id:'saved'},false)
  expect(editor.navigate).toHaveBeenCalledWith('/items/saved',{replace:true})
  ;(editor.form().onSaved as (item:unknown, shared:boolean)=>void)({id:'inactive',active:false},true)
  expect(editor.navigate).toHaveBeenCalledWith('/items/inactive',{replace:true})
  expect(editor.queries.at(-1)?.enabled).toBe(false)
})
