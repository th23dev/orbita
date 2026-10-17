// @ts-nocheck
import { test, expect } from '@playwright/test'
test('Role editor saves appearance and manages membership', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  let roles = [{ id: 'role-1', server_id: '11111111-1111-4111-8111-111111111111', name: 'Equipe', color: '#5865f2' }]
  let assignments = []
  let failSave = false
  await page.route('https://**/rest/v1/**', async route => {
    const req = route.request(), table = new URL(req.url()).pathname.split('/').pop(), method = req.method()
    if (table === 'set_default_role') {
      const { r } = req.postDataJSON()
      roles = roles.map(role => ({ ...role, is_default: role.id === r }))
      return route.fulfill({ json: null })
    }
    if (table === 'roles') {
      if (method === 'PATCH') {
        if (failSave) return route.fulfill({ status: 403, json: { message: 'Permission denied' } })
        roles[0] = { ...roles[0], ...req.postDataJSON() }
        return route.fulfill({ json: { id: roles[0].id } })
      }
      if (method === 'POST') { const role = { id: 'role-2', ...req.postDataJSON() }; roles.push(role); return route.fulfill({ json: role }) }
      if (method === 'DELETE') { roles = roles.filter(r => r.id !== 'role-2'); return route.fulfill({ json: { id: 'role-2' } }) }
      return route.fulfill({ json: roles })
    }
    if (table === 'member_roles') {
      if (method === 'POST') { assignments.push(req.postDataJSON()); return route.fulfill({ json: null }) }
      if (method === 'DELETE') { assignments = []; return route.fulfill({ json: { user_id: '11111111-1111-4111-8111-111111111111' } }) }
      return route.fulfill({ json: assignments })
    }
    return route.fulfill({ json: [] })
  })
  await page.goto('http://127.0.0.1:4173/')
  await page.evaluate(async () => {
    const { default: React } = await import('/node_modules/.vite/deps/react.js')
    const { default: { createRoot } } = await import('/node_modules/.vite/deps/react-dom_client.js')
    const { ServerAdmin } = await import('/src/components/ServerAdmin.tsx')
    const { DialogsProvider } = await import('/src/components/Dialogs.tsx')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const id = '11111111-1111-4111-8111-111111111111'
    root.render(React.createElement(DialogsProvider, null, React.createElement(ServerAdmin, {
      server: { id, owner_id: id, name: 'Nossa comunidade', description: 'Um lugar para conversar e jogar.', icon_path: null },
      channels: [], people: [{ id, display_name: 'Raffael', username: 'raffael', status: 'online' }], members: [{ user_id: id, access_role: 'admin' }], userId: id,
      close: () => root.unmount(), refresh: async () => {}, report: message => { throw Error(message) },
    })))
  })

  await page.getByRole('button', { name: 'Cargos', exact: true }).click()
  await expect(page.locator('.role-choice')).toHaveCount(1)
  await page.getByLabel('Nome do cargo', { exact: true }).fill('Moderadores')
  await page.getByRole('button', { name: 'Usar cor #ed4245' }).click()
  await page.getByRole('button', { name: /Salvar altera/ }).click()
  await expect(page.getByRole('status')).toContainText('salvas')
  expect(roles[0].name).toBe('Moderadores'); expect(roles[0].color).toBe('#ed4245')
  await page.getByRole('button', { name: 'Permissões', exact: true }).click()
  const sendPermission = page.getByRole('checkbox', { name: /Enviar mensagens/ })
  await expect(sendPermission).toBeChecked()
  await sendPermission.click()
  await expect(page.getByRole('status')).toContainText('Permissão salva')
  expect(roles[0].permissions.send_messages).toBe(false)
  await page.getByRole('checkbox', { name: /Transmitir tela/ }).click()
  await expect(page.getByRole('checkbox', { name: /Transmitir tela/ })).not.toBeChecked()
  expect(roles[0].permissions.share_screen).toBe(false)
  await page.getByRole('checkbox', { name: /Cargo padrão/ }).click()
  await expect(page.getByRole('status')).toContainText('Cargo padrão atualizado')
  expect(roles[0].is_default).toBe(true)
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.locator('.user-settings-content').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    const row = page.locator('.role-permission').first()
    const copy = await row.locator('.permission-copy').boundingBox()
    const toggle = await row.locator('input').boundingBox()
    expect(toggle.x).toBeGreaterThan(copy.x + copy.width)
    await page.locator('.role-permissions').screenshot({ path: `test-results/permissions-${width}.png` })
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('button', { name: 'Aparência', exact: true }).click()
  failSave = true
  await page.getByLabel('Nome do cargo', { exact: true }).fill('Falha')
  await page.getByRole('button', { name: /Salvar altera/ }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByLabel('Nome do cargo', { exact: true })).toHaveValue('Falha')
  await page.getByRole('button', { name: 'Redefinir', exact: true }).click()
  failSave = false
  await page.locator('.role-tabs').getByRole('button', { name: /Membros/ }).click()
  const checkbox = page.getByRole('checkbox', { name: 'Cargo Moderadores para Raffael' })
  await checkbox.click(); await expect(checkbox).toBeChecked(); expect(assignments).toHaveLength(1)
  await checkbox.click(); await expect(checkbox).not.toBeChecked(); expect(assignments).toHaveLength(0)
  await page.getByRole('button', { name: 'Criar cargo', exact: true }).click()
  await expect(page.getByLabel('Nome do cargo', { exact: true })).toHaveValue('Novo cargo')
  await page.getByRole('button', { name: 'Excluir cargo Novo cargo', exact: true }).click()
  await page.getByRole('button', { name: 'Excluir cargo', exact: true }).click()
  await expect(page.locator('.role-choice')).toHaveCount(1)
  await page.getByRole('button', { name: 'VIP', exact: true }).click()
  await expect(page.getByLabel('Nome do cargo', { exact: true })).toHaveValue('💎 VIP')
  await page.getByRole('button', { name: 'Usar emoji 🚀', exact: true }).click()
  await expect(page.getByLabel('Nome do cargo', { exact: true })).toHaveValue('🚀 VIP')
  await page.getByRole('button', { name: 'Sem emoji', exact: true }).click()
  await expect(page.getByLabel('Nome do cargo', { exact: true })).toHaveValue('VIP')
  await page.getByLabel('Código hexadecimal da cor').fill('#zzzzzz')
  await page.getByRole('button', { name: /Salvar altera/ }).click()
  expect(roles[0].name).toBe('Moderadores')
  await page.getByLabel('Código hexadecimal da cor').fill('#123abc')
  await page.getByRole('button', { name: /Salvar altera/ }).click()
  await expect(page.getByRole('status')).toContainText('salvas')
  expect(roles[0].color).toBe('#123abc')
  await page.getByRole('button', { name: 'Duplicar cargo VIP', exact: true }).click()
  await expect(page.getByLabel('Nome do cargo', { exact: true })).toHaveValue('VIP (cópia)')
  expect(roles[1].color).toBe('#123abc')
  expect(assignments).toHaveLength(0)
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.locator('.user-settings-content').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await page.screenshot({ path: `test-results/roles-${width}.png` })
  }
  expect(errors).toEqual([])
  console.log('PASS role creation, edit, color, save failure, reset, assign/remove member, delete confirmation and responsive layout')
})

