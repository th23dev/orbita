import { test, expect } from '@playwright/test'

test('registers and displays a system notification', async ({ page, context }) => {
  await context.grantPermissions(['notifications'])
  await page.goto('/')
  test.skip(await page.evaluate(() => Notification.permission !== 'granted'),
    'Use PLAYWRIGHT_CHANNEL=chromium or msedge; headless shell cannot display notifications.')
  const shown = await page.evaluate(async () => {
    const { showDesktopNotification } = await import(/* @vite-ignore */ '/src/lib/notifications.ts')
    return showDesktopNotification('Teste de notificação', { kind: 'channel', id: '00000000-0000-0000-0000-000000000001' }, () => {})
  })
  expect(shown).toBe(true)
  const notifications = await page.evaluate(async () => {
    const worker = await navigator.serviceWorker.ready
    const notifications = await worker.getNotifications()
    const titles = notifications.map((item) => item.title)
    notifications.forEach((item) => item.close())
    return titles
  })
  expect(notifications).toContain('Teste de notificação')
})
