// Import an authorized LiveKit CLI project into Supabase without logging credentials.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const projectRef = 'wjzirjfoaabpmyehzbtb'
const lk = process.env.LIVEKIT_CLI || resolve('.tools/livekit/lk.exe')
const supabase = resolve('node_modules/supabase/dist/supabase.js')
const run = (command, args, env = process.env) => {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60_000,
    env,
  })
  // Tool output may contain credentials. Never include it in errors.
  if (result.error || result.status !== 0)
    throw new Error(
      `Falha em ${command === lk ? 'LiveKit CLI' : 'Supabase CLI'} (${args[0]}). Verifique o login.`,
    )
  return result.stdout
}
const supabaseRun = (args) => run(process.execPath, [supabase, ...args])

try {
  const projects = JSON.parse(run(lk, ['project', 'list', '--json']))
  const selected = process.argv[2]
  const project = selected
    ? projects.find((item) => item.Name === selected)
    : projects.length === 1
      ? projects[0]
      : undefined
  if (!project)
    throw new Error(
      'Informe o nome do projeto LiveKit autorizado: node scripts/configure-livekit.mjs NOME',
    )
  const url = new URL(project.URL)
  if (
    url.protocol !== 'wss:' ||
    url.username ||
    url.password ||
    !project.APIKey ||
    !project.APISecret
  )
    throw new Error('O projeto precisa de URL wss:// e credenciais válidas.')
  const secrets = {
    LIVEKIT_URL: project.URL,
    LIVEKIT_API_KEY: project.APIKey,
    LIVEKIT_API_SECRET: project.APISecret,
    ALLOWED_ORIGINS: 'https://th23dev.github.io,http://127.0.0.1:5173,http://localhost:5173',
  }
  for (const value of Object.values(secrets))
    if (/[\r\n"\\]/.test(value))
      throw new Error('Formato inesperado nas credenciais; nenhuma alteração aplicada.')

  // Check the credentials against the actual server before changing Supabase.
  run(lk, ['room', 'list', '--json'], { ...process.env, ...secrets })
  console.log(`LiveKit autenticado: ${project.Name} (${url.origin}).`)
  await mkdir('.tools', { recursive: true })
  const temporaryDirectory = await mkdtemp(resolve('.tools/livekit-secrets-'))
  try {
    const envFile = join(temporaryDirectory, '.env')
    await writeFile(
      envFile,
      Object.entries(secrets)
        .map(([name, value]) => `${name}="${value}"`)
        .join('\n'),
      { mode: 0o600, flag: 'wx' },
    )
    supabaseRun(['secrets', 'set', '--project-ref', projectRef, '--env-file', envFile])
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
  const stored = JSON.parse(
    supabaseRun(['secrets', 'list', '--project-ref', projectRef, '--output', 'json']),
  )
  for (const [name, value] of Object.entries(secrets)) {
    const entry = stored.find((item) => item.name === name)
    if ((entry?.value || entry?.digest) !== createHash('sha256').update(value).digest('hex'))
      throw new Error(`Não foi possível confirmar o segredo ${name}.`)
    console.log(`${name}: gravado e verificado.`)
  }
  const endpoint = `https://${projectRef}.supabase.co/functions/v1/livekit-token`
  const preflight = await fetch(endpoint, {
    method: 'OPTIONS',
    headers: { Origin: 'https://th23dev.github.io' },
  })
  if (
    preflight.status !== 204 ||
    preflight.headers.get('access-control-allow-origin') !== 'https://th23dev.github.io'
  )
    throw new Error(
      `Preflight da função retornou ${preflight.status}. Aguarde a propagação e repita a verificação.`,
    )
  const unauthorized = await fetch(endpoint, {
    method: 'POST',
    headers: { Origin: 'https://th23dev.github.io', 'Content-Type': 'application/json' },
    body: '{}',
  })
  if (unauthorized.status !== 401)
    throw new Error(`Resposta de autenticação inesperada: ${unauthorized.status}.`)
  console.log('Função publicada: CORS válido e acesso sem sessão bloqueado (401).')
} catch (error) {
  console.error(
    error instanceof SyntaxError
      ? 'Nenhum projeto LiveKit autorizado foi encontrado. Execute lk cloud auth.'
      : error.message,
  )
  process.exitCode = 1
}
