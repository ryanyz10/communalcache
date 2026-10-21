import { expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { readFileSync } from 'node:fs'
import { AuthProvider } from '../auth/AuthProvider'
import { LibraryPage } from '../pages/LibraryPage'
import type { LibraryItem } from './items'

const base:LibraryItem={id:'mixer',cache_id:null,owner_id:'owner',owner_name:'Ryan',title:'Stand mixer',description:null,is_consumable:false,quantity:null,available:true,active:true,created_at:1,photo_version:'private-version',caches:[{id:'maple',name:'Private cache name'}],pending_count:2}
const items=[{...base,id:'tent',title:'Camping tent',active:false,photo_version:null},{...base,id:'ladder',title:'Ladder',photo_version:null},{...base,id:'starter',title:'Sourdough starter',is_consumable:true,quantity:6,photo_version:null},{...base,id:'washer',title:'Pressure washer',available:false,photo_version:null},base]
function render() {
  const client=new QueryClient({defaultOptions:{queries:{retry:false,retryOnMount:false,staleTime:Infinity}}})
  client.setQueryData(['me'],{id:'owner',display_name:'Ryan',email:'own-private@example.test'})
  client.setQueryData(['library','owner'],{pages:[{items,next_cursor:null,totals:{total_count:5,lend_count:4,give_count:1,unshared_count:0,shared_cache_count:1}}],pageParams:[null]})
  const html=renderToStaticMarkup(createElement(QueryClientProvider,{client},createElement(AuthProvider,{children:createElement(MemoryRouter,null,createElement(LibraryPage))})))
  client.clear();return html
}

it('has a plain header with primary New action and all four counted filters, without hero or cache/action metadata',()=>{
  const html=render()
  for(const copy of ['<h1>Your items</h1>','cc-profile-primary cc-library-new','+ New</span>','+ New item</span>','All 5','Lend 4','Give 1','Not shared 0'])expect(html).toContain(copy)
  expect(html).not.toMatch(/Ryan&#x27;s things|cc-library-hero|cc-library-cat|cc-library-asks|cc-library-row|cc-library-status|cc-library-shared|Private cache name|own-private@example/)
})

it('renders one kind/status line per private tile and preserves the supplied newest-first order',()=>{
  const html=render(),lines=[...html.matchAll(/<p class="cc-library-kind">([\s\S]*?)<\/p>/g)].map(match=>match[1].replace(/<[^>]+>/g,''))
  expect(lines).toEqual(['Lend · Inactive','Lend','Give · 6','Lend · Lent out','Lend'])
  expect(html).toContain('cc-library-lent')
  expect(html).toContain('cc-library-tile cc-item-inactive')
  expect(html).not.toContain('cc-inactive-tag')
  expect(html.match(/class="cc-library-item"/g)).toHaveLength(5)
  for(const item of items)expect(html).toContain(`href="/items/${item.id}"`)
  expect(html).toContain('/api/me/items/mixer/photo?v=private-version')
  expect(html.indexOf('Camping tent')).toBeLessThan(html.indexOf('Stand mixer'))
})

it('limits filter scrolling to the horizontal axis with space for hit targets and focus rings, and dims only inactive art',()=>{
  const css=readFileSync(new URL('../items.css',import.meta.url),'utf8')
  const filters=css.match(/\.cc-library-filters\s*\{([^}]+)\}/)![1]
  for(const rule of ['overflow-x: auto','overflow-y: hidden','padding: 8px 4px','margin: -8px -4px'])expect(filters).toContain(rule)
  expect(css).not.toMatch(/\.cc-library-tile\.cc-item-inactive > a\s*\{/)
  expect(css).toMatch(/\.cc-library-tile\.cc-item-inactive \.cc-library-caption\s*\{[^}]*color: var\(--cc-sub\)/)
})

it('uses two mobile columns and five at wide desktop with fixed-aspect photo tiles and no floating New rules',()=>{
  const css=readFileSync(new URL('../items.css',import.meta.url),'utf8')
  expect(css).toContain('grid-template-columns: repeat(2,minmax(0,1fr))')
  expect(css).toContain('grid-template-columns: repeat(5,minmax(0,1fr))')
  expect(css).toContain('aspect-ratio: 4 / 3')
  const action=css.match(/\.cc-library-new\s*\{([^}]+)\}/)![1]
  expect(action).not.toMatch(/position:|bottom:|right:/)
  expect(css).not.toMatch(/\.cc-library-(hero|row|columns|chips|status)|\.cc-unshared-tile/)
})
