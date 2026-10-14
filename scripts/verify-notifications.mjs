import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
// Opt-in integration test: real Auth, Storage, permissions and LiveKit transport.
// Chromium supplies a synthetic camera; only the display picker is replaced by canvas capture.
if (!process.argv.includes('--live')) {
  console.log('Use --live to run the UI test with temporary Supabase users and server.')
  process.exit(0)
}
const baseUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173/'
const origin = new URL(baseUrl).origin
if (
  !['http://127.0.0.1:5173', 'http://localhost:5173', 'https://th23dev.github.io'].includes(origin)
)
  throw Error('Use an approved Orbita origin for this live test.')
const r = spawnSync(
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
  { encoding: 'utf8', windowsHide: true },
)
if (r.status !== 0) throw Error('Supabase CLI login required')
const keys = JSON.parse(r.stdout)
const url = 'https://wjzirjfoaabpmyehzbtb.supabase.co'
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(url, keys.find((k) => k.type === 'secret').api_key, options)
const pub = keys.find((k) => k.type === 'publishable').api_key
const check = ({ data, error }) => {
  if (error) throw Error(error.message)
  return data
}
const users = []
let serverId, browser
try {
  const actors = []
  for (const name of ['Rafa · QA', 'Luna · QA']) {
    const email = `orbita-call-${randomUUID()}@example.invalid`,
      password = `${randomUUID()}A!1`
    const { user } = check(
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: name },
      }),
    )
    users.push(user.id)
    const client = createClient(url, pub, options)
    check(await client.auth.signInWithPassword({ email, password }))
    actors.push({ email, password, client, user })
  }
  const { id } = check(
    await actors[0].client
      .from('servers')
      .insert({ name: 'Design da chamada · QA', owner_id: users[0] })
      .select('id')
      .single(),
  )
  serverId = id
  check(await admin.from('server_members').insert({ server_id: id, user_id: users[1] }))
  const voice = check(
    await actors[0].client
      .from('channels')
      .select('id')
      .eq('server_id', id)
      .eq('kind', 'voice')
      .single(),
  )
  check(await admin.from('channel_memberships').upsert({
    channel_id: voice.id, server_id: id, user_id: users[1], status: 'accepted', role: 'member',
  }))
  const textChannel = check(await actors[0].client.from('channels').select('id').eq('server_id', id).eq('kind', 'text').single())
  check(await admin.from('channel_memberships').upsert({ channel_id: textChannel.id, server_id: id, user_id: users[1], status: 'accepted', role: 'member' }))
  check(await actors[1].client.from('user_settings').update({ notifications: true }).eq('user_id', users[1]))
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chromium' })
  const context = await browser.newContext({ permissions: ['notifications'] })
  const page = await context.newPage()
  let subscribed = false
  page.on('websocket', (socket) => socket.on('framereceived', ({ payload }) => {
    const data = String(payload)
    if (data.includes('notifications:') && data.includes('phx_reply') && data.includes('ok')) subscribed = true
  }))
  await page.goto(baseUrl)
  await page.getByLabel('E-mail', { exact: true }).fill(actors[1].email)
  await page.getByLabel('Senha', { exact: true }).fill(actors[1].password)
  await page.getByRole('button', { name: 'Entrar na Órbita', exact: true }).click()
  await expect.poll(() => subscribed, { timeout: 20000 }).toBe(true)
  await page.bringToFront()
  const send = async (content) => check(await actors[0].client.from('messages').insert({ author_id: users[0], channel_id: textChannel.id, content }))
  await send('QA notificação em primeiro plano')
  const notices = page.getByLabel('Notificações de mensagens')
  await expect(notices.getByText('Abrir conversa')).toBeVisible()
  await notices.getByRole('button').first().click()
  await expect(page.getByText('QA notificação em primeiro plano', { exact: true })).toBeVisible()
  await expect(notices.locator('.message-notification')).toHaveCount(0)
  await send('QA conversa ativa sem aviso')
  await expect(page.getByText('QA conversa ativa sem aviso', { exact: true })).toBeVisible()
  await expect(notices.locator('.message-notification')).toHaveCount(0)
  const background = await context.newPage()
  await background.goto('about:blank')
  await background.bringToFront()
  // Playwright forces focus in headless pages; release it to model a background window.
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false })
  console.log('Background notification state:', await page.evaluate(() => ({
    hidden: document.hidden, focused: document.hasFocus(), permission: Notification.permission,
  })))
  await send('QA notificação em segundo plano')
  await expect.poll(() => page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready
    return (await registration.getNotifications()).length
  }), { timeout: 15000 }).toBeGreaterThan(0)
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready
    for (const notification of await registration.getNotifications()) notification.close()
  })
  console.log('PASS: real Realtime event, in-app notification, open conversation, active-chat suppression and system notification')
} catch (error) {
  if (browser)
    for (const context of browser.contexts())
      for (const page of context.pages()) {
        console.log('UI ALERTS:', await page.locator('.toast').allTextContents())
        console.log(
          'CAMERA:',
          await page.locator('video').evaluateAll((videos) =>
            videos.map((v) => ({
              readyState: v.readyState,
              videoWidth: v.videoWidth,
              paused: v.paused,
              tracks: v.srcObject
                ?.getTracks()
                .map((t) => ({ kind: t.kind, readyState: t.readyState, muted: t.muted })),
            })),
          ),
        )
        await page.screenshot({ path: 'test-results/call-failure.png' })
      }
  throw error
} finally {
  await browser?.close()
  if (serverId) {
    const files = check(await admin.storage.from('server-icons').list(serverId))
    if (files.length)
      check(
        await admin.storage
          .from('server-icons')
          .remove(files.map((file) => `${serverId}/${file.name}`)),
      )
    check(await admin.from('servers').delete().eq('id', serverId))
  }
  for (const id of users) {
    const sounds = check(await admin.storage.from('sounds').list(id))
    if (sounds.length) check(await admin.storage.from('sounds').remove(sounds.map((sound) => `${id}/${sound.name}`)))
    check(await admin.auth.admin.deleteUser(id))
  }
  console.log('Temporary accounts and server removed')
}
