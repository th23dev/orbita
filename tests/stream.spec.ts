import { expect, test } from '@playwright/test'

test('transmission uses native fullscreen for its video, exits and releases the player', async ({
  page,
}) => {
  await page.goto('/')
  await page.evaluate(async () => {
    const { mountStreamPlayer } = await import(
      /* @vite-ignore */ '/tests/fixtures/stream-player.tsx'
    )
    mountStreamPlayer()
  })
  await page.getByRole('button', { name: 'Tela cheia da transmissão', exact: true }).click()
  await expect
    .poll(() =>
      page.evaluate(() => document.fullscreenElement?.classList.contains('stream-player')),
    )
    .toBe(true)
  const bounds = await page.locator('.stream-player video').boundingBox()
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  expect(bounds?.x).toBe(0)
  expect(bounds?.y).toBe(0)
  expect(bounds?.width).toBeCloseTo(viewport.width, 0)
  expect(bounds?.height).toBeCloseTo(viewport.height, 0)
  await page.getByRole('button', { name: 'Sair da tela cheia da transmissão', exact: true }).click()
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true)
  await page.getByRole('button', { name: 'Tela cheia da transmissão', exact: true }).click()
  await page.evaluate(() => (window as any).unmountStreamPlayer())
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true)
  await expect(page.locator('.stream-player')).toHaveCount(0)
})
