import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import ts from 'typescript'
import { expect, it } from 'vitest'

const root = new URL('../../../', import.meta.url)
const fields: Record<string, string[]> = {
  request: ['event', 'method', 'route', 'status', 'ms'],
  unhandled_error: ['event', 'route', 'name'],
  queue: ['event', 'messages', 'failed_batches'],
  scheduled: ['event', 'jobs', 'failed_jobs'],
  notification_enqueue_failed: ['event', 'count'],
  notification_processing_failed: ['event'],
  notification_delivery_failed: ['event', 'outbox_id', 'attempts', 'terminal'],
  photo_cleanup_failed: ['event', 'cleanup_id', 'oldest_pending_age_ms'],
}

it('pins explicit named-environment logs with invocation logs/traces off', () => {
  const config = ts.parseConfigFileTextToJson('wrangler.jsonc', readFileSync(new URL('wrangler.jsonc', root), 'utf8')).config
  for (const name of ['staging', 'production']) expect(config.env[name].observability).toEqual({
    enabled: true, redact_query_string: true,
    logs: { enabled: true, head_sampling_rate: 1, invocation_logs: false },
    traces: { enabled: false },
  })
  expect(config.observability).toBeUndefined()
})

it('audits production console events and pins the one guarded localhost mail exception', () => {
  const events = new Set<string>()
  let count = 0, localMailCount = 0
  function scan(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) { scan(path); continue }
      if (!path.endsWith('.ts')) continue
      const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
      function visit(node: ts.Node) {
        if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && ts.isIdentifier(node.expression) && node.expression.text === 'console') {
          const call = node.parent
          expect(ts.isCallExpression(call) && call.expression === node, `${path}: console aliases require review`).toBe(true)
          if (!ts.isCallExpression(call)) return
          const method = ts.isPropertyAccessExpression(node) ? node.name.text : node.argumentExpression.getText(source).replace(/['"]/g, '')
          if (path === fileURLToPath(new URL('src/auth-mail.ts',root)) && method === 'log') {
            const guard=call.parent.parent.parent
            expect(ts.isIfStatement(guard)).toBe(true)
            if (!ts.isIfStatement(guard)) return
            expect(guard.expression.getText(source)).toBe('localDevAuth(env,requestUrl) && !env.RESEND_API_KEY')
            expect(call.arguments).toHaveLength(1)
            expect(ts.isTemplateExpression(call.arguments[0])).toBe(true)
            expect(call.getText(source)).toContain('LOCAL DEV SIGN-IN MAIL')
            localMailCount++
            return
          }
          expect(['info', 'warn', 'error']).toContain(method)
          expect(call.arguments).toHaveLength(1)
          const object = call.arguments[0]
          expect(ts.isObjectLiteralExpression(object), path).toBe(true)
          if (!ts.isObjectLiteralExpression(object)) return
          const names = object.properties.map(property => property.name?.getText(source).replace(/['"]/g, ''))
          const event = object.properties.find(property => property.name?.getText(source) === 'event')
          expect(event && ts.isPropertyAssignment(event) && ts.isStringLiteral(event.initializer), path).toBe(true)
          if (!event || !ts.isPropertyAssignment(event) || !ts.isStringLiteral(event.initializer)) return
          const label = event.initializer.text
          expect(fields[label], `${path}: unreviewed event ${label}`).toBeDefined()
          expect(names).toEqual(fields[label])
          for (const property of object.properties) {
            if (!ts.isPropertyAssignment(property) || ts.isStringLiteral(property.initializer)) continue
            expect(property.initializer.getText(source), path).not.toMatch(/\b(?:email|display_name|token|otp|session|endpoint|p256dh|auth|target|key|ip|body|payload|headers|error)\b|request\.url/i)
          }
          events.add(label); count++
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
  }
  scan(fileURLToPath(new URL('src', root)))
  expect(count).toBe(9)
  expect(localMailCount).toBe(1)
  expect([...events].sort()).toEqual(Object.keys(fields).sort())
})

it('keeps Better Auth library logging disabled rather than risking provider/token error output', () => {
  const source = readFileSync(new URL('src/auth.ts', root), 'utf8')
  expect(source).toMatch(/logger:\s*\{\s*disabled:\s*true\s*\}/)
  expect(source).toContain('betterAuth(authOptions(env, delivery, requestPath, requestUrl))')
})
