import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'

// Browser behavior is isolated here; SQL acceptance and authorization run against PostgreSQL.
const env = existsSync('.env.local') ? readFileSync('.env.local', 'utf8') : ''
const api =
  process.env.VITE_SUPABASE_URL ||
  env
    .match(/VITE_SUPABASE_URL=(.+)/)?.[1]
    .trim()
    .replace(/['"]/g, '') ||
  ''
const ref = new URL(api || 'https://orbita-test.supabase.co').hostname.split('.')[0]
test.skip(!api, 'Requires a frontend Supabase URL; all requests are intercepted.')
const me = '11111111-1111-4111-8111-111111111111'
const friend = '22222222-2222-4222-8222-222222222222'
const server = '33333333-3333-4333-8333-333333333333'
const channel = '44444444-4444-4444-8444-444444444444'
const voice = '55555555-5555-4555-8555-555555555555'
const dm = '66666666-6666-4666-8666-666666666666'
const old = '77777777-7777-4777-8777-777777777777'
const reply = '88888888-8888-4888-8888-888888888888'
const alias = '99999999-9999-4999-8999-999999999999'
async function setup(page: Page, missingSchema = false) {
  let serverDeleted = false
  await page.routeWebSocket('**/realtime/v1/websocket*', () => {})
  const profiles = [
    {
      id: me,
      username: 'alice',
      display_name: 'Alice',
      bio: 'Olá!',
      status: 'online',
      avatar_path: null,
    },
    {
      id: friend,
      username: 'bob',
      display_name: 'Bob',
      bio: 'Gosto de música e programação.',
      status: 'busy',
      avatar_path: null,
    },
  ]
  const channels = [
    {
      id: channel,
      server_id: server,
      name: 'geral',
      kind: 'text',
      topic: 'Converse aqui',
      is_private: false,
      archived: false,
    },
    {
      id: voice,
      server_id: server,
      name: 'Sala de estar',
      kind: 'voice',
      topic: '',
      is_private: false,
      archived: false,
    },
  ]
  const oldMessage = {
    id: old,
    channel_id: channel,
    conversation_id: null,
    author_id: friend,
    content: 'Esta é a mensagem original antiga.',
    reply_to: null,
    created_at: '2026-01-01T00:00:00Z',
    edited_at: null,
    deleted_at: null,
  }
  const responseMessage = {
    ...oldMessage,
    id: reply,
    author_id: me,
    content: 'Concordo com você!',
    reply_to: old,
    created_at: '2026-10-13T12:00:00Z',
  }
  const calls: { name: string; body: Record<string, unknown> }[] = []
  let invitations = [
    {
      id: old,
      server_id: server,
      channel_id: channel,
      inviter_id: friend,
      invitee_id: me,
      server_name: 'Nossa turma',
      channel_name: 'geral',
      expires_at: '2099-01-01T00:00:00Z',
    },
  ]
  await page.addInitScript(
    ({ key, user }) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          access_token:
            'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMTExMTExMS0xMTExLTQxMTEtODExMS0xMTExMTExMTExMTEifQ.test',
          refresh_token: 'test-refresh',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
          token_type: 'bearer',
          user: {
            id: user,
            aud: 'authenticated',
            role: 'authenticated',
            email: 'alice@example.test',
            app_metadata: {},
            user_metadata: {},
          },
        }),
      )
    },
    { key: `sb-${ref}-auth-token`, user: me },
  )
  await page.route(`${api}/**`, async (route) => {
    const url = new URL(route.request().url())
    const name = url.pathname.split('/').pop()!
    const method = route.request().method()
    const body = method === 'POST' || method === 'PATCH' ? route.request().postDataJSON() : null
    let data: unknown = []
    if (url.pathname.includes('/rpc/')) {
      calls.push({ name, body: body || {} })
      if (name === 'create_dm') data = dm
      else if (name === 'create_community') data = channel
      else if (name === 'channel_people')
        data = [
          { user_id: me, role: 'owner' },
          { user_id: friend, role: 'member' },
        ]
      else if (name === 'respond_invite') {
        invitations = []
        data = server
      } else data = old
    } else if (name === 'profiles') data = profiles
    else if (name === 'servers') {
      if (method === 'DELETE' && url.searchParams.get('id') === `eq.${server}`) {
        serverDeleted = true
        channels.splice(0)
        calls.push({ name: 'delete_server', body: { id: server } })
        data = { id: server }
      } else data = serverDeleted ? [] : [{ id: server, name: 'Nossa turma', owner_id: me, description: '', icon_path: null }]
    }
    else if (name === 'channels') {
      if (method === 'DELETE') {
        const index = channels.findIndex((channel) => `eq.${channel.id}` === url.searchParams.get('id'))
        const removed = channels.splice(index, 1)[0]
        data = { id: removed.id }
        calls.push({ name: 'delete_channel', body: { id: removed.id } })
      } else if (method === 'PATCH') {
        Object.assign(
          channels.find((c) => `eq.${c.id}` === url.searchParams.get('id'))!,
          body,
        )
        data = { id: channel }
      } else data = channels
    } else if (name === 'server_members')
      data = [
        { server_id: server, user_id: me, ...(missingSchema ? {} : { access_role: 'member' }) },
        { server_id: server, user_id: friend, access_role: 'member' },
      ]
    else if (name === 'user_settings')
      data = { user_id: me, theme: 'dark', notifications: false, soundboard_volume: 0.5 }
    else if (name === 'friendships')
      data = [{ id: 'friendship', requester_id: me, addressee_id: friend, status: 'accepted' }]
    else if (name === 'direct_conversations')
      data = [
        { id: dm, name: 'Bob', created_by: me, canonical_id: null },
        { id: alias, name: 'Outra aba', created_by: me, canonical_id: dm },
      ]
    else if (name === 'direct_conversation_members')
      data = [dm, alias].flatMap((id) => [
        { conversation_id: id, user_id: me },
        { conversation_id: id, user_id: friend },
      ])
    else if (name === 'community_invites') data = invitations
    else if (name === 'messages') {
      if (url.searchParams.get('id')?.startsWith('eq.')) data = oldMessage
      else if (url.searchParams.has('id')) data = [oldMessage]
      else if (url.searchParams.get('created_at')?.startsWith('lte.')) data = [oldMessage]
      else if (url.searchParams.get('created_at')?.startsWith('gt.')) data = [responseMessage]
      else data = [responseMessage]
    }
    if (missingSchema && ['community_invites', 'channel_memberships'].includes(name)) {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'PGRST205', message: 'Table missing' }),
      })
      return
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) })
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Na sua órbita' })).toBeVisible()
  return { calls }
}
async function navigation(page: Page) {
  const button = page.getByRole('button', { name: 'Abrir navegação', exact: true })
  if (await button.isVisible()) await button.click()
}
async function chooseServer(page: Page) {
  await navigation(page)
  await page.getByRole('button', { name: 'Nossa turma', exact: true }).click()
}

test('Workspace still loads when the database update has not been applied', async ({ page }) => {
  await setup(page, true)
  await expect(
    page.getByText('Os novos convites e cargos estão aguardando', { exact: false }),
  ).toBeVisible()
  await expect(page.getByText('Bob', { exact: true }).last()).toBeVisible()
  await expect(page.getByText('column server_members.access_role does not exist')).toHaveCount(0)
})
test('Creation includes options and friend invitations; channel groups collapse and defaults can be renamed', async ({
  page,
}, info) => {
  const { calls } = await setup(page)
  await chooseServer(page)
  await navigation(page)
  const toggle = page.getByRole('button', { name: 'CANAIS DE TEXTO', exact: true })
  await toggle.click()
  await expect(page.getByRole('button', { name: 'geral', exact: true })).toBeHidden()
  await toggle.click()
  await expect(page.getByRole('button', { name: 'geral', exact: true })).toBeVisible()
  const voiceToggle = page.getByRole('button', { name: 'CANAIS DE VOZ', exact: true })
  await voiceToggle.click()
  await expect(page.getByRole('button', { name: 'Sala de estar', exact: true })).toBeHidden()
  await voiceToggle.click()
  await expect(page.getByRole('button', { name: 'Sala de estar', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Criar canal de texto' }).click()
  await page.getByLabel('Nome', { exact: true }).fill('projetos')
  await page.getByLabel('Descrição do canal').fill('Planejamento da turma')
  await page.getByLabel('Canal privado', { exact: false }).check()
  await page.getByLabel('Buscar na lista de amigos').fill('bob')
  await page.getByLabel('Convidar Bob', { exact: true }).check()
  await page.screenshot({
    path: `test-results/create-channel-${info.project.name}.png`,
    fullPage: true,
  })
  await page.getByRole('button', { name: 'Criar', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(calls.find((c) => c.name === 'create_community')?.body).toMatchObject({
    title: 'projetos',
    description: 'Planejamento da turma',
    restricted: true,
    people: [friend],
  })
  await navigation(page)
  await page.getByRole('button', { name: 'Configurações de geral', exact: true }).click()
  await page.getByLabel('Nome do canal').fill('boas-vindas')
  await page.getByRole('button', { name: 'Salvar alterações' }).click()
  await expect(page.getByText('Configurações salvas.')).toBeVisible()
  await page.getByRole('button', { name: 'Fechar', exact: true }).click()
  await expect(page.getByRole('button', { name: 'boas-vindas', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Convites e permissões' })).toHaveCount(0)
})
test('Replies name the author and navigate to an original outside the loaded history', async ({
  page,
}, info) => {
  await setup(page)
  await chooseServer(page)
  await expect(page.locator('.reply-preview')).toContainText('Bob')
  await expect(page.locator('.reply-preview')).toContainText('Esta é a mensagem original antiga.')
  await page.getByRole('button', { name: 'Ir à mensagem de Bob' }).click()
  await expect(page.locator(`#message-${old}`)).toHaveClass(/message-highlight/)
  await expect(page.locator(`#message-${old}`)).toBeInViewport()
  await page.screenshot({
    path: `test-results/reply-context-${info.project.name}.png`,
    fullPage: true,
  })
  await page.getByRole('button', { name: 'Voltar às mensagens recentes' }).click()
  await expect(page.locator('.history-context')).toHaveCount(0)
})
test('Profiles, styled confirmation dialogs and invitation decisions work', async ({
  page,
}, info) => {
  const { calls } = await setup(page)
  page.on('dialog', () => {
    throw new Error('Native JavaScript dialog must not be used')
  })
  await page.getByRole('button', { name: 'Ver perfil de Bob' }).click()
  await expect(page.getByRole('dialog')).toContainText('Gosto de música e programação.')
  await expect(page.getByRole('dialog')).toContainText('Ocupado')
  await page.screenshot({ path: `test-results/profile-${info.project.name}.png`, fullPage: true })
  await page.getByRole('button', { name: 'Fechar', exact: true }).click()
  await page.getByRole('button', { name: 'Remover amizade' }).click()
  await expect(page.getByRole('dialog')).toContainText('Remover amizade?')
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await navigation(page)
  await page.getByRole('button', { name: /^Convites/ }).click()
  await expect(page.getByRole('dialog')).toContainText('Aguardando sua decisão')
  await page.getByRole('button', { name: 'Aceitar convite' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(calls.find((c) => c.name === 'respond_invite')?.body).toMatchObject({
    invite_id: old,
    accept: true,
  })
})
test('Duplicate private conversations have only one sidebar entry', async ({ page }) => {
  await setup(page)
  await navigation(page)
  await expect(page.locator('.sidebar-link').filter({ hasText: 'Bob' })).toHaveCount(1)
  await expect(page.locator('.sidebar-link').filter({ hasText: 'Outra aba' })).toHaveCount(0)
})

test('Channel participant roles and removal use the custom dialog', async ({ page }) => {
  const { calls } = await setup(page)
  await chooseServer(page)
  await navigation(page)
  await page.getByRole('button', { name: 'Gerenciar servidor', exact: true }).click()
  const serverSettings = page.getByRole('dialog', { name: 'Gerenciar Nossa turma', exact: true })
  await serverSettings.getByRole('button', { name: 'Canais e acesso', exact: true }).click()
  await expect(serverSettings.getByRole('region', { name: 'Canais de texto' })).toBeVisible()
  await expect(serverSettings.getByRole('region', { name: 'Canais de voz' })).toBeVisible()
  await serverSettings.getByRole('textbox', { name: 'Buscar canais do servidor' }).fill('inexistente')
  await expect(serverSettings.getByText('Nenhum canal encontrado', { exact: true })).toBeVisible()
  await serverSettings.getByRole('button', { name: 'Limpar busca', exact: true }).click()
  expect(await serverSettings.locator('.user-settings-content').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({ path: `test-results/server-channels-${test.info().project.name}.png` })
  await serverSettings.getByRole('button', { name: 'Configurações de geral', exact: true }).click()
  const channelSettings = page.getByRole('dialog', { name: 'Configurações de geral', exact: true })
  await channelSettings.getByLabel('Cargo de Bob').selectOption('moderator')
  await expect.poll(() => calls.filter((c) => c.name === 'manage_membership').length).toBe(1)
  expect(calls.find((c) => c.name === 'manage_membership')?.body).toMatchObject({
    s: server,
    c: channel,
    target_user: friend,
    action: 'promote',
  })
  await channelSettings.getByRole('button', { name: 'Remover', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Remover participante?' })).toBeVisible()
  await page
    .getByRole('dialog', { name: 'Remover participante?' })
    .getByRole('button', { name: 'Remover', exact: true })
    .click()
  await expect.poll(() => calls.filter((c) => c.name === 'manage_membership').length).toBe(2)
  expect(calls.filter((c) => c.name === 'manage_membership')[1].body.action).toBe('remove')
  await page.getByRole('dialog', { name: 'Configurações de geral', exact: true }).getByRole('button', { name: 'Fechar', exact: true }).click()
  await expect(serverSettings.getByRole('textbox', { name: 'Buscar canais do servidor' })).toBeVisible()
})

for (const failure of [false, true]) test(`Server deletion handles confirmation and ${failure ? 'request failures' : 'returning home'}`, async ({ page }) => {
  const { calls } = await setup(page)
  await chooseServer(page)
  await navigation(page)
  await page.getByRole('button', { name: 'Gerenciar servidor', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Gerenciar Nossa turma' })
  await settings.getByRole('button', { name: 'Exclusão do servidor', exact: true }).click()
  await settings.getByRole('button', { name: 'Excluir servidor', exact: true }).click()
  const confirmation = page.getByRole('dialog', { name: 'Excluir o servidor Nossa turma?' })
  await expect(confirmation).toContainText('permanentemente')
  await confirmation.getByRole('button', { name: 'Cancelar', exact: true }).click()
  expect(calls.filter((call) => call.name === 'delete_server')).toHaveLength(0)
  if (failure) await page.route(`${api}/rest/v1/servers*`, async (route) => {
    if (route.request().method() === 'DELETE') await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: 'Exclusão não autorizada' }) })
    else await route.fallback()
  })
  await settings.getByRole('button', { name: 'Excluir servidor', exact: true }).click()
  await confirmation.getByRole('button', { name: 'Excluir servidor', exact: true }).click()
  if (failure) {
    await expect(page.getByText('Exclusão não autorizada', { exact: true })).toBeVisible()
    await expect(settings).toBeVisible()
    await expect(settings.getByRole('button', { name: 'Excluir servidor', exact: true })).toBeEnabled()
    expect(calls.filter((call) => call.name === 'delete_server')).toHaveLength(0)
  } else {
    await expect(settings).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Na sua órbita' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Nossa turma', exact: true })).toHaveCount(0)
    expect(calls.filter((call) => call.name === 'delete_server')).toEqual([{ name: 'delete_server', body: { id: server } }])
    expect(new URL(page.url()).hash).not.toContain(channel)
  }
})

test('Channel deletion requires confirmation and removes the channel from navigation', async ({ page }) => {
  const { calls } = await setup(page)
  await chooseServer(page)
  await navigation(page)
  await page.getByRole('button', { name: 'Configurações de geral', exact: true }).click()
  await page.getByRole('button', { name: 'Excluir canal', exact: true }).click()
  const confirmation = page.getByRole('dialog', { name: 'Excluir o canal geral?' })
  await expect(confirmation).toContainText('permanentemente')
  await confirmation.getByRole('button', { name: 'Cancelar', exact: true }).click()
  expect(calls.filter((call) => call.name === 'delete_channel')).toHaveLength(0)
  await page.getByRole('button', { name: 'Excluir canal', exact: true }).click()
  await confirmation.getByRole('button', { name: 'Excluir canal', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Configurações de geral', exact: true })).toHaveCount(0)
  expect(calls.filter((call) => call.name === 'delete_channel')).toEqual([{ name: 'delete_channel', body: { id: channel } }])
})

test('Audio menus and settings persist device-local choices on desktop and mobile', async ({ page }) => {
  await setup(page)
  await navigation(page)
  await page.getByRole('button', { name: 'Configurações de entrada', exact: true }).click()
  const quick = page.getByRole('dialog', { name: 'Entrada de áudio' })
  await expect(quick.getByLabel('Dispositivo de entrada')).toBeVisible()
  await expect(quick.getByRole('meter')).toBeVisible()
  await page.screenshot({ path: `test-results/audio-input-menu-${test.info().project.name}.png`, fullPage: true })
  await quick.getByRole('button', { name: 'Configurações de voz', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Voz e áudio' })
  await expect(settings).toBeVisible()
  await expect(settings.getByLabel('Dispositivo de saída')).toBeVisible()
  await settings.getByLabel('Personalizado', { exact: false }).check()
  await settings.getByLabel('Supressão de ruído').selectOption('strong')
  await settings.getByRole('switch', { name: 'Sensibilidade automática' }).uncheck()
  await settings.getByRole('slider', { name: 'Limiar de entrada' }).fill('-45')
  await settings.getByRole('slider', { name: 'Volume de saída' }).fill('65')
  expect(await settings.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({ path: `test-results/audio-settings-${test.info().project.name}.png`, fullPage: true })
  await settings.getByRole('switch', { name: 'Ganho automático' }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: `test-results/audio-processing-${test.info().project.name}.png`, fullPage: true })
  await settings.getByRole('button', { name: 'Fechar', exact: true }).click()
  await page.getByRole('button', { name: 'Configurações de saída', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Saída de áudio' }).getByRole('slider', { name: 'Volume de saída' })).toHaveValue('65')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Saída de áudio' })).toHaveCount(0)
  await page.reload()
  await navigation(page)
  await page.getByRole('button', { name: 'Configurações de entrada', exact: true }).click()
  await page.getByRole('button', { name: 'Configurações de voz', exact: true }).click()
  await expect(page.getByLabel('Supressão de ruído')).toHaveValue('strong')
  await expect(page.getByRole('slider', { name: 'Limiar de entrada' })).toHaveValue('-45')
})

test('Microphone test meters processed audio and releases capture when closed', async ({ page }) => {
  await setup(page)
  await page.evaluate(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
      const context = new AudioContext()
      await context.resume()
      const oscillator = context.createOscillator()
      oscillator.frequency.value = 220
      const gain = context.createGain()
      gain.gain.value = 0.1
      const output = context.createMediaStreamDestination()
      oscillator.connect(gain).connect(output)
      oscillator.start()
      Object.assign(window, { testCapture: { context, oscillator, track: output.stream.getAudioTracks()[0] } })
      return output.stream
    } })
  })
  await navigation(page)
  await page.getByRole('button', { name: 'Configurações de entrada', exact: true }).click()
  await page.getByRole('button', { name: 'Configurações de voz', exact: true }).click()
  // Meter/volume transport test uses a pure tone; neural suppression correctly rejects it as noise.
  await page.getByRole('radio', { name: /Estúdio/ }).check()
  await page.getByRole('button', { name: 'Teste do microfone', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Parar teste', exact: true })).toBeVisible()
  await expect.poll(async () => Number(await page.getByRole('meter').getAttribute('aria-valuenow'))).toBeGreaterThan(20)
  await page.getByRole('button', { name: 'Ouvir minha voz', exact: false }).click()
  await expect(page.getByRole('button', { name: 'Parar de ouvir minha voz', exact: false })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('slider', { name: 'Volume de entrada' }).fill('0')
  await expect.poll(async () => Number(await page.getByRole('meter').getAttribute('aria-valuenow'))).toBe(0)
  await page.getByRole('button', { name: 'Fechar', exact: true }).click()
  expect(await page.evaluate(() => (window as any).testCapture.track.readyState)).toBe('ended')
  await page.evaluate(async () => {
    (window as any).testCapture.oscillator.stop()
    await (window as any).testCapture.context.close()
  })
})

test('Quick audio menus refresh after permissions and share the settings device inventory', async ({ page }) => {
  await page.addInitScript(() => {
    const inventory = { authorized: false, output: 'Headset USB', input: 'Microfone USB', requests: 0, stopped: 0 }
    Object.assign(window, { audioInventory: inventory })
    Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', { configurable: true, value: async () => {
      inventory.requests++
      return inventory.authorized ? [
        { kind: 'audioinput', deviceId: 'mic-usb', label: inventory.input, groupId: 'usb' },
        { kind: 'audiooutput', deviceId: 'speaker-usb', label: inventory.output, groupId: 'usb' },
      ] : []
    } })
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
      inventory.authorized = true
      // Granting permission does not necessarily emit devicechange.
      return { getTracks: () => [{ stop: () => { inventory.stopped++ } }] }
    } })
  })
  await setup(page)
  await navigation(page)
  await page.getByRole('button', { name: 'Configurações de saída', exact: true }).click()
  const quick = page.getByRole('dialog', { name: 'Saída de áudio' })
  await expect(quick.getByLabel('Dispositivo de saída').locator('option')).toHaveCount(1)
  await quick.getByRole('button', { name: 'Configurações de voz', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Voz e áudio' })
  await settings.getByRole('button', { name: 'Permitir acesso e atualizar dispositivos' }).click()
  await expect(settings.getByLabel('Dispositivo de saída').locator('option')).toHaveText(['Padrão do sistema', 'Headset USB'])
  await expect(settings.getByLabel('Dispositivo de entrada').locator('option')).toHaveText(['Padrão do sistema', 'Microfone USB'])
  expect(await page.evaluate(() => (window as any).audioInventory.stopped)).toBe(1)
  await settings.getByRole('button', { name: 'Fechar', exact: true }).click()
  await page.getByRole('button', { name: 'Configurações de saída', exact: true }).click()
  await expect(quick.getByLabel('Dispositivo de saída').locator('option')).toHaveText(['Padrão do sistema', 'Headset USB'])
  await quick.getByLabel('Dispositivo de saída').selectOption('speaker-usb')
  await page.evaluate(() => {
    (window as any).audioInventory.output = 'Alto-falantes externos'
    navigator.mediaDevices.dispatchEvent(new Event('devicechange'))
  })
  await expect(quick.getByLabel('Dispositivo de saída').locator('option')).toHaveText(['Padrão do sistema', 'Alto-falantes externos'])
  await page.keyboard.press('Escape')
  await page.evaluate(() => { (window as any).audioInventory.input = 'Microfone atualizado' })
  await page.getByRole('button', { name: 'Configurações de entrada', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Entrada de áudio' }).getByLabel('Dispositivo de entrada').locator('option')).toHaveText(['Padrão do sistema', 'Microfone atualizado'])
})

test('Audio sheets fit a narrow phone and remain usable after rotation', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 640 })
  await setup(page)
  await navigation(page)
  await page.getByRole('button', { name: 'Configurações de entrada', exact: true }).click()
  const quick = page.getByRole('dialog', { name: 'Entrada de áudio' })
  await expect(quick).toBeVisible()
  const bounds = await quick.boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320)
  expect(bounds!.y).toBeGreaterThanOrEqual(0)
  await quick.getByRole('button', { name: 'Configurações de voz', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Voz e áudio' })
  await expect(settings).toBeVisible()
  expect(await settings.getByLabel('Dispositivo de entrada').evaluate((element) => getComputedStyle(element).fontSize)).toBe('16px')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: `test-results/audio-phone-${info.project.name}.png` })
  await page.getByRole('radio', { name: /Personalizado/ }).check()
  await page.getByLabel('Supressão de ruído').selectOption('strong')
  await page.setViewportSize({ width: 640, height: 320 })
  await expect(settings.getByRole('button', { name: 'Fechar', exact: true })).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await settings.getByRole('button', { name: 'Fechar', exact: true }).click()
  await expect(settings).toHaveCount(0)
})
