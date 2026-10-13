import { test, expect } from '@playwright/test'
test('Entry, signup and password recovery are accessible without horizontal overflow', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'Bom ter você por aqui.' })).toBeVisible()
  await expect(page.getByLabel('E-mail', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Crie sua conta', exact: true }).click()
  await expect(page.getByLabel('Como podemos chamar você?')).toBeVisible()
  await page.getByRole('button', { name: 'Entre aqui', exact: true }).click()
  await page.getByRole('button', { name: 'Esqueceu a senha?' }).click()
  await expect(page.getByRole('heading', { name: 'Vamos recuperar o acesso.' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  expect(errors).toEqual([])
  await page.screenshot({
    path: `test-results/entry-${test.info().project.name}.png`,
    fullPage: true,
  })
})
test('Hash routes load the app directly, including on a repository subpath', async ({ page }) => {
  await page.goto('./#/channel/11111111-1111-4111-8111-111111111111')
  await expect(page.getByRole('heading', { name: 'Bom ter você por aqui.' })).toBeVisible()
})
