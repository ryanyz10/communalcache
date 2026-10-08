import { it, expect, vi } from 'vitest'
import { env } from 'cloudflare:workers'
import { betterAuth } from 'better-auth'
import { authOptions } from '../src/auth'
import worker from '../src/index'
import { authRequest as request, mailMock, send, redeem } from './helpers'

it('rejects a superseded OTP and preserves INVALID_OTP 400 when wrong-code restoration overlaps resend', async () => {
  const email = 'restore-race@example.test'
  const codes = mailMock()
  await send(email)
  let started!: () => void
  let resume!: () => void
  const began = new Promise<void>(resolve => { started = resolve })
  const gate = new Promise<void>(resolve => { resume = resolve })
  const options = authOptions(env, undefined, '/api/auth/sign-in/email-otp')
  const failures: string[] = []
  const wrongAuth = betterAuth({
    ...options,
    onAPIError: { onError(error) {
      if (error instanceof Error) failures.push(error.message)
      options.onAPIError.onError(error)
    } },
    databaseHooks: { verification: { create: { async before(data) {
      // Pause the supported hook before real D1 INSERT; do not mock SQL.
      if (data.value.endsWith(':1')) { started(); await gate }
    } } } },
  })
  const wrong = codes[0] === '000000' ? '999999' : '000000'
  const verification = wrongAuth.handler(request('/sign-in/email-otp', { email, otp: wrong }))
  await began
  await send(email)
  const replacement = await env.DB.prepare('SELECT value FROM verification WHERE identifier = ?').bind(`sign-in-otp-${email}`).first('value')
  resume()
  const response = await verification
  expect(failures).toEqual(['D1_ERROR: UNIQUE constraint failed: verification.identifier: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)'])
  expect(response.status).toBe(400)
  expect(await response.json()).toMatchObject({ code: 'INVALID_OTP' })
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM verification WHERE identifier = ?').bind(`sign-in-otp-${email}`).first('n')).toBe(1)
  expect(await env.DB.prepare('SELECT value FROM verification WHERE identifier = ?').bind(`sign-in-otp-${email}`).first('value')).toBe(replacement)
  expect((await redeem(email, codes[0])).status).toBe(400)
  expect((await redeem(email, codes[1])).status).toBe(200)
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM session').first('n')).toBe(1)
})

it('overlapping same-email resends at the same millisecond retain only the newest stored OTP', async () => {
  const email = 'resend-tie@example.test'
  let started!: () => void
  let resume!: () => void
  const began = new Promise<void>(resolve => { started = resolve })
  const gate = new Promise<void>(resolve => { resume = resolve })
  const codes: string[] = []
  const completed: number[] = []
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-08T12:00:00Z'))
  try {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const mail = JSON.parse(init!.body as string) as { text: string }
      codes.push(mail.text.match(/\b\d{6}\b/)![0])
      const index = codes.length - 1
      if (index === 0) { started(); await gate }
      completed.push(index)
      return Response.json({ id: 'mock-mail' })
    })
    const older = send(email)
    await began
    const first = await env.DB.prepare('SELECT id, createdAt FROM verification').first<{ id: string; createdAt: string }>()
    await send(email)
    const latest = await env.DB.prepare('SELECT id, createdAt FROM verification').all<{ id: string; createdAt: string }>()
    expect(latest.results).toHaveLength(1)
    expect(latest.results[0].id).not.toBe(first!.id)
    expect(latest.results[0].createdAt).toBe(first!.createdAt)
    resume()
    await older
    expect(completed).toEqual([1, 0])
    expect((await redeem(email, codes[0])).status).toBe(400)
    expect((await redeem(email, codes[1])).status).toBe(200)
    expect((await redeem(email, codes[0])).status).toBe(400)
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM session').first('n')).toBe(1)
  } finally { vi.useRealTimers() }
})

it('does not classify unrelated verification database failures as INVALID_OTP', async () => {
  const email = 'database-failure@example.test'
  const codes = mailMock()
  expect((await worker.fetch(request('/email-otp/send-verification-otp', { email, type: 'sign-in' }), env)).status).toBe(200)
  await env.DB.exec("CREATE TRIGGER fail_restore BEFORE INSERT ON verification WHEN NEW.value LIKE '%:1' BEGIN SELECT RAISE(ABORT, 'injected unrelated verification failure'); END")
  const wrong = codes[0] === '000000' ? '999999' : '000000'
  const response = await worker.fetch(request('/sign-in/email-otp', { email, otp: wrong }), env)
  expect(response.status).toBe(503)
  expect(await response.json()).toEqual({ error: 'auth_unavailable' })
})
