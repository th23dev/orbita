// Credentials stay in process memory and are sent only to api.github.com.
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
const result = spawnSync('git', ['credential', 'fill'], {
  input: 'protocol=https\nhost=github.com\n\n',
  encoding: 'utf8',
  env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' },
  windowsHide: true,
})
const values = Object.fromEntries(
  (result.stdout || '')
    .trim()
    .split('\n')
    .map((line) => {
      const i = line.indexOf('=')
      return [line.slice(0, i), line.slice(i + 1)]
    }),
)
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || values.password
if (!token) {
  console.log(
    'GITHUB_AUTH_UNAVAILABLE: GitHub CLI login or a credential-manager login is required to create a repository.',
  )
  process.exit(2)
}
const request = async (path, method = 'GET', body) => {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok)
    throw new Error(`GitHub ${method} ${path}: ${res.status} ${(await res.json()).message}`)
  return res.status === 204 ? {} : res.json()
}
const user = await request('/user')
console.log(`Authenticated GitHub account: ${user.login}`)
if (user.login.toLowerCase() !== 'th23dev')
  throw new Error('The local GitHub account differs from the authorized account. No changes made.')
if (process.argv[2] === 'create') {
  let repo
  const existing = await fetch('https://api.github.com/repos/th23dev/orbita', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  })
  if (existing.status === 404)
    repo = await request('/user/repos', 'POST', {
      name: 'orbita',
      description: 'Órbita — comunicação em tempo real com React, Supabase e LiveKit.',
      private: false,
      auto_init: false,
    })
  else if (existing.ok)
    throw new Error('Repository orbita already exists. Inspect it before proceeding.')
  else throw new Error(`Repository lookup failed: ${existing.status}`)
  console.log(`Created repository: ${repo.html_url}`)
}
if (process.argv[2] === 'pages') {
  await request('/repos/th23dev/orbita/pages', 'POST', { build_type: 'workflow' })
  console.log('GitHub Pages enabled with GitHub Actions.')
}
if (process.argv[2] === 'configure-supabase') {
  const env = Object.fromEntries(
    (await readFile('.env.local', 'utf8'))
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const i = line.indexOf('=')
        return [line.slice(0, i), line.slice(i + 1)]
      }),
  )
  if (
    env.VITE_SUPABASE_URL !== 'https://wjzirjfoaabpmyehzbtb.supabase.co' ||
    !env.VITE_SUPABASE_PUBLISHABLE_KEY?.startsWith('sb_publishable_')
  )
    throw new Error('Expected the public configuration of the new Orbita project.')
  const existing = await request('/repos/th23dev/orbita/actions/variables')
  for (const name of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY']) {
    const present = existing.variables.some((variable) => variable.name === name)
    await request(
      `/repos/th23dev/orbita/actions/variables${present ? `/${name}` : ''}`,
      present ? 'PATCH' : 'POST',
      { name, value: env[name] },
    )
    console.log(`Configured GitHub Actions variable: ${name}`)
  }
}
