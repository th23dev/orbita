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
  browser = await chromium.launch({
    headless: true,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  })
  const pages = []
  await mkdir('test-results', { recursive: true })
  for (let i = 0; i < actors.length; i++) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 960 },
      permissions: ['microphone', 'camera'],
    })
    const page = await context.newPage()
    pages.push(page)
    page.setDefaultTimeout(20000)
    page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))
    page.on('response', async (response) => {
      if (response.url().includes('/functions/v1/livekit-token')) {
        console.log('TOKEN HTTP:', response.status())
        if (response.status() !== 200)
          console.log('TOKEN ERROR:', (await response.json().catch(() => ({}))).error)
      }
    })
    page.on('console', (m) => {
      if (m.type() === 'error' && /CORS|Access-Control/.test(m.text()))
        console.log('CORS:', m.text())
    })
    await page.goto(baseUrl)
    await page.getByLabel('E-mail', { exact: true }).fill(actors[i].email)
    await page.getByLabel('Senha', { exact: true }).fill(actors[i].password)
    await page.getByRole('button', { name: 'Entrar na Órbita', exact: true }).click()
    await page.getByRole('heading', { name: 'Na sua órbita' }).waitFor()
    await page.getByTitle('Design da chamada · QA', { exact: true }).click()
    await page.getByRole('button', { name: /^Sala de estar(?:\s|$)/ }).click()
    await page.getByRole('button', { name: 'Abrir sala de voz', exact: true }).click()
    await page.getByRole('button', { name: 'Microfone ligado', exact: true }).click()
    await page.getByRole('button', { name: 'Entrar na chamada', exact: true }).click()
    await page.getByRole('button', { name: 'Sair da chamada', exact: true }).waitFor({ timeout: 30000 })
    console.log('Joined test participant', i + 1)
  }
  const page = pages[0]
  await page.getByRole('button', { name: 'Soundboard', exact: true }).click()
  await page.getByRole('button', { name: 'Adicionar som', exact: true }).waitFor()
  // Exercise the actual upload/play path, then measure received PCM with the microphone muted.
  const samples = 48000 / 2
  const wav = Buffer.alloc(44 + samples * 2)
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(96000, 28)
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36)
  wav.writeUInt32LE(wav.length - 44, 40)
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / 48000) * 12000), 44 + i * 2)
  await page.locator('.soundboard-upload input').setInputFiles({ name: 'qa-tone.wav', mimeType: 'audio/wav', buffer: wav })
  await pages[1].waitForFunction(() => [...document.querySelectorAll('.call-audio audio')].some((audio) => audio.srcObject?.getAudioTracks().length))
  await pages[1].evaluate(async () => {
    const context = new AudioContext()
    await context.resume()
    window.qaSoundContext = context
    window.qaSoundAnalysers = [...document.querySelectorAll('.call-audio audio')].map((audio) => {
      const analyser = context.createAnalyser()
      context.createMediaStreamSource(audio.srcObject).connect(analyser)
      return analyser
    })
  })
  const play = page.getByRole('button', { name: 'Tocar qa-tone', exact: true })
  await play.click()
  await expect(play).toContainText('Reproduzindo')
  await pages[1].waitForFunction(() => window.qaSoundAnalysers.some((analyser) => {
    const samples = new Float32Array(analyser.fftSize)
    analyser.getFloatTimeDomainData(samples)
    return samples.some((sample) => Math.abs(sample) > 0.01)
  }))
  await pages[1].evaluate(() => window.qaSoundContext.close())
  await expect(play).not.toContainText('Reproduzindo')
  await expect(page.locator('.soundboard [role="alert"]')).toHaveCount(0)
  console.log('PASS: half-second clip, prepared track, remote audio with mic muted and playback state')
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
