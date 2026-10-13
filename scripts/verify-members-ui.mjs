// Opt-in integration test with temporary real users; no API mocks.
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

if (!process.argv.includes('--live')) {
  console.log('Use --live to verify membership and mobile UI with temporary accounts.')
  process.exit(0)
}
const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173/'
if (
  !['http://127.0.0.1:5173', 'http://localhost:5173', 'https://th23dev.github.io'].includes(
    new URL(base).origin,
  )
)
  throw Error('Use an approved Orbita origin')
const result = spawnSync(
  process.execPath,
  [
    resolve('node_modules/supabase/dist/supabase.js'),
    'projects',
    'api-keys',
    '--project-ref',
    'wjzirjfoaabpmyehzbtb',
    '--reveal',
    '--output',
    'json',
  ],
  { encoding: 'utf8', windowsHide: true, timeout: 60000 },
)
if (result.status !== 0) throw Error('Supabase CLI login required')
const keys = JSON.parse(result.stdout)
const url = 'https://wjzirjfoaabpmyehzbtb.supabase.co'
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(url, keys.find((key) => key.type === 'secret').api_key, options)
const pub = keys.find((key) => key.type === 'publishable').api_key
const check = ({ data, error }) => {
  if (error) throw Error(error.message)
  return data
}
const actors = []
const tag = randomUUID().slice(0, 8)
const serverName = `Mobile QA ${tag}`
let serverId, browser
async function login(page, actor, link = base) {
  await page.goto(link)
  await page.getByLabel('E-mail', { exact: true }).fill(actor.email)
  await page.getByLabel('Senha', { exact: true }).fill(actor.password)
  await page.getByRole('button', { name: 'Entrar na Órbita', exact: true }).click()
  await page.getByRole('heading', { name: 'Na sua órbita', exact: true }).waitFor()
}
async function noOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  if (await page.getByRole('dialog').count()) {
    expect(
      await page
        .getByRole('dialog')
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true)
  }
}
try {
  for (const label of ['Owner', 'Member', 'Guest']) {
    const email = `orbita-members-${randomUUID()}@example.invalid`,
      password = `${randomUUID()}A!1`
    const name = `${label} ${tag}`
    const { user } = check(
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: name },
      }),
    )
    actors.push({ user, email, password, name })
  }
  const owner = createClient(url, pub, options)
  check(
    await owner.auth.signInWithPassword({ email: actors[0].email, password: actors[0].password }),
  )
  serverId = check(
    await owner
      .from('servers')
      .insert({ name: serverName, owner_id: actors[0].user.id })
      .select('id')
      .single(),
  ).id
  const general = check(
    await owner.from('channels').select('id').eq('server_id', serverId).eq('kind', 'text').single(),
  )
  browser = await chromium.launch({ headless: true })
  const errors = []
  const pages = []
  for (const viewport of [
    { width: 1440, height: 960 },
    { width: 390, height: 844 },
    { width: 320, height: 740 },
  ]) {
    const context = await browser.newContext({ viewport })
    const page = await context.newPage()
    page.setDefaultTimeout(20000)
    page.on('pageerror', (error) => errors.push(error.message))
    pages.push(page)
  }
  const [alice, bob, guest] = pages
  await mkdir('test-results', { recursive: true })
  await login(alice, actors[0])
  await login(bob, actors[1])
  await expect(
    bob.getByRole('navigation', { name: 'Navegação principal no celular' }),
  ).toBeVisible()
  await bob.screenshot({ path: 'test-results/mobile-friends.png' })
  await alice.getByTitle(serverName, { exact: true }).click()
  await alice.getByRole('button', { name: 'Adicionar membros', exact: true }).click()
  const search = alice.getByLabel('Buscar pessoas para o servidor')
  await search.fill('zzzz_no_such_person_qa')
  await expect(alice.getByText('Nenhuma pessoa encontrada. Tente o @usuário.')).toBeVisible()
  await search.fill(actors[1].name)
  await alice
    .getByRole('button', { name: `Adicionar ${actors[1].name} ao servidor`, exact: true })
    .click()
  await expect(
    alice.getByRole('button', { name: `${actors[1].name} já é membro`, exact: true }),
  ).toBeDisabled()
  await expect
    .poll(
      async () =>
        check(await owner.from('server_members').select('user_id').eq('server_id', serverId))
          .length,
    )
    .toBe(2)
  const username = check(
    await admin.from('profiles').select('username').eq('id', actors[1].user.id).single(),
  ).username
  await search.fill(`@${username}`)
  await expect(
    alice.getByRole('button', { name: `${actors[1].name} já é membro`, exact: true }),
  ).toBeVisible()
  await alice.getByRole('button', { name: 'Criar link de convite', exact: true }).click()
  const inviteInput = alice.getByLabel('Link de convite', { exact: true })
  await expect(inviteInput).toBeVisible()
  const shared = await inviteInput.inputValue()
  expect(shared.startsWith('https://th23dev.github.io/orbita/#/invite/')).toBe(true)
  const code = shared.split('/invite/')[1]
  const localLink = `${base.replace(/#.*$/, '')}#/invite/${code}`
  await guest.goto(localLink)
  await expect(
    guest.getByText(
      'Você recebeu um convite para um servidor. Entre ou crie sua conta para continuar.',
    ),
  ).toBeVisible()
  await login(guest, actors[2], localLink)
  await expect(guest.getByRole('dialog')).toBeVisible()
  await expect(guest.getByLabel('Link ou código de convite')).toHaveValue(code)
  await noOverflow(guest)
  await guest.screenshot({ path: 'test-results/mobile-invite-accept.png' })
  await guest.getByRole('button', { name: 'Entrar no servidor', exact: true }).click()
  await expect(guest.getByRole('dialog')).toHaveCount(0)
  await expect
    .poll(
      async () =>
        check(await owner.from('server_members').select('user_id').eq('server_id', serverId))
          .length,
    )
    .toBe(3)
  await bob.getByRole('button', { name: 'Servidores e canais', exact: true }).click()
  await bob.getByTitle(serverName, { exact: true }).click()
  await expect(bob.getByRole('complementary', { name: 'Membros da comunidade' })).toHaveCount(0)
  const dock = bob.getByRole('navigation', { name: 'Navegação principal no celular' })
  await expect(dock).toBeVisible()
  await bob.getByRole('button', { name: 'Servidores e canais', exact: true }).click()
  await bob.screenshot({ path: 'test-results/mobile-navigation.png' })
  await bob
    .getByRole('button', { name: 'Fechar menu de navegação', exact: true })
    .click({ position: { x: 385, y: 400 } })
  await expect(
    bob.getByRole('button', { name: 'Servidores e canais', exact: true }),
  ).toHaveAttribute('aria-expanded', 'false')
  await bob.getByRole('button', { name: 'Mostrar membros', exact: true }).click()
  await bob.screenshot({ path: 'test-results/mobile-members.png' })
  await bob.getByRole('button', { name: 'Fechar lista de membros', exact: true }).click()
  check(
    await owner
      .from('messages')
      .insert({
        author_id: actors[0].user.id,
        channel_id: general.id,
        content: 'Uma conversa organizada no celular, com espaço para ler e responder.',
      }),
  )
  await expect(
    bob.getByText('Uma conversa organizada no celular, com espaço para ler e responder.', {
      exact: true,
    }),
  ).toBeVisible()
  await bob.getByRole('button', { name: 'Opções da mensagem', exact: true }).click()
  await expect(bob.getByRole('button', { name: 'Responder', exact: true })).toBeVisible()
  await noOverflow(bob)
  await bob.screenshot({ path: 'test-results/mobile-chat.png' })
  for (const width of [320, 390, 720]) {
    await bob.setViewportSize({ width, height: 844 })
    await noOverflow(bob)
    await expect(dock).toBeInViewport()
  }
  await alice.getByRole('button', { name: 'Fechar', exact: true }).click()
  await alice.setViewportSize({ width: 390, height: 844 })
  await alice.getByRole('button', { name: 'Servidores e canais', exact: true }).click()
  await alice.getByRole('button', { name: 'Adicionar membros', exact: true }).click()
  await alice.getByLabel('Buscar pessoas para o servidor').fill(actors[1].name)
  await expect(
    alice.getByRole('button', { name: `${actors[1].name} já é membro`, exact: true }),
  ).toBeVisible()
  await noOverflow(alice)
  await alice.screenshot({ path: 'test-results/mobile-add-members.png' })
  await alice.getByRole('button', { name: 'Revogar convite', exact: true }).click()
  await expect(alice.getByLabel('Link de convite', { exact: true })).toHaveCount(0)
  await guest.goto(localLink)
  await guest.getByRole('button', { name: 'Entrar no servidor', exact: true }).click()
  await expect(guest.getByRole('alert')).toContainText('Convite inválido ou expirado')
  expect(errors).toEqual([])
  console.log(
    'PASS: name/username search, owner addition, realtime membership, invite link through login, redemption/revocation, mobile navigation/chat/modals at 320/390/720px',
  )
} catch (error) {
  if (browser)
    for (const [index, context] of browser.contexts().entries())
      for (const page of context.pages()) {
        await page.screenshot({ path: `test-results/members-failure-${index}.png` })
        console.log('UI alerts:', await page.getByRole('alert').allTextContents())
      }
  throw error
} finally {
  await browser?.close()
  if (serverId) check(await admin.from('servers').delete().eq('id', serverId))
  for (const actor of actors) check(await admin.auth.admin.deleteUser(actor.user.id))
  console.log('Temporary server and accounts removed')
}
