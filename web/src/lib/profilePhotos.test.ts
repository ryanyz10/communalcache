import { afterEach, expect, it, vi } from 'vitest'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '../auth/AuthProvider'
import { Avatar } from '../components/Avatar'
import { AppHeader } from '../components/AppHeader'
import { AccountPage } from '../pages/AccountPage'
import { CacheSettingsPage } from '../pages/CacheSettingsPage'
import { ItemPage } from '../pages/ItemPage'
import { RequestCard } from '../pages/RequestCard'
import { profilePhotoSrc } from './avatars'
import { PHOTO_READ_ERROR, resizePhoto, uploadProfilePhoto } from './photos'
import { errorMessage } from './api'
import type { ItemRequest } from './requests'

const owner = '11111111-1111-4111-8111-111111111111', member = '22222222-2222-4222-8222-222222222222'
const cacheId = '33333333-3333-4333-8333-333333333333', itemId = '44444444-4444-4444-8444-444444444444'
const me = {id:owner,display_name:'Ryan Zhou',email:'own@example.test',profile_photo_version:'owner-photo'}
const request: ItemRequest = {id:'ask',cache_id:cacheId,cache_name:'Tools',item_id:itemId,item_title:'Mixer',owner_id:owner,owner_name:'Ryan Zhou',requester_id:member,requester_name:'Priya',owner_photo_version:'owner-photo',requester_photo_version:'member-photo',quantity:null,status:'approved',decision_reason:null,decided_at:2,created_at:1}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals()})
function render(element: ReactElement, options: {version?: string|null;route?:string;path?:string} = {}) {
  vi.stubGlobal('location',{origin:'https://communalcache.com'})
  const client = new QueryClient({defaultOptions:{queries:{retry:false}}})
  client.setQueryData(['me'],{...me,profile_photo_version:options.version===undefined?'owner-photo':options.version})
  client.setQueryData(['cache',cacheId],{id:cacheId,name:'Tools',owner_id:owner,requires_approval:false,invite_token:`${cacheId}.${'A'.repeat(43)}`,members:[{user_id:owner,display_name:'Ryan Zhou',profile_photo_version:'owner-photo'},{user_id:member,display_name:'Priya',profile_photo_version:'member-photo'}]})
  client.setQueryData(['join-requests',cacheId],[])
  client.setQueryData(['item',cacheId,itemId],{id:itemId,cache_id:cacheId,owner_id:owner,owner_name:'Ryan Zhou',owner_photo_version:'owner-photo',title:'Mixer',description:null,is_consumable:false,quantity:null,photo_version:null,created_at:1})
  client.setQueryData(['item-requests',cacheId,itemId],[])
  const route = createElement(Routes,null,createElement(Route,{path:options.route??'/',element}))
  const markup = renderToStaticMarkup(createElement(QueryClientProvider,{client},createElement(AuthProvider,{children:createElement(MemoryRouter,{initialEntries:[options.path??'/']},route)})))
  client.clear()
  return markup
}

it('keeps identity/version-specific private image paths and uses id-derived cats for avatar fallback', () => {
  const traits = renderToStaticMarkup(createElement(Avatar,{userId:owner,name:'Ryan Zhou'})).match(/data-coat="[^"]+" data-pattern="[^"]+"/)?.[0]
  expect(traits).toBeDefined()
  for (const name of ['  Ryan Zhou ', 'Priya', '😀 Neighbor', '   ']) {
    const avatar = renderToStaticMarkup(createElement(Avatar,{userId:owner,name}))
    expect(avatar).toContain(`<span class="sr-only">${name}</span>`)
    expect(avatar).toContain(traits!)
    expect(avatar).toContain('cc-avatar-cat')
    expect(avatar).not.toContain('<img')
  }
  expect(profilePhotoSrc(owner,null)).toBeNull()
  expect(profilePhotoSrc(owner,'a/b?x')).toBe(`/api/users/${owner}/photo?v=a%2Fb%3Fx`)
  expect(profilePhotoSrc(owner,'version')).not.toBe(profilePhotoSrc(member,'version'))
  expect(profilePhotoSrc(owner,'version')).not.toBe(profilePhotoSrc(owner,'new-version'))
  const fallback = renderToStaticMarkup(createElement(Avatar,{userId:owner,name:'Ryan Zhou'}))
  expect(fallback).toContain('cc-cat-peek')
  expect(fallback).toContain('data-coat=')
  expect(fallback).not.toContain('<img')
  const photo = renderToStaticMarkup(createElement(Avatar,{userId:owner,name:'Ryan Zhou',photoVersion:'owner-photo'}))
  expect(photo).toContain(`src="/api/users/${owner}/photo?v=owner-photo"`)
  expect(photo).toContain('alt=""')
  expect(photo).toContain('aria-hidden="true"')
  expect(photo).not.toMatch(/blob:|r2\.dev|Authorization/)
})

it('renders labeled Account Change/Choose/Remove controls in a native sheet with cat fallback', () => {
  const fetch = vi.spyOn(globalThis,'fetch')
  const markup = render(createElement(AccountPage),{version:null})
  for(const copy of ['Profile photo','Change photo','Choose a photo','Remove photo','Save photo','Only you and people who share an active cache','Your cat when there is none'])expect(markup).toContain(copy)
  expect(markup.match(/<dialog\b/g)).toHaveLength(2)
  expect(markup).toContain('aria-labelledby="profile-photo-heading"')
  expect(markup).toContain('aria-haspopup="dialog"')
  expect(markup).toContain('aria-controls="profile-photo-sheet"')
  expect(markup).toContain('for="profile-photo-file"')
  expect(markup).toContain('accept="image/jpeg,image/png,image/webp"')
  expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Remove photo<\/button>/)
  expect(markup).toContain('cc-sheet lg:w-[440px] lg:rounded-2xl lg:p-6')
  expect(markup).toContain('cc-profile-label')
  expect(markup).toContain('cc-account-settings')
  expect(fetch).not.toHaveBeenCalled()
  expect(render(createElement(AccountPage))).not.toMatch(/<button[^>]*disabled=""[^>]*>Remove photo<\/button>/)
})

it('uses guarded photo metadata in the header, members, request parties and item owner without another email', () => {
  const ownSource = `/api/users/${owner}/photo?v=owner-photo`, otherSource = `/api/users/${member}/photo?v=member-photo`
  expect(render(createElement(AppHeader))).toContain(ownSource)
  const members = render(createElement(CacheSettingsPage),{route:'/caches/:cacheId/settings',path:`/caches/${cacheId}/settings`})
  expect(members).toContain(ownSource)
  expect(members).toContain(otherSource)
  const card = render(createElement(RequestCard,{request,callerId:owner}))
  expect(card).toContain(otherSource)
  expect(card).toContain('Priya')
  expect(card).toContain('Mixer')
  const item = render(createElement(ItemPage),{route:'/caches/:cacheId/items/:itemId',path:`/caches/${cacheId}/items/${itemId}`})
  expect(item).toContain(ownSource)
  expect(item).toContain('<dt>From</dt>')
  expect(item).toContain('Ryan Zhou')
  for(const markup of [members,card,item])expect(markup).not.toContain('own@example.test')
  const denied = render(createElement(RequestCard,{request:{...request,owner_photo_version:null,requester_photo_version:null},callerId:owner}))
  expect(denied).not.toContain('/api/users/')
})

it('feeds a real PNG file through the shared profile/item resize reader with native canvas APIs mocked', async () => {
  const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/f9sAAAAASUVORK5CYII='),char=>char.charCodeAt(0))
  const file = new File([bytes],'profile.png',{type:'image/png'})
  const bitmap = {width:1,height:1,close:vi.fn()}, context = {fillStyle:'',fillRect:vi.fn(),drawImage:vi.fn()}
  const encoded = new Blob(['native-canvas-output-fixture'],{type:'image/jpeg'})
  const canvas = {width:0,height:0,getContext:()=>context,toBlob:(callback:BlobCallback)=>callback(encoded)}
  const decode = vi.fn(async(input:Blob)=>{expect(new Uint8Array(await input.arrayBuffer())).toEqual(bytes);return bitmap})
  vi.stubGlobal('createImageBitmap',decode)
  vi.stubGlobal('document',{createElement:(tag:string)=>{expect(tag).toBe('canvas');return canvas}})
  expect(await resizePhoto(file)).toBe(encoded)
  expect(decode).toHaveBeenCalledWith(file)
  expect(context.drawImage).toHaveBeenCalledWith(bitmap,0,0,1,1)
  expect(bitmap.close).toHaveBeenCalledOnce()
  decode.mockRejectedValueOnce(new Error('unreadable transported file'))
  await expect(resizePhoto(file)).rejects.toThrow(PHOTO_READ_ERROR)
})

it('uploads only to the self endpoint with cookie auth and retains profile-limit errors', async () => {
  const photo = new Blob(['JPEG'],{type:'image/jpeg'})
  const fetch = vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json(me))
  expect(await uploadProfilePhoto(photo)).toEqual(me)
  expect(fetch).toHaveBeenCalledWith('/api/me/photo',{method:'POST',credentials:'same-origin',headers:{Accept:'application/json','Content-Type':'image/jpeg'},body:photo})
  fetch.mockResolvedValueOnce(Response.json({error:'limit_reached',limit:'profile_photos'},{status:409}))
  let failure: unknown
  try { await uploadProfilePhoto(photo) } catch(error) { failure=error }
  expect(failure).toMatchObject({status:409,code:'limit_reached',limit:'profile_photos'})
  expect(errorMessage(failure)).toContain('profile photo')
})
