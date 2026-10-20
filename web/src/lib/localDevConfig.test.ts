import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

it('never defines the opt-in local auth flag in Wrangler config, including every environment',()=>{
  const config=JSON.parse(readFileSync(new URL('../../../wrangler.jsonc',import.meta.url),'utf8')) as {vars:Record<string,unknown>;env:Record<string,{vars:Record<string,unknown>}>}
  for (const vars of [config.vars,...Object.values(config.env).map(value=>value.vars)]) expect(vars).not.toHaveProperty('LOCAL_DEV_AUTH')
  expect(JSON.stringify(config)).not.toContain('DEV_MAIL_CONSOLE')
})
