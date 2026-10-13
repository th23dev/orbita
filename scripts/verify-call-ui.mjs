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
    if (i === 0) {
      await page.getByRole('button', { name: 'Gerenciar servidor', exact: true }).click()
      const dialog = page.getByRole('dialog')
      const png = await page.evaluate(() => {
        const c = document.createElement('canvas')
        c.width = 128
        c.height = 128
        const x = c.getContext('2d')
        x.fillStyle = '#5865f2'
        x.fillRect(0, 0, 128, 128)
        x.fillStyle = 'white'
        x.font = 'bold 74px sans-serif'
        x.fillText('O', 35, 90)
        return c.toDataURL('image/png').split(',')[1]
      })
      await page
        .getByLabel('Logo do servidor', { exact: true })
        .setInputFiles({
          name: 'logo.png',
          mimeType: 'image/png',
          buffer: Buffer.from(png, 'base64'),
        })
      await expect(dialog.locator('.server-logo-image')).toBeVisible()
      await page.getByRole('button', { name: 'Remover logo', exact: true }).click()
      await expect(dialog.locator('.server-logo-image')).toHaveCount(0)
      await page
        .getByLabel('Logo do servidor', { exact: true })
        .setInputFiles({
          name: 'logo.png',
          mimeType: 'image/png',
          buffer: Buffer.from(png, 'base64'),
        })
      await expect(dialog.locator('.server-logo-image')).toBeVisible()
      await page
        .getByLabel('Descrição', { exact: true })
        .fill('Comunidade de teste com logo e acesso individual.')
      await page.getByRole('button', { name: 'Salvar identidade', exact: true }).click()
      await expect
        .poll(
          async () =>
            check(
              await actors[0].client.from('servers').select('description').eq('id', id).single(),
            ).description,
        )
        .toContain('acesso individual')
      const section = dialog
        .locator('.role-section')
        .filter({ has: page.getByText('Sala de estar', { exact: false }) })
      await section.getByLabel('Privado', { exact: true }).click()
      const access = page.getByLabel('Acesso de Luna · QA a Sala de estar', { exact: true })
      await expect(access).toBeVisible()
      const token = () =>
        actors[1].client.functions.invoke('livekit-token', {
          body: { channel_id: voice.id },
          headers: { Origin: origin },
        })
      if ((await token()).error?.context?.status !== 403)
        throw Error('Private voice must reject before grant')
      await access.click()
      await expect
        .poll(
          async () =>
            check(await actors[1].client.from('channels').select('id').eq('id', voice.id)).length,
        )
        .toBe(1)
      if (!(await token()).data?.token) throw Error('Individual voice grant did not issue token')
      await access.click()
      await expect
        .poll(
          async () =>
            check(await actors[1].client.from('channels').select('id').eq('id', voice.id)).length,
        )
        .toBe(0)
      if ((await token()).error?.context?.status !== 403)
        throw Error('Revoked voice grant must be rejected')
      await page.screenshot({ path: 'test-results/server-permissions-desktop.png' })
      await section.getByLabel('Privado', { exact: true }).click()
      await page.getByRole('button', { name: 'Fechar', exact: true }).click()
      console.log(
        'PASS: logo upload/removal/replacement, identity, individual voice permission grant/revoke',
      )
    }
    await expect(
      page.getByTitle('Design da chamada · QA', { exact: true }).locator('img'),
    ).toBeVisible()
    await expect(page.locator('.server-card')).toHaveCount(0)
    await page.getByRole('button', { name: 'Ocultar membros', exact: true }).click()
    await expect(page.getByRole('complementary', { name: 'Membros da comunidade' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Mostrar membros', exact: true }).click()
    await page.getByRole('button', { name: 'Fechar lista de membros', exact: true }).click()
    await page.getByRole('button', { name: 'Sala de estar', exact: true }).click()
    await page.getByRole('button', { name: 'Abrir sala de voz', exact: true }).click()
    await page.getByRole('button', { name: 'Entrar na chamada', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Microfone ligado', exact: true }).click()
    await expect(
      page.getByRole('button', { name: 'Microfone desligado', exact: true }),
    ).toBeVisible()
    await expect(page.getByLabel('Qualidade de transmissão')).toHaveCount(0)
    if (i === 0) {
      await page.screenshot({ path: 'test-results/call-lobby-desktop.png' })
      await page.getByRole('button', { name: 'Câmera desligada', exact: true }).click()
      await page.waitForFunction(
        () => document.querySelector('.call-preview video')?.videoWidth > 0,
      )
      await page.evaluate(() => {
        window.qaPreviewTrack = document
          .querySelector('.call-preview video')
          .srcObject.getVideoTracks()[0]
      })
      await page.getByRole('button', { name: 'Câmera ligada', exact: true }).click()
      await page.waitForFunction(() => window.qaPreviewTrack.readyState === 'ended')
      await page.getByRole('button', { name: 'Câmera desligada', exact: true }).click()
      await page.waitForFunction(
        () => document.querySelector('.call-preview video')?.videoWidth > 0,
      )
      await page.screenshot({ path: 'test-results/call-preview-camera.png' })
    }
    await page.getByRole('button', { name: 'Entrar na chamada', exact: true }).click()
    try {
      await page
        .getByRole('button', { name: 'Sair da chamada', exact: true })
        .waitFor({ timeout: 25000 })
    } catch {
      console.log('VISIBLE ALERTS:', await page.locator('.toast').allTextContents())
      throw Error('Call join failed')
    }
    await expect(page.getByRole('button', { name: 'Ligar microfone', exact: true })).toBeVisible()
  }
  const page = pages[0]
  await page.locator('.participant').nth(1).waitFor()
  await pages[1].waitForFunction(
    () => document.querySelector('.featured-camera video')?.videoWidth > 0,
  )
  await expect(pages[1].locator('.featured-camera')).toHaveCount(1)
  await page.getByRole('button', { name: 'Desligar câmera', exact: true }).click()
  await expect(pages[1].locator('.featured-camera')).toHaveCount(0)
  await page.getByRole('button', { name: 'Ligar câmera', exact: true }).click()
  await pages[1].waitForFunction(
    () => document.querySelector('.featured-camera video')?.videoWidth > 0,
  )
  await pages[1].getByRole('button', { name: 'Ligar câmera', exact: true }).click()
  await expect(page.locator('.featured-camera')).toHaveCount(0)
  await expect(page.locator('.participant .camera-stream video')).toHaveCount(2)
  await pages[1].getByRole('button', { name: 'Desligar câmera', exact: true }).click()
  await expect(page.locator('.featured-camera')).toHaveCount(1)
  await page.getByRole('button', { name: 'Ligar microfone', exact: true }).click()
  await page.getByRole('button', { name: 'Desligar microfone', exact: true }).click()
  await page.getByRole('button', { name: 'Ligar microfone', exact: true }).waitFor()
  await page.screenshot({ path: 'test-results/call-connected-desktop.png' })
  await expect(page.locator('.call-header')).toBeInViewport()
  await expect(page.locator('.workspace-header')).toBeInViewport()
  await page.getByRole('button', { name: 'Soundboard', exact: true }).click()
  await page.getByRole('button', { name: 'Adicionar som', exact: true }).waitFor()
  await page.screenshot({ path: 'test-results/call-soundboard-desktop.png' })
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Tela cheia', exact: true }).click()
  await page.getByRole('button', { name: 'Sair da tela cheia', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Sair da tela cheia', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'test-results/call-connected-mobile.png' })
  if (!(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)))
    throw Error('Mobile overflow')
  if (
    !(await page
      .locator('.participant')
      .evaluateAll((cards) =>
        cards.every((card) => card.getBoundingClientRect().right <= innerWidth),
      ))
  )
    throw Error('Participant cards overflow')
  await page.getByRole('button', { name: 'Soundboard', exact: true }).click()
  await page.screenshot({ path: 'test-results/call-soundboard-mobile.png' })
  await page.getByRole('button', { name: 'Fechar soundboard', exact: true }).click()
  await page.setViewportSize({ width: 1440, height: 960 })
  // Synthetic display capture only; UI and transmission still use the real LiveKit service.
  await page.evaluate(() => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement('canvas')
      canvas.width = 1920
      canvas.height = 1080
      const context = canvas.getContext('2d')
      window.qaScreenTimer = setInterval(() => {
        context.fillStyle = '#20252e'
        context.fillRect(0, 0, 1920, 1080)
        context.fillStyle = '#b7ef78'
        context.font = '64px sans-serif'
        context.fillText('Órbita · Transmissão de tela', 140, 450)
        context.font = '30px sans-serif'
        context.fillText(new Date().toLocaleTimeString(), 140, 520)
      }, 70)
      return canvas.captureStream(15)
    }
  })
  await page.getByRole('button', { name: 'Compartilhar tela', exact: true }).click()
  await expect(page.getByLabel('Qualidade de transmissão')).toBeVisible()
  await expect(pages[1].getByLabel('Qualidade de transmissão')).toBeVisible()
  await expect(page.locator('.featured-camera')).toHaveCount(0)
  await pages[1].waitForFunction(
    () => document.querySelector('.screen-stream video')?.videoWidth > 0,
  )
  await pages[1].getByLabel('Qualidade de transmissão').selectOption('720')
  await expect(pages[1].getByLabel('Qualidade de transmissão')).toHaveValue('720')
  await page.getByLabel('Qualidade de transmissão').selectOption('720')
  await expect(page.getByLabel('Qualidade de transmissão')).toHaveValue('720')
  await page.screenshot({ path: 'test-results/call-screen-desktop.png' })
  await page.getByRole('button', { name: 'Parar transmissão', exact: true }).click()
  await expect(page.getByLabel('Qualidade de transmissão')).toHaveCount(0)
  await expect(pages[1].getByLabel('Qualidade de transmissão')).toHaveCount(0)
  await expect(page.locator('.featured-camera')).toHaveCount(1)
  await page.evaluate(() => clearInterval(window.qaScreenTimer))
  await page.getByRole('button', { name: 'Sair da chamada', exact: true }).click()
  console.log(
    'PASS: members toggle, preview camera cleanup, muted join, remote camera, mic toggle, fullscreen, drawers, mobile layout, screen video and contextual quality controls',
  )
} catch (error) {
  if (browser)
    for (const context of browser.contexts())
      for (const page of context.pages()) {
        console.log('UI ALERTS:', await page.locator('.toast').allTextContents())
        console.log(
          'CAMERA:',
          await page
            .locator('video')
            .evaluateAll((videos) =>
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
  for (const id of users) check(await admin.auth.admin.deleteUser(id))
  console.log('Temporary accounts and server removed')
}
