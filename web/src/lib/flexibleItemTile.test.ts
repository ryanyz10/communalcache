import { expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { ThingNameArt, ThingTile } from '../components/ThingTile'
import { ItemPhoto } from '../pages/ItemPhoto'
import type { Item } from './items'

const item:Item={id:'tile',cache_id:'cache',owner_id:'owner',owner_name:'Owner',title:'Guitar with spare strings',description:null,is_consumable:false,quantity:null,available:true,photo_version:null,created_at:1}
const render=(element:ReturnType<typeof createElement>)=>renderToStaticMarkup(element)

it('renders the full lowercase title, preserving the existing quantity-prefix cleanup and decorative semantics',()=>{
  expect(render(createElement(ThingNameArt,{title:item.title}))).toBe('<span class="cc-thing-name" aria-hidden="true">guitar with spare strings</span>')
  expect(render(createElement(ThingNameArt,{title:'4-person Camping Tent'}))).toContain('>camping tent</span>')
  const html=render(createElement(ThingTile,{item,library:true}))
  expect(html).toContain('aria-hidden="true"')
  expect(html).toContain('>guitar with spare strings</span>')
  expect(html).not.toContain('>gu</span>')
})

it('uses the same decorative art in item heroes without changing private image URLs or alt text',()=>{
  const fallback=render(createElement(ItemPhoto,{item}))
  expect(fallback).toContain('cc-item-photo-frame cc-thing-tile cc-thing-tile-')
  expect(fallback).toContain('<span class="cc-thing-name" aria-hidden="true">guitar with spare strings</span>')
  for(const cache_id of [null,'cache']){
    const photo=render(createElement(ItemPhoto,{item:{...item,cache_id,photo_version:'a/b?c'}}))
    expect(photo).toContain(`${cache_id?'/api/caches/cache/items':'/api/me/items'}/tile/photo?v=a%2Fb%3Fc`)
    expect(photo).toContain('alt="Photo of Guitar with spare strings"')
    expect(photo).not.toContain('cc-thing-name')
  }
})

it('has one fluid name-size/offset rule for thumbnails, grids, detail and approved-history frames',()=>{
  const caches=readFileSync(new URL('../caches.css',import.meta.url),'utf8')
  const items=readFileSync(new URL('../items.css',import.meta.url),'utf8')
  const asks=readFileSync(new URL('../asks.css',import.meta.url),'utf8')
  const css=caches+items+asks
  expect(css.match(/\.cc-thing-name\s*\{/g)).toHaveLength(1)
  const rule=css.match(/\.cc-thing-name\s*\{([^}]+)\}/)![1]
  for(const value of ['left: 10cqmin','bottom: calc(-5px - 3.5cqmin)','font: 400 calc(20px + 14cqmin)/1','white-space: nowrap','color: var(--cc-art-ink, currentColor)'])expect(rule).toContain(value)
  expect(caches).toMatch(/\.cc-thing-tile\s*\{[^}]*container-type: size;[^}]*width: 44px;[^}]*height: 44px;[^}]*overflow: hidden/)
  expect(items).toMatch(/\.cc-library-grid \.cc-thing-tile\s*\{[^}]*width: 100%;[^}]*height: auto;[^}]*aspect-ratio: 4 \/ 3/)
  expect(items).toMatch(/\.cc-item-photo-frame\s*\{[^}]*width: 100%;[^}]*height: 200px/)
  expect(asks).toMatch(/\.cc-approved-name-tile\s*\{[^}]*width: 100%;[^}]*height: 150px/)
  expect(css).not.toMatch(/\.cc-item-name-art|\.cc-approved-name-art|\.cc-thing-tile > span/)
})
