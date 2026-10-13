// Explicit live smoke test. Creates temporary users/server and cleans them up.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

if (!process.argv.includes('--live')) {
  console.log('Execute com --live para testar Supabase e LiveKit reais com dados temporários.')
  process.exit(0)
}
const projectRef = 'wjzirjfoaabpmyehzbtb'
const url = `https://${projectRef}.supabase.co`
const origin = 'https://th23dev.github.io'
const result = spawnSync(
  process.execPath,
  [
    resolve('node_modules/supabase/dist/supabase.js'),
    'projects',
    'api-keys',
    '--reveal',
    '--project-ref',
    projectRef,
    '--output',
    'json',
  ],
  { encoding: 'utf8', windowsHide: true, timeout: 60_000 },
)
if (result.status !== 0) throw new Error('Autentique a CLI Supabase antes de testar.')
const keys = JSON.parse(result.stdout)
const publicKey = keys.find((key) => key.type === 'publishable').api_key
const adminKey = keys.find((key) => key.type === 'secret').api_key
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(url, adminKey, options)
const users = []
let serverId, browser
const check = ({ data, error }) => {
  if (error) throw new Error(`Supabase: ${error.code || error.status || 'request failed'}`)
  return data
}
const tokenRequest = (token, channelId, requestOrigin = origin) =>
  fetch(`${url}/functions/v1/livekit-token`, {
    method: 'POST',
    headers: {
      apikey: publicKey,
      Authorization: `Bearer ${token}`,
      Origin: requestOrigin,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ channel_id: channelId }),
  })
try {
  const actors = []
  for (const name of ['Alice', 'Bob', 'Eve']) {
    const email = `orbita-livekit-${randomUUID()}@example.invalid`
    const password = `${randomUUID()}A!7`
    const { user } = check(
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: `QA ${name}` },
      }),
    )
    users.push(user.id)
    const client = createClient(url, publicKey, options)
    const { session } = check(await client.auth.signInWithPassword({ email, password }))
    actors.push({ user, client, session })
  }
  const [alice, bob, eve] = actors
  const server = check(
    await alice.client
      .from('servers')
      .insert({ owner_id: alice.user.id, name: `QA LiveKit ${Date.now()}` })
      .select()
      .single(),
  )
  serverId = server.id
  check(await admin.from('server_members').insert({ server_id: serverId, user_id: bob.user.id }))
  const channels = check(
    await alice.client.from('channels').select('id,kind').eq('server_id', serverId),
  )
  const voice = channels.find((channel) => channel.kind === 'voice')
  const text = channels.find((channel) => channel.kind === 'text')
  assert.equal(
    (await tokenRequest(eve.session.access_token, voice.id)).status,
    403,
    'Não membro bloqueado',
  )
  assert.equal(
    (await tokenRequest(alice.session.access_token, text.id)).status,
    403,
    'Canal de texto bloqueado',
  )
  assert.equal(
    (await tokenRequest(alice.session.access_token, voice.id, 'https://example.invalid')).status,
    403,
    'Origem desconhecida bloqueada',
  )
  assert.equal((await tokenRequest('invalid', voice.id)).status, 401, 'Sessão inválida bloqueada')
  const issued = []
  for (const actor of [alice, bob]) {
    const response = await tokenRequest(actor.session.access_token, voice.id)
    assert.equal(response.status, 200, 'Token deve ser emitido para membro autorizado')
    const data = await response.json()
    const claims = JSON.parse(Buffer.from(data.token.split('.')[1], 'base64url'))
    assert.equal(claims.sub, actor.user.id)
    assert.equal(claims.video.room, `orbita-${voice.id}`)
    assert.equal(claims.video.canPublishData, false)
    const issuedAt = claims.iat ?? claims.nbf
    assert.ok(
      Number.isFinite(issuedAt) && claims.exp - issuedAt > 0 && claims.exp - issuedAt <= 300,
    )
    issued.push(data)
  }
  console.log(
    'Auth real e tokens: dois membros autorizados; não membro, canal de texto, origem e sessão inválida bloqueados.',
  )

  browser = await chromium.launch({
    channel: process.platform === 'win32' ? 'msedge' : undefined,
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  })
  const pages = []
  for (const token of issued) {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(`${origin}/orbita/`)
    await page.addScriptTag({
      path: resolve('node_modules/livekit-client/dist/livekit-client.umd.js'),
    })
    await page.evaluate(async ({ url, token }) => {
      window.qaRoom = new LivekitClient.Room()
      await window.qaRoom.connect(url, token)
      await window.qaRoom.startAudio()
    }, token)
    pages.push(page)
  }
  await pages[1].waitForFunction(() => window.qaRoom.remoteParticipants.size === 1)
  // Publish an independent audio track, the same source used by the soundboard.
  await pages[0].evaluate(async () => {
    window.qaAudio = new AudioContext()
    await window.qaAudio.resume()
    const oscillator = window.qaAudio.createOscillator()
    const gain = window.qaAudio.createGain()
    gain.gain.value = 0.1
    const output = window.qaAudio.createMediaStreamDestination()
    oscillator.connect(gain).connect(output)
    gain.connect(window.qaAudio.destination)
    oscillator.start()
    window.qaOscillator = oscillator
    const track = new LivekitClient.LocalAudioTrack(
      output.stream.getAudioTracks()[0],
      undefined,
      false,
    )
    await window.qaRoom.localParticipant.publishTrack(track, {
      source: LivekitClient.Track.Source.Unknown,
      dtx: false,
      red: true,
    })
  })
  await pages[1].waitForFunction(() =>
    [...window.qaRoom.remoteParticipants.values()].some((participant) =>
      [...participant.audioTrackPublications.values()].some((publication) => publication.track),
    ),
  )
  await pages[1].evaluate(async () => {
    const participant = [...window.qaRoom.remoteParticipants.values()][0]
    const publication = [...participant.audioTrackPublications.values()].find(
      (publication) => publication.track,
    )
    const media = publication.track.attach()
    document.body.appendChild(media)
    await media.play()
    window.qaAudio = new AudioContext()
    await window.qaAudio.resume()
    const source = window.qaAudio.createMediaStreamSource(
      new MediaStream([publication.track.mediaStreamTrack]),
    )
    window.qaAnalyser = window.qaAudio.createAnalyser()
    source.connect(window.qaAnalyser)
    const silent = window.qaAudio.createGain()
    silent.gain.value = 0
    window.qaAnalyser.connect(silent).connect(window.qaAudio.destination)
  })
  await pages[1].waitForFunction(
    () => {
      const samples = new Float32Array(window.qaAnalyser.fftSize)
      window.qaAnalyser.getFloatTimeDomainData(samples)
      return (
        Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length) > 0.005
      )
    },
    undefined,
    { timeout: 30_000 },
  )
  console.log(
    'LiveKit WebRTC: dois navegadores conectados; sinal de áudio independente recebido e decodificado pelo segundo navegador.',
  )
  check(await alice.client.from('channels').update({ archived: true }).eq('id', voice.id))
  assert.equal(
    (await tokenRequest(alice.session.access_token, voice.id)).status,
    403,
    'Canal arquivado bloqueado',
  )
  console.log('Canal arquivado: nova entrada bloqueada.')
} finally {
  if (browser) await browser.close()
  if (serverId) check(await admin.from('servers').delete().eq('id', serverId))
  for (const id of users) check(await admin.auth.admin.deleteUser(id))
  console.log('Contas e servidor temporários removidos.')
}
