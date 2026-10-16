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

test('own screen preview is opt-in, never stops the capture, and cannot recurse in fullscreen', async ({
  page,
}) => {
  await page.goto('/')
  await page.evaluate(async () => {
    const { mountStreamPlayer } = await import(
      /* @vite-ignore */ '/tests/fixtures/stream-player.tsx'
    )
    mountStreamPlayer(true)
  })
  await expect(page.getByText('Sua tela está sendo transmitida', { exact: true })).toBeVisible()
  await expect(page.locator('.stream-player video')).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Tela cheia da transmissão', exact: true }),
  ).toHaveCount(0)
  await page.getByRole('button', { name: 'Mostrar minha prévia', exact: true }).last().click()
  await expect(page.locator('.stream-player video')).toHaveCount(1)
  await page.locator('.stream-label > span').dblclick()
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull()
  await page.getByRole('button', { name: 'Ocultar minha prévia', exact: true }).click()
  await expect(page.locator('.stream-player video')).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).previewCapture.readyState)).toBe('live')
  await page.evaluate(() => (window as any).unmountStreamPlayer())
  expect(await page.evaluate(() => (window as any).previewCapture.readyState)).toBe('ended')
})

test('screen capture forwards unprocessed shared audio and keeps local playback enabled', async ({
  page,
}) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const { Room } = await import(/* @vite-ignore */ '/node_modules/.vite/deps/livekit-client.js')
    const { screenCaptureOptions } = await import(/* @vite-ignore */ '/src/lib/screen-quality.ts')
    let captured: unknown
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', {
      configurable: true,
      value: async (options: unknown) => {
        captured = options
        const canvas = document.createElement('canvas')
        canvas.width = 640
        canvas.height = 360
        canvas.getContext('2d')!.fillRect(0, 0, 640, 360)
        return canvas.captureStream(5)
      },
    })
    const room = new Room()
    const tracks = await room.localParticipant.createScreenTracks(screenCaptureOptions('1080p60'))
    const hint = tracks[0].mediaStreamTrack.contentHint
    tracks.forEach((track: { stop: () => void }) => track.stop())
    await room.disconnect()
    return { captured, hint }
  })
  expect(result.captured).toMatchObject({
    audio: {
      echoCancellation: false,
      autoGainControl: false,
      noiseSuppression: false,
      suppressLocalAudioPlayback: false,
    },
    selfBrowserSurface: 'exclude',
  })
  expect(result.hint).toBe('motion')
})
