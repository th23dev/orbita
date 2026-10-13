import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const env = Object.fromEntries(
  (await readFile('.env.local', 'utf8'))
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const separator = line.indexOf('=')
      return [line.slice(0, separator), line.slice(separator + 1)]
    }),
)
const url = env.VITE_SUPABASE_URL
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY
assert.equal(url, 'https://wjzirjfoaabpmyehzbtb.supabase.co')
assert.ok(key?.startsWith('sb_publishable_'))
const settings = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } })
assert.equal(settings.status, 200, 'Public Auth endpoint should be reachable')
const auth = await settings.json()
console.log(
  `Auth endpoint: available; email provider=${auth.external?.email}; email confirmation required=${!auth.mailer_autoconfirm}`,
)
const profiles = await fetch(`${url}/rest/v1/profiles?select=id&limit=1`, {
  headers: { apikey: key },
})
assert.ok([401, 403].includes(profiles.status), 'Anonymous callers must not read profiles')
console.log(`Anonymous profile read correctly denied: HTTP ${profiles.status}`)
console.log(
  'Read-only backend checks passed. These checks do not validate signup or email delivery.',
)
