import { test, expect } from '@playwright/test'

for (const interrupted of [false, true]) test(`soundboard generates audible samples (interrupted: ${interrupted})`, async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async (interrupted) => {
    // Real Web Audio and WAV decoding; no Auth, Storage or remote data changes.
    const { Soundboard } = await import(/* @vite-ignore */ '/src/lib/soundboard.ts')
    const original = AudioContext.prototype.createGain
    AudioContext.prototype.createGain = function () {
      const gain = original.call(this)
      const analyser = this.createAnalyser()
      gain.connect(analyser)
      Object.assign(window, { soundContext: this, soundAnalyser: analyser })
      return gain
    }
    const samples = 48000 * 3
    const data = new ArrayBuffer(44 + samples * 2)
    const view = new DataView(data)
    const text = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)))
    text(0, 'RIFF'); view.setUint32(4, data.byteLength - 8, true); text(8, 'WAVEfmt ')
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
    view.setUint32(24, 48000, true); view.setUint32(28, 96000, true)
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data')
    view.setUint32(40, samples * 2, true)
    for (let i = 0; i < samples; i++) view.setInt16(44 + i * 2, Math.sin(i * 2 * Math.PI * 440 / 48000) * 12000, true)
    const board = new Soundboard()
    const button = document.createElement('button')
    button.textContent = 'Testar áudio local'
    button.onclick = () => {
      void board.play(async () => {
        if (interrupted) await (window as any).soundContext.suspend()
        return data.slice(0)
      }, 0.5).then(() => { (window as any).soundStarted = true })
    }
    document.body.appendChild(button)
    Object.assign(window, { soundBoard: board })
  }, interrupted)
  await page.getByRole('button', { name: 'Testar áudio local' }).click()
  await expect.poll(() => page.evaluate(() => {
    const analyser = (window as any).soundAnalyser as AnalyserNode | undefined
    if (!analyser) return 0
    const samples = new Float32Array(analyser.fftSize)
    analyser.getFloatTimeDomainData(samples)
    return Math.max(...samples.map(Math.abs))
  })).toBeGreaterThan(0.01)
  await page.evaluate(() => (window as any).soundBoard.dispose())
})
