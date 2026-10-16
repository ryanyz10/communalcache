// Rebuild the flat BoxMark icons with Node built-ins: node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const INK = [32,30,29], CAT = [130,121,106], BOX = [246,160,107], BG = [245,234,216]
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
function polygon(x,y,points) {
  let inside=false
  for(let i=0,j=points.length-1;i<points.length;j=i++) {
    const [a,b]=points[i], [c,d]=points[j]
    if((b>y)!==(d>y) && x<(c-a)*(y-b)/(d-b)+a) inside=!inside
  }
  return inside
}
function roundedRect(x,y,left,top,width,height,radius) {
  if(x<left || x>left+width || y<top || y>top+height) return false
  const dx=Math.max(left+radius-x,0,x-(left+width-radius)), dy=Math.max(top+radius-y,0,y-(top+height-radius))
  return dx*dx+dy*dy<=radius*radius
}
// Sample the two exact cubic curves in BoxMark's cat head.
const head=[[6,15]]
for(const [a,b,c,d] of [ [[6,15],[6,9],[10,8],[16,8]], [[16,8],[22,8],[26,9],[26,15]] ]) {
  for(let i=1;i<=32;i++) {
    const t=i/32, u=1-t
    head.push([u*u*u*a[0]+3*u*u*t*b[0]+3*u*t*t*c[0]+t*t*t*d[0],u*u*u*a[1]+3*u*u*t*b[1]+3*u*t*t*c[1]+t*t*t*d[1]])
  }
}
function markPixel(x,y) {
  if(roundedRect(x,y,3,13,26,5,2.5)) return INK.map((v,i)=>v*.16+BOX[i]*.84)
  if(roundedRect(x,y,3,13,26,17,5)) return BOX
  if(y<4 || y>15 || x<6 || x>26) return null
  if(polygon(x,y,[[8,15],[9,4],[15,10]]) || polygon(x,y,[[24,15],[23,4],[17,10]]) || (y>=8 && polygon(x,y,head))) return CAT
  return null
}
export function iconPng(size, maskable = true) {
  const bytes=Buffer.alloc((size*4+1)*size), samples=4, scale=maskable?.66:1
  for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
    const sum=[0,0,0];let alpha=0
    for(let sy=0;sy<samples;sy++) for(let sx=0;sx<samples;sx++) {
      const px=((x+(sx+.5)/samples)/size*32-16)/scale+16
      const py=((y+(sy+.5)/samples)/size*32-16)/scale+17
      const color=markPixel(px,py) ?? (maskable?BG:null)
      if(!color)continue
      alpha++
      for(let i=0;i<3;i++)sum[i]+=color[i]
    }
    const at=y*(size*4+1)+1+x*4
    for(let i=0;i<3;i++)bytes[at+i]=alpha?Math.round(sum[i]/alpha):0
    bytes[at+3]=Math.round(255*alpha/(samples*samples))
  }
  const header=Buffer.alloc(13)
  header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;header[9]=6
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(bytes)),chunk('IEND',Buffer.alloc(0))])
}
export function faviconSvg() {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="M8 15 L9 4 L15 10 Z M24 15 L23 4 L17 10 Z" fill="#82796a"/><path d="M6 15 C6 9 10 8 16 8 C22 8 26 9 26 15 Z" fill="#82796a"/><rect x="3" y="13" width="26" height="17" rx="5" fill="#f6a06b"/><rect x="3" y="13" width="26" height="5" rx="2.5" fill="rgba(32,30,29,.16)"/></svg>\n'
}
if (process.argv[1]===fileURLToPath(import.meta.url)) {
  const publicDir=new URL('../web/public/',import.meta.url)
  await Promise.all([
    writeFile(new URL('favicon.svg',publicDir),faviconSvg()),
    writeFile(new URL('favicon-32.png',publicDir),iconPng(32,false)),
    ...[[180,'apple-touch-icon.png'],[192,'icon-192.png'],[512,'icon-512.png']].map(([size,name])=>writeFile(new URL(name,publicDir),iconPng(size))),
  ])
  console.log('Generated flat SVG/32px favicon, 180px apple touch and 192/512px maskable icons.')
}
