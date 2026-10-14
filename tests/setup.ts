import { beforeEach, afterEach, vi } from 'vitest'
import { env } from 'cloudflare:workers'
import { reset, applyD1Migrations, type D1Migration } from 'cloudflare:test'

beforeEach(async () => {
  await reset()
  await applyD1Migrations(env.DB, (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS)
})
afterEach(() => { vi.restoreAllMocks() })
