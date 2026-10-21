import { readFileSync, readdirSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { BoxMark } from '../components/Box'
import { Avatar } from '../components/Avatar'
import { CoatPicker } from '../components/CoatPicker'
import { COATS, catTraits } from './cats'
import { createHash } from 'node:crypto'

const web = new URL('../../',import.meta.url)
const css = readFileSync(new URL('src/index.css',web),'utf8')
const palettes = [...css.matchAll(/:root\s*\{([^}]+)\}/g)].map(match=>Object.fromEntries([...match[1].matchAll(/(--cc-[\w-]+):\s*([^;\n]+)/g)].map(token=>[token[1],token[2]]))).filter(palette=>palette['--cc-bg'])
function luminance(hex: string) {
  const channels=[1,3,5].map(index=>parseInt(hex.slice(index,index+2),16)/255).map(value=>value<=0.04045?value/12.92:((value+0.055)/1.055)**2.4)
  return channels[0]*0.2126+channels[1]*0.7152+channels[2]*0.0722
}
function contrast(a: string,b: string) { const x=luminance(a),y=luminance(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05) }

it('uses exact Organic day/night roles and readable compatibility text on unfinished screens', () => {
  expect(palettes).toHaveLength(2)
  expect(palettes[0]).toMatchObject({'--cc-bg':'#f5ead8','--cc-card':'#f9f4ed','--cc-chip':'#ebddc5','--cc-fg':'#201e1d','--cc-accent':'#c67139'})
  expect(palettes[1]).toMatchObject({'--cc-bg':'#201e1d','--cc-card':'#2e2b25','--cc-chip':'#474238','--cc-fg':'#f5ead8','--cc-accent':'#f6a06b'})
  expect(css).toContain('@media (prefers-color-scheme: dark)')
  expect(css).toContain('--color-slate-600: var(--cc-sub)')
  expect(css).toContain('--color-white: var(--cc-card)')
  expect(css).not.toContain('[data-theme')
  expect(css).toContain('outline: 2px solid var(--cc-accent)')
  for(const palette of palettes) {
    for(const foreground of ['--cc-fg','--cc-sub']) for(const background of ['--cc-bg','--cc-card','--cc-chip']) expect(contrast(palette[foreground],palette[background]),`${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5)
    for(const tone of ['ok','warn','bad']) {
      expect(contrast(palette[`--cc-${tone}`],palette[`--cc-${tone}-bg`]),tone).toBeGreaterThanOrEqual(4.5)
      expect(contrast(palette[`--cc-${tone}`],palette['--cc-bg']),tone+' on body').toBeGreaterThanOrEqual(4.5)
    }
    expect(contrast('#201e1d',palette['--cc-accent']),'badge count').toBeGreaterThanOrEqual(4.5)
  }
  const mark=renderToStaticMarkup(createElement(BoxMark))
  expect(mark).toContain('viewBox="0 0 32 32"')
  expect(mark).not.toContain('crispEdges')
})

it.each(COATS)('keeps $name avatar and picker backgrounds at least 3:1 against the body in both themes', coat => {
  const rules = [...css.matchAll(/([^{}]+)\{\s*background: var\((--cc-avatar-(?:light|dark))\);\s*\}/g)]
  let token = ''
  for (const rule of rules) {
    const selectors = rule[1].trim().split(',').map(selector => selector.trim())
    if (selectors.includes('[data-cat-backdrop]') || selectors.includes(`[data-cat-backdrop="${coat.key}"]`)) token = rule[2]
  }
  expect(token).not.toBe('')
  for (const [index, palette] of palettes.entries()) {
    let background = palette[token]
    const alias = background.match(/^var\((--cc-[\w-]+)\)$/)
    if (alias) background = palette[alias[1]]
    expect(background).toMatch(/^#[0-9a-f]{6}$/)
    expect(contrast(coat.fill, background), `${coat.name} in ${index === 0 ? 'sunny' : 'evening'}`).toBeGreaterThanOrEqual(3)
  }
  const avatar = renderToStaticMarkup(createElement(Avatar, { userId: 'Mia', name: 'Neighbor', coat: coat.key }))
  expect(avatar).toContain(`data-cat-backdrop="${coat.key}"`)
  expect(avatar).toContain(`data-coat="${coat.key}"`)
  expect(avatar).toContain(`fill="${coat.fill}"`)
  const picker = renderToStaticMarkup(createElement(CoatPicker, { userId: 'Mia', value: coat.key, onChange: () => {} }))
  expect(picker).toContain(`class="cc-coat-swatch" data-cat-backdrop="${coat.key}"`)
})

it('uses the derived coat for legacy avatars while leaving profile-photo backgrounds unchanged', () => {
  const derived = renderToStaticMarkup(createElement(Avatar, { userId: 'Mia', name: 'Neighbor' }))
  expect(derived).toContain(`data-cat-backdrop="${catTraits('Mia').coat}"`)
  const photo = renderToStaticMarkup(createElement(Avatar, { userId: 'Mia', name: 'Neighbor', coat: 'dusk', photoVersion: 'photo' }))
  expect(photo).toContain('/api/users/Mia/photo?v=photo')
  expect(photo).not.toContain('data-cat-backdrop')
  expect(photo).not.toContain('cc-avatar-cat')
})

it('keeps only the self-hosted OFL font still used by sleeping-cat artwork', () => {
  expect(css).not.toMatch(/https?:\/\//)
  expect(css).toContain('font-family: Caprasimo')
  expect(css).not.toContain('Figtree')
  expect(css.match(/@font-face/g)).toHaveLength(2)
  const cat=readFileSync(new URL('src/components/Cat.tsx',web),'utf8')
  expect(cat).toContain('14px Caprasimo')
  expect(cat).toContain('10px Caprasimo')
  const hashes = {
    'caprasimo-latin.woff2':'8be0594f223844d398b066640ab4303555978a8a72c6558ff769251007bd431a',
    'caprasimo-latin-ext.woff2':'8cbef7cdad7bfe1fd7dc1958f3eca65b6e4e58c34b2f5a366d3e659d6d3efad1',
  }
  expect(readdirSync(new URL('public/fonts/',web)).filter(file=>file.endsWith('.woff2')).sort()).toEqual(Object.keys(hashes).sort())
  expect(readFileSync(new URL('index.html',web),'utf8')).not.toMatch(/figtree|rel="preload"/i)
  for(const [file,hash] of Object.entries(hashes)) {
    const bytes=readFileSync(new URL(`public/fonts/${file}`,web))
    expect(bytes.toString('ascii',0,4)).toBe('wOF2')
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(hash)
    expect(css).toContain(`/fonts/${file}`)
  }
  const licence=readFileSync(new URL('public/fonts/OFL.txt',web),'utf8')
  expect(licence).toContain('SIL OPEN FONT LICENSE Version 1.1')
  expect(licence).toContain('Caprasimo Project Authors')
  expect(licence).not.toContain('Figtree')
})

it('retains reproducible installed-app assets while updating the system chrome colors', async () => {
  const html=readFileSync(new URL('index.html',web),'utf8'), manifest=JSON.parse(readFileSync(new URL('public/manifest.webmanifest',web),'utf8'))
  expect(html).toContain('sizes="32x32" href="/favicon-32.png"')
  expect(html).toContain('rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png"')
  expect(html).toContain('name="color-scheme" content="light dark"')
  expect(html).toContain('content="#201e1d" media="(prefers-color-scheme: dark)"')
  expect(manifest.background_color).toBe(palettes[0]['--cc-bg'])
  for(const size of [192,512]) expect(manifest.icons).toContainEqual({src:`/icon-${size}.png`,sizes:`${size}x${size}`,type:'image/png',purpose:'any maskable'})
  const generator=await import(new URL('../../../scripts/make-icons.mjs',import.meta.url).href)
  const svg=readFileSync(new URL('public/favicon.svg',web),'utf8')
  expect(svg).toBe(generator.faviconSvg())
  expect(svg).not.toContain('crispEdges')
  expect(svg).toContain('M8 15 L9 4 L15 10 Z')
  expect(svg).toContain('fill="#f6a06b"')
  for(const [name,size] of [['favicon-32.png',32],['apple-touch-icon.png',180],['icon-192.png',192],['icon-512.png',512]] as const) {
    const png=readFileSync(new URL(`public/${name}`,web))
    expect(png.subarray(0,8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]))
    expect(png.readUInt32BE(16)).toBe(size);expect(png.readUInt32BE(20)).toBe(size)
    expect(png).toEqual(generator.iconPng(size,size!==32))
    if(size===32) continue
    let offset=8;const chunks: Buffer[]=[]
    while(offset<png.length) {const length=png.readUInt32BE(offset);if(png.toString('ascii',offset+4,offset+8)==='IDAT')chunks.push(png.subarray(offset+8,offset+8+length));offset+=length+12}
    const pixels=inflateSync(Buffer.concat(chunks))
    let artPixels=0, opaque=true, maxRadius=0
    for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
      const at=y*(size*4+1)+1+x*4
      if(pixels[at+3]!==255) opaque=false
      const hex='#'+pixels.subarray(at,at+3).toString('hex')
      if(hex==='#f5ead8')continue
      artPixels++
      maxRadius=Math.max(maxRadius,Math.hypot(x-size/2,y-size/2))
    }
    expect(opaque).toBe(true)
    expect(maxRadius,`${name} mark inside 40% radius maskable safe circle`).toBeLessThanOrEqual(size*0.4)
    expect(artPixels).toBeGreaterThan(50)
    expect(pixels.subarray(1,4).toString('hex')).toBe('f5ead8')
  }
})
