import { afterEach, expect, it, vi } from 'vitest'
import { ApiError, apiFetch, errorMessage } from './api'
import { uploadPhoto } from './photos'

afterEach(()=>vi.restoreAllMocks())

it('shows specific limit-reached copy without an upgrade, billing prompt or duplicated numeric policy', () => {
  const terms: Record<string,string> = {
    owned_caches:'own',new_caches_per_day:'last 24 hours',member_caches:'in the maximum',cache_members:'active members',
    owned_items:'library',open_requests:'pending asks',photos_per_item:'photo allowance',profile_photos:'profile photo',
  }
  for(const [limit,term] of Object.entries(terms)) {
    const message = errorMessage(new ApiError(409,'limit_reached',undefined,limit))
    expect(message).toContain('Limit reached')
    expect(message).toContain(term)
    expect(message).not.toMatch(/upgrade|billing|checkout|\bplus\b/i)
  }
})

it('decodes the stable 409 limit metadata from authenticated JSON calls', async () => {
  const fetchMock = vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({error:'limit_reached',limit:'owned_items'},{status:409}))
  let failure: unknown
  try { await apiFetch('/api/me/items',{body:{title:'Tool',is_consumable:false}}) } catch(error) { failure = error }
  expect(failure).toMatchObject({status:409,code:'limit_reached',limit:'owned_items'})
  expect(errorMessage(failure)).toContain('your item library is full')
  expect(fetchMock).toHaveBeenCalledWith('/api/me/items',expect.objectContaining({credentials:'same-origin',method:'POST'}))
})

it('preserves photo-upload limit metadata and rejects untrusted message lookup keys safely', async () => {
  vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({error:'limit_reached',limit:'photos_per_item'},{status:409}))
  await expect(uploadPhoto(null,'item',new Blob(['JPEG'],{type:'image/jpeg'}))).rejects.toMatchObject({status:409,code:'limit_reached',limit:'photos_per_item'})
  for(const limit of [undefined,'unknown','__proto__','constructor','<script>alert(1)</script>']) {
    expect(errorMessage(new ApiError(409,'limit_reached',undefined,limit))).toBe('Limit reached: this action exceeds the current allowance.')
  }
  expect(errorMessage(new ApiError(503,'limits_unavailable'))).toBe('Could not check the limits. Please try again later.')
})
