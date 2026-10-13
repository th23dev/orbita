import { test, expect } from '@playwright/test'
// Supply two confirmed test accounts in an isolated Supabase project. No API mocking.
const ready = Boolean(
  process.env.E2E_ALICE_EMAIL &&
  process.env.E2E_ALICE_PASSWORD &&
  process.env.E2E_BOB_EMAIL &&
  process.env.E2E_BOB_PASSWORD,
)
test('Two authenticated browsers synchronize messages, edits, reactions and files', async ({
  browser,
}, info) => {
  test.skip(
    !ready || info.project.name === 'mobile',
    'Requires two real confirmed accounts and a configured Supabase project.',
  )
  const a = await browser.newContext(),
    b = await browser.newContext(),
    alice = await a.newPage(),
    bob = await b.newPage()
  const tag = Date.now().toString()
  try {
    for (const [page, email, password] of [
      [alice, process.env.E2E_ALICE_EMAIL, process.env.E2E_ALICE_PASSWORD],
      [bob, process.env.E2E_BOB_EMAIL, process.env.E2E_BOB_PASSWORD],
    ] as const) {
      await page.goto('./')
      await page.getByLabel('E-mail', { exact: true }).fill(email!)
      await page.getByLabel('Senha', { exact: true }).fill(password!)
      await page.getByRole('button', { name: 'Entrar na Órbita', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Na sua órbita' })).toBeVisible()
    }
    await alice.getByRole('button', { name: 'Criar servidor', exact: true }).first().click()
    await alice.getByLabel('Nome', { exact: true }).fill(`QA ${tag}`)
    await alice.getByRole('button', { name: 'Criar', exact: true }).click()
    await alice.getByRole('button', { name: 'Gerenciar servidor' }).click()
    await alice.getByRole('button', { name: 'Gerar convite' }).click()
    const code = await alice.locator('dialog code').first().innerText()
    await alice.getByRole('button', { name: 'Fechar', exact: true }).click()
    await bob.getByRole('button', { name: 'Entrar com convite' }).click()
    await bob.getByLabel('Código de convite').fill(code)
    await bob.getByRole('button', { name: 'Entrar no servidor', exact: true }).click()
    for (const page of [alice, bob])
      await page.getByRole('button', { name: 'geral', exact: true }).click()
    await expect(alice.getByText('Em tempo real', { exact: true })).toBeVisible()
    await expect(bob.getByText('Em tempo real', { exact: true })).toBeVisible()
    await alice.getByLabel('Mensagem', { exact: true }).fill(`Olá ${tag}`)
    await alice.getByRole('button', { name: 'Enviar mensagem' }).click()
    await expect(bob.getByText(`Olá ${tag}`, { exact: true })).toBeVisible()
    await bob.reload()
    await expect(bob.getByText(`Olá ${tag}`, { exact: true })).toBeVisible()
    const item = alice.locator('article').filter({ hasText: `Olá ${tag}` })
    await item.hover()
    await item.getByRole('button', { name: 'Editar mensagem' }).click()
    await item.locator('input').fill(`Editado ${tag}`)
    await item.getByRole('button', { name: 'Salvar edição' }).click()
    await expect(bob.getByText(`Editado ${tag}`, { exact: true })).toBeVisible()
    const remote = bob.locator('article').filter({ hasText: `Editado ${tag}` })
    await remote.hover()
    await remote.getByRole('button', { name: 'Reagir', exact: true }).click()
    await remote.getByRole('button', { name: '👍', exact: true }).click()
    await expect(item.locator('.reactions')).toContainText('👍')
    await alice
      .locator('input[type=file]')
      .setInputFiles({
        name: 'qa.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(`persistent-file-${tag}`),
      })
    await alice.getByRole('button', { name: 'Enviar mensagem' }).click()
    await expect(bob.getByText('qa.txt', { exact: true })).toBeVisible()
    const downloading = bob.waitForEvent('download')
    await bob.getByRole('button', { name: 'Baixar qa.txt' }).click()
    const downloaded = await downloading
    expect(downloaded.suggestedFilename()).toBe('qa.txt')
  } finally {
    await a.close()
    await b.close()
  }
})
