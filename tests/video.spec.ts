import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

async function mount(page: Page) {
  await page.evaluate(async () => {
    const { mountVideoSettings } = await import(/* @vite-ignore */ '/tests/fixtures/video-settings.tsx')
    mountVideoSettings()
  })
  await page.getByRole('navigation').getByRole('button', { name: 'Vídeo', exact: true }).click()
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    const state = {
      requests: [] as MediaStreamConstraints[], tracks: [] as MediaStreamTrack[],
      error: '', delay: false, release: () => {},
    }
    Object.assign(window, { cameraTest: state })
    Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', { configurable: true, value: async () => [
      { kind: 'videoinput', deviceId: 'usb-camera', label: 'Câmera USB', groupId: 'usb' },
    ] })
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async (constraints: MediaStreamConstraints) => {
      state.requests.push(constraints)
      if (state.error) throw new DOMException('Camera error', state.error)
      const canvas = document.createElement('canvas')
      canvas.width = 640; canvas.height = 360
      const context = canvas.getContext('2d')!
      context.fillStyle = '#233326'; context.fillRect(0, 0, 640, 360)
      context.fillStyle = '#b7ef78'; context.font = '32px sans-serif'; context.fillText('Prévia da câmera', 160, 180)
      const stream = canvas.captureStream(5)
      state.tracks.push(...stream.getTracks())
      if (state.delay) await new Promise<void>(resolve => { state.release = resolve })
      return stream
    } })
  })
  await mount(page)
})

test('video preferences persist and preview releases capture on stop and category changes', async ({ page }, info) => {
  expect(await page.evaluate(() => (window as any).cameraTest.requests.length)).toBe(0)
  await page.getByLabel('Câmera', { exact: true }).selectOption('usb-camera')
  await page.getByLabel('Qualidade da câmera').selectOption('1080')
  await page.getByRole('button', { name: 'Testar vídeo', exact: true }).click()
  await expect(page.getByText('Câmera ativa · prévia local', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => (window as any).cameraTest.requests[0])).toMatchObject({
    audio: false, video: { deviceId: { exact: 'usb-camera' }, height: { ideal: 1080 } },
  })
  await page.getByRole('switch', { name: /Espelhar minha prévia/ }).uncheck()
  await expect(page.getByLabel('Prévia da câmera')).not.toHaveClass('mirrored')
  expect(await page.evaluate(() => (window as any).cameraTest.requests.length)).toBe(1)
  await page.getByLabel('Qualidade da câmera').selectOption('480')
  await expect.poll(() => page.evaluate(() => (window as any).cameraTest.requests.length)).toBe(2)
  expect(await page.evaluate(() => (window as any).cameraTest.tracks[0].readyState)).toBe('ended')
  await expect(page.getByText('Câmera ativa · prévia local', { exact: true })).toBeVisible()
  await page.screenshot({ path: `test-results/video-settings-${info.project.name}.png` })
  expect(await page.locator('.user-settings-content').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await page.getByRole('button', { name: 'Parar teste de vídeo' }).click()
  expect(await page.evaluate(() => (window as any).cameraTest.tracks.every((track: MediaStreamTrack) => track.readyState === 'ended'))).toBe(true)
  await page.getByRole('button', { name: 'Testar vídeo', exact: true }).click()
  await expect(page.getByText('Câmera ativa · prévia local', { exact: true })).toBeVisible()
  await page.getByRole('navigation').getByRole('button', { name: 'Meu perfil', exact: true }).click()
  expect(await page.evaluate(() => (window as any).cameraTest.tracks.every((track: MediaStreamTrack) => track.readyState === 'ended'))).toBe(true)
  await page.reload()
  await mount(page)
  await expect(page.getByLabel('Câmera', { exact: true })).toHaveValue('usb-camera')
  await expect(page.getByLabel('Qualidade da câmera')).toHaveValue('480')
  await expect(page.getByRole('switch', { name: /Espelhar minha prévia/ })).not.toBeChecked()
})

test('video permission failures and late permission responses do not leave capture running', async ({ page }) => {
  await page.evaluate(() => { (window as any).cameraTest.error = 'NotAllowedError' })
  await page.getByRole('button', { name: 'Testar vídeo', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Permita o acesso à câmera')
  await page.evaluate(() => {
    (window as any).cameraTest.error = ''
    ;(window as any).cameraTest.delay = true
  })
  await page.getByRole('button', { name: 'Testar vídeo', exact: true }).click()
  await expect(page.getByText('Abrindo câmera…', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Fechar', exact: true }).click()
  await page.evaluate(() => (window as any).cameraTest.release())
  await expect.poll(() => page.evaluate(() => (window as any).cameraTest.tracks.every((track: MediaStreamTrack) => track.readyState === 'ended'))).toBe(true)
})
