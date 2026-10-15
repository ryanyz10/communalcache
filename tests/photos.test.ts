import { expect, it } from 'vitest'
import { env } from 'cloudflare:workers'
import worker from '../src/index'
import { MAX_PHOTO_BYTES, readPhoto } from '../src/photos'
import { appRequest, base, login } from './helpers'

const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/f9sAAAAASUVORK5CYII='), char => char.charCodeAt(0))
const jpeg = new Uint8Array([255,216,255,224,0,2,255,217])
const webp = new Uint8Array([82,73,70,70,12,0,0,0,87,69,66,80,86,80,56,76,0,0,0,0])
function upload(bytes: BodyInit = png, type = 'image/png', headers: Record<string,string> = {}) {
  return new Request(base+'/photo-fixture',{method:'POST',headers:{'Content-Type':type,...headers},body:bytes})
}

it('validates JPEG/PNG/WebP signatures and rejects SVG/MIME mismatch before any R2 call', async () => {
  for (const [bytes,type] of [[jpeg,'image/jpeg'],[png,'image/png'],[webp,'image/webp']] as const) expect(await readPhoto(upload(bytes,type))).toEqual({bytes,contentType:type})
  const svg = '<svg><script>alert(1)</script></svg>'
  for (const [bytes,type] of [[svg,'image/svg+xml'],[svg,'image/jpeg'],[png,'image/jpeg'],[new Uint8Array(),'image/png'],[png,'application/octet-stream'],[jpeg,'text/html']] as const) await expect(readPhoto(upload(bytes,type))).rejects.toMatchObject({status:415})
  expect((await env.BUCKET.list()).objects).toEqual([])
})

it('caps actual chunked bytes despite lying Content-Length and cancels before reading the rest', async () => {
  let pulls = 0, cancelled = false
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { pulls++; controller.enqueue(new Uint8Array(1024*1024)) },
    cancel() { cancelled = true },
  },{highWaterMark:0})
  await expect(readPhoto(upload(stream,'image/png',{'Content-Length':'1'}))).rejects.toMatchObject({status:413})
  expect(cancelled).toBe(true)
  expect(pulls).toBe(6)
  await expect(readPhoto(upload(png,'image/png',{'Content-Length':String(MAX_PHOTO_BYTES+1)}))).rejects.toMatchObject({status:413})
  const boundary = new Uint8Array(MAX_PHOTO_BYTES)
  boundary.set(png)
  expect((await readPhoto(upload(boundary))).bytes).toHaveLength(MAX_PHOTO_BYTES)
})

it('keeps non-member Worker photo reads 404 and Origin/profile guards intact', async () => {
  const caller = await login(), path = `/api/caches/${crypto.randomUUID()}/items/${crypto.randomUUID()}/photo`
  expect((await worker.fetch(appRequest(path),env)).status).toBe(404)
  expect((await worker.fetch(appRequest(path,{method:'POST',cookie:caller.cookie,body:{}}),env)).status).toBe(409)
  await worker.fetch(appRequest('/api/me',{method:'PATCH',cookie:caller.cookie,body:{display_name:'Neighbor'}}),env)
  for (const origin of [null,'null','https://foreign.test']) expect((await worker.fetch(appRequest(path,{method:'POST',cookie:caller.cookie,origin,body:{}}),env)).status).toBe(403)
  for (const method of ['GET','POST']) expect((await worker.fetch(appRequest(path,{method,cookie:caller.cookie}),env)).status).toBe(404)
  expect((await env.BUCKET.list()).objects).toEqual([])
})
