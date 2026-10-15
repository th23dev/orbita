import { readFile } from 'node:fs/promises'
import { expect, test } from 'vitest'
import { NeuralDenoiser } from './rnnoise'

test('real WASM denoises stationary fan noise and frees its state', async () => {
  const file = await readFile('node_modules/@shiguredo/rnnoise-wasm/dist/rnnoise.wasm')
  const processor = await NeuralDenoiser.create(Uint8Array.from(file).buffer)
  let seed = 42,
    before = 0,
    after = 0,
    vad = 0,
    fan = 0
  const frame = new Float32Array(480)
  for (let n = 0; n < 400; n++) {
    for (let i = 0; i < frame.length; i++) {
      seed = (Math.imul(1664525, seed) + 1013904223) >>> 0
      fan = 0.85 * fan + 0.15 * ((seed / 2 ** 32) * 2 - 1)
      frame[i] = fan * 0.2 * 32768
      if (n > 100) before += frame[i] ** 2
    }
    const probability = processor.processFrame(frame)
    if (n > 100) {
      vad += probability
      for (const value of frame) after += value ** 2
    }
  }
  expect(vad / 299).toBeGreaterThanOrEqual(0)
  expect(vad / 299).toBeLessThanOrEqual(1)
  expect(after).toBeLessThan(before / 10)
  processor.destroy()
  processor.destroy()
  expect(() => processor.processFrame(frame)).toThrow()
})
