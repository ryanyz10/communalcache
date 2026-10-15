// Rebuild the committed site icons: node scripts/make-icons.mjs
// Only Node built-ins; the app and every icon share the same pixel sprite.
import { deflateSync } from 'node:zlib'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { MARK_COLORS, OPEN_BOX } from '../web/src/lib/pixelArt.ts'

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit=0;bit<8;bit++) crc=(crc>>>1)^((crc&1)?0xedb88320:0)
  }
  return (crc^0xffffffff)>>>0
}
function chunk(type,data) {
  const name=Buffer.from(type), length=Buffer.alloc(4), checksum=Buffer.alloc(4)
  length.writeUInt32BE(data.length); checksum.writeUInt32BE(crc32(Buffer.concat([name,data])))
  return Buffer.concat([length,name,data,checksum])
}
function rgb(hex) { return [1,3,5].map(index=>parseInt(hex.slice(index,index+2),16)) }
export function iconPng(size, maskable = true) {
  const bytes=Buffer.alloc((size*4+1)*size), px=maskable?Math.floor(size/28):2
  const ground=Math.round(size*0.74), x0=Math.floor((size-15*px)/2), y0=maskable?ground+px-12*px:4
  for (let y=0;y<size;y++) for (let x=0;x<size;x++) {
    let color=[0,0,0], alpha=0
    if (maskable) {
      const top=rgb('#a6dcf0'), bottom=rgb('#d6f1f8'), mix=y/size
      color=top.map((channel,index)=>Math.round(channel+(bottom[index]-channel)*mix));alpha=255
      if (y>=ground) color=rgb(y<ground+Math.max(1,Math.floor(px/2))?'#5ea548':'#7cc35e')
    }
    const spriteX=Math.floor((x-x0)/px), spriteY=Math.floor((y-y0)/px)
    const hex=MARK_COLORS[OPEN_BOX[spriteY]?.[spriteX]]
    if(hex) {color=rgb(hex);alpha=255}
    const offset=y*(size*4+1)+1+x*4
    bytes[offset]=color[0];bytes[offset+1]=color[1];bytes[offset+2]=color[2];bytes[offset+3]=alpha
  }
  const header=Buffer.alloc(13)
  header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;header[9]=6
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(bytes)),chunk('IEND',Buffer.alloc(0))])
}
export function faviconSvg() {
  const rects=OPEN_BOX.flatMap((row,y)=>Array.from(row,(char,x)=>MARK_COLORS[char]?`<rect x="${1+x*2}" y="${4+y*2}" width="2" height="2" fill="${MARK_COLORS[char]}"/>`:'')).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" shape-rendering="crispEdges">${rects}</svg>\n`
}
if (process.argv[1]===fileURLToPath(import.meta.url)) {
  const publicDir=new URL('../web/public/',import.meta.url)
  await Promise.all([
    writeFile(new URL('favicon.svg',publicDir),faviconSvg()),
    writeFile(new URL('favicon-32.png',publicDir),iconPng(32,false)),
    ...[[180,'apple-touch-icon.png'],[192,'icon-192.png'],[512,'icon-512.png']].map(([size,name])=>writeFile(new URL(name,publicDir),iconPng(size))),
  ])
  console.log('Generated SVG/32px favicon, 180px apple touch and 192/512px maskable icons.')
}
