import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:workers'
import { createAuth } from '../src/auth'
import { authRequest as request, mailMock, send, redeem } from './helpers'

describe('native Better Auth on real local D1', () => {
  it('stores hashed six-digit codes, signs up and refuses replay', async () => {
    const codes = mailMock()
    await send('first@example.test')
    expect(codes[0]).toMatch(/^\d{6}$/)
    const row = await env.DB.prepare('SELECT value, expiresAt, createdAt FROM verification').first<{value: string; expiresAt: string; createdAt: string}>()
    expect(row!.value).not.toContain(codes[0])
    const lifetime = new Date(row!.expiresAt).getTime() - new Date(row!.createdAt).getTime()
    expect(lifetime).toBeGreaterThan(299_000)
    expect(lifetime).toBeLessThanOrEqual(300_000)
    expect((await redeem('first@example.test', codes[0])).status).toBe(200)
    expect((await redeem('first@example.test', codes[0])).status).toBe(400)
    const user = await env.DB.prepare('SELECT id, display_name, email FROM user').first()
    expect(user!.display_name).toBeNull()
    expect(user!.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('rotates resend and enforces three incorrect attempts', async () => {
    const codes = mailMock()
    await send('rotate@example.test')
    await send('rotate@example.test')
    expect(codes[0]).not.toBe(codes[1])
    expect((await redeem('rotate@example.test', codes[0])).status).toBe(400)
    expect((await redeem('rotate@example.test', codes[1])).status).toBe(200)
    await send('budget@example.test')
    const wrong = codes[2] === '000000' ? '999999' : '000000'
    for (let i = 0; i < 3; i++) expect((await redeem('budget@example.test', wrong)).status).toBe(400)
    expect((await redeem('budget@example.test', codes[2])).status).toBe(403)
  })

  it('allows only one concurrent redemption across independent auth instances', async () => {
    const codes = mailMock()
    await send('race@example.test')
    const responses = await Promise.all(Array.from({length: 8}, () => redeem('race@example.test', codes[0])))
    expect(responses.filter(r => r.status === 200)).toHaveLength(1)
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM session').first('n')).toBe(1)
  })

  it('expires challenges without issuing sessions', async () => {
    const codes = mailMock()
    await send('expired@example.test')
    await env.DB.prepare('UPDATE verification SET expiresAt = ?').bind(new Date(Date.now() - 1_000).toISOString()).run()
    expect((await redeem('expired@example.test', codes[0])).status).toBe(400)
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM session').first('n')).toBe(0)
  })

  it('bounds concurrent wrong attempts without resetting the budget', async () => {
    const codes = mailMock()
    await send('attempts@example.test')
    const wrong = codes[0] === '000000' ? '999999' : '000000'
    const responses = await Promise.all(Array.from({length: 8}, () => redeem('attempts@example.test', wrong)))
    expect(responses.every(r => r.status === 400 || r.status === 403)).toBe(true)
    for (let i = 0; i < 3; i++) await redeem('attempts@example.test', wrong)
    expect((await redeem('attempts@example.test', codes[0])).status).not.toBe(200)
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM session').first('n')).toBe(0)
  })

  it('shares a strict concurrent send counter across independent instances', async () => {
    mailMock()
    const responses = await Promise.all(Array.from({length: 12}, (_, i) => createAuth(env).handler(request('/email-otp/send-verification-otp', { email: `limit${i}@example.test`, type: 'sign-in' }, '198.51.100.2'))))
    expect(responses.filter(r => r.status === 200)).toHaveLength(3)
    expect(responses.filter(r => r.status === 429)).toHaveLength(9)
    expect(await env.DB.prepare('SELECT count FROM rateLimit').first('count')).toBe(3)
    expect((await createAuth(env).handler(request('/email-otp/send-verification-otp', {email: 'later@example.test', type: 'sign-in'}, '198.51.100.2'))).status).toBe(429)
  })
})
