// Opt-in live regression: temporary accounts/server, synthetic display, real LiveKit transport.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { chromium, expect } from '@playwright/test'

if (!process.argv.includes('--live')) {
  console.log('Use --live with the local app running at http://127.0.0.1:5173.')
  process.exit(0)
}
const credentials = spawnSync(
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
  { encoding: 'utf8', windowsHide: true, timeout: 60_000 },
)
assert.equal(credentials.status, 0, 'Supabase CLI login required')
const keys = JSON.parse(credentials.stdout)
const url = 'https://wjzirjfoaabpmyehzbtb.supabase.co'
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(url, keys.find((key) => key.type === 'secret').api_key, options)
const publicKey = keys.find((key) => key.type === 'publishable').api_key
const check = ({ data, error }) => {
  if (error) throw Error(error.message)
  return data
}
const users = []
let serverId, browser
try {
  const actors = []
  for (const name of ['Screen Owner QA', 'Screen Viewer QA']) {
    const email = `orbita-screen-${randomUUID()}@example.invalid`
    const password = `${randomUUID()}A!1`
    const { user } = check(
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: name },
      }),
    )
    users.push(user.id)
    const client = createClient(url, publicKey, options)
    check(await client.auth.signInWithPassword({ email, password }))
    actors.push({ client, email, password })
  }
  const name = `Screen QA ${Date.now()}`
  serverId = check(
    await actors[0].client
      .from('servers')
      .insert({ name, owner_id: users[0] })
      .select('id')
      .single(),
  ).id
  check(await admin.from('server_members').insert({ server_id: serverId, user_id: users[1] }))
  // Real API regression for the reported permission error, restricted to this test server.
  assert.deepEqual(
    check(await actors[1].client.from('servers').delete().eq('id', serverId).select('id')),
    [],
  )

  browser = await chromium.launch({
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  })
  const pages = []
  for (const actor of actors) {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
    await context.addInitScript(() => {
      const NativePeer = window.RTCPeerConnection
      window.qaPeers = []
      window.RTCPeerConnection = class extends NativePeer {
        constructor(...args) {
          super(...args)
          window.qaPeers.push(this)
        }
      }
    })
    const page = await context.newPage()
    page.setDefaultTimeout(30_000)
    pages.push(page)
    await page.goto('http://127.0.0.1:5173')
    await page.getByLabel('E-mail', { exact: true }).fill(actor.email)
    await page.getByLabel('Senha', { exact: true }).fill(actor.password)
    await page.getByRole('button', { name: 'Entrar na Órbita', exact: true }).click()
    await page.getByRole('button', { name, exact: true }).click()
    await page.getByRole('button', { name: /^Sala de estar(?: |$)/ }).click()
    await page.getByRole('button', { name: 'Abrir sala de voz', exact: true }).click()
    await page.getByRole('button', { name: 'Microfone ligado', exact: true }).click()
    await page.getByRole('button', { name: 'Entrar na chamada', exact: true }).click()
    await page.getByRole('button', { name: 'Sair da chamada', exact: true }).waitFor()
    await expect(page.getByLabel('Qualidade de transmissão')).toHaveValue('1080p60')
    console.log(`Connected test participant ${pages.length}`)
  }
  const [sender, receiver] = pages
  await sender.evaluate(() => {
    window.qaPickerCalls = 0
    navigator.mediaDevices.getDisplayMedia = async (options) => {
      window.qaPickerCalls++
      window.qaCaptureOptions = options
      const canvas = document.createElement('canvas')
      canvas.width = 1920
      canvas.height = 1080
      const ctx = canvas.getContext('2d')
      let frame = 0
      window.qaAnimation = setInterval(() => {
        ctx.fillStyle = '#20252e'
        ctx.fillRect(0, 0, 1920, 1080)
        ctx.fillStyle = '#b7ef78'
        ctx.fillRect((frame++ * 12) % 1800, 400, 120, 120)
        ctx.font = '50px sans-serif'
        ctx.fillText(`Screen test ${frame}`, 120, 200)
      }, 1000 / 60)
      const stream = canvas.captureStream(60)
      window.qaCapture = stream.getVideoTracks()[0]
      return stream
    }
  })
  await sender.getByRole('button', { name: 'Compartilhar tela', exact: true }).click()
  await receiver.waitForFunction(
    () => document.querySelector('.stream-player video')?.videoWidth > 0,
  )
  await receiver.getByRole('button', { name: 'Tela cheia da transmissão', exact: true }).click()
  const encodings = () =>
    sender.evaluate(() =>
      window.qaPeers
        .flatMap((pc) => pc.getSenders())
        .filter((s) => s.track?.kind === 'video')
        .flatMap((s) => s.getParameters().encodings),
    )
  await expect
    .poll(async () =>
      (await encodings()).some((e) => e.maxFramerate === 60 && e.maxBitrate === 8_000_000),
    )
    .toBe(true)
  await receiver.waitForFunction(
    () => document.querySelector('.stream-player video')?.videoWidth === 1920,
  )
  const fps = await receiver.evaluate(async () => {
    const video = document.querySelector('.stream-player video')
    const before = video.getVideoPlaybackQuality().totalVideoFrames
    const start = performance.now()
    await new Promise((r) => setTimeout(r, 3000))
    return (
      ((video.getVideoPlaybackQuality().totalVideoFrames - before) * 1000) /
      (performance.now() - start)
    )
  })
  assert.ok(fps > 20, `Received ${fps.toFixed(1)} fps; should exceed the former 15 fps cap`)
  console.log(`PASS: real LiveKit 1080p transport, 60 fps encoder, received ${fps.toFixed(1)} fps`)
  await receiver.mouse.move(100, 100)
  await receiver
    .getByRole('button', { name: 'Sair da tela cheia da transmissão', exact: true })
    .click()
  await receiver.getByLabel('Qualidade para assistir').selectOption('480p30')
  await expect(receiver.getByLabel('Qualidade para assistir')).toHaveValue('480p30')
  console.log('Receiver selected 480p30')
  await sender.getByLabel('Qualidade de transmissão').selectOption('480p30')
  await expect(sender.getByLabel('Qualidade de transmissão')).toHaveValue('480p30')
  console.log('Publisher selected 480p30')
  await expect
    .poll(async () =>
      (await encodings()).some((e) => e.maxFramerate === 30 && e.maxBitrate === 1_000_000),
    )
    .toBe(true)
  await receiver.waitForFunction(
    () => document.querySelector('.stream-player video')?.videoWidth > 0,
  )
  await sender.getByLabel('Qualidade de transmissão').selectOption('1080p60')
  await expect
    .poll(async () =>
      (await encodings()).some((e) => e.maxFramerate === 60 && e.maxBitrate === 8_000_000),
    )
    .toBe(true)
  assert.equal(await sender.evaluate(() => window.qaPickerCalls), 1)
  assert.equal(await sender.evaluate(() => window.qaCapture.readyState), 'live')
  await expect(receiver.getByLabel('Qualidade para assistir')).toHaveValue('480p30')
  await sender.getByRole('button', { name: 'Parar transmissão', exact: true }).click()
  await expect(receiver.locator('.stream-player')).toHaveCount(0)
  assert.equal(await sender.evaluate(() => window.qaCapture.readyState), 'ended')
  await sender.evaluate(() => clearInterval(window.qaAnimation))
  console.log(
    'PASS: lower quality, restore 60 fps, independent receiver setting, single capture permission and cleanup',
  )
  await browser.close()
  browser = undefined
  const deleted = check(
    await actors[0].client.from('servers').delete().eq('id', serverId).select('id').single(),
  )
  assert.equal(deleted.id, serverId)
  assert.equal(check(await admin.from('channels').select('id').eq('server_id', serverId)).length, 0)
  serverId = undefined
  console.log('PASS: real API owner deletion, member denied, dependent channels removed')
} finally {
  await browser?.close()
  if (serverId) check(await admin.from('servers').delete().eq('id', serverId))
  for (const id of users) check(await admin.auth.admin.deleteUser(id))
  console.log('Temporary users and server removed')
}
