import { expect, test } from '@playwright/test'

test.use({
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  permissions: ['microphone'],
})

test('real AudioWorklet processes audio, bypasses, restarts and releases only owned resources', async ({
  page,
}) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const { VoiceProcessor } = await import(/* @vite-ignore */ '/src/lib/voice-processing.ts')
    const { defaultAudioPreferences } = await import(
      /* @vite-ignore */ '/src/lib/audio-preferences.ts'
    )
    const context = new AudioContext({ sampleRate: 48000 })
    await context.resume()
    const oscillator = context.createOscillator()
    oscillator.frequency.value = 220
    const level = context.createGain()
    level.gain.value = 0.08
    const input = context.createMediaStreamDestination()
    oscillator.connect(level).connect(input)
    oscillator.start()
    const raw = input.stream.getAudioTracks()[0]
    let ready = false
    const processor = new VoiceProcessor(defaultAudioPreferences, (value: boolean) => {
      ready = value
    })
    await processor.init({ kind: 'audio', track: raw, audioContext: context })
    const first = processor.processedTrack!
    const measure = async (track: MediaStreamTrack, silent = false) => {
      const source = context.createMediaStreamSource(new MediaStream([track]))
      const analyser = context.createAnalyser()
      analyser.fftSize = 1024
      source.connect(analyser)
      const samples = new Float32Array(analyser.fftSize)
      const start = context.currentTime
      let rms = 0
      // Wait for rendered audio, not wall-clock time: browser startup can be slow in CI.
      for (let attempt = 0; attempt < 100; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 50))
        analyser.getFloatTimeDomainData(samples)
        rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length)
        if (context.currentTime - start > 0.35 && (silent ? rms < 0.00001 : rms > 0.02)) break
      }
      source.disconnect()
      return rms
    }
    const speech = await measure(first)
    processor.configure({ ...defaultAudioPreferences, inputVolume: 0 })
    const zero = await measure(first, true)
    processor.configure({ ...defaultAudioPreferences, profile: 'studio' })
    const bypass = await measure(first)
    // SDK device restarts may omit the shared audioContext.
    await processor.restart({ kind: 'audio', track: raw })
    const restarted = await measure(processor.processedTrack!)
    const oldStopped = first.readyState === 'ended'
    await processor.destroy()
    const rawStillLive = raw.readyState === 'live'
    const sharedContextOpen = context.state === 'running'
    oscillator.stop()
    raw.stop()
    await context.close()
    return { ready, speech, zero, bypass, restarted, oldStopped, rawStillLive, sharedContextOpen }
  })
  expect(result.ready).toBe(true)
  expect(result.speech).toBeGreaterThan(0.02)
  expect(result.zero).toBeLessThan(0.00001)
  expect(result.bypass).toBeGreaterThan(0.04)
  expect(result.restarted).toBeGreaterThan(0.04)
  expect(result.oldStopped && result.rawStillLive && result.sharedContextOpen).toBe(true)
})

test('worklet download failure keeps an audible fallback', async ({ page }) => {
  await page.addInitScript(() => {
    AudioWorklet.prototype.addModule = async () => {
      throw new DOMException('Simulated download failure', 'NetworkError')
    }
  })
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const { VoiceProcessor } = await import(/* @vite-ignore */ '/src/lib/voice-processing.ts')
    const { defaultAudioPreferences } = await import(
      /* @vite-ignore */ '/src/lib/audio-preferences.ts'
    )
    const context = new AudioContext()
    await context.resume()
    const oscillator = context.createOscillator()
    const input = context.createMediaStreamDestination()
    oscillator.connect(input)
    oscillator.start()
    const raw = input.stream.getAudioTracks()[0]
    let ready = true
    const processor = new VoiceProcessor(defaultAudioPreferences, (value: boolean) => {
      ready = value
    })
    await processor.init({ kind: 'audio', track: raw, audioContext: context })
    const source = context.createMediaStreamSource(
      new MediaStream([processor.processedTrack ?? raw]),
    )
    const analyser = context.createAnalyser()
    source.connect(analyser)
    const data = new Float32Array(analyser.fftSize)
    let peak = 0
    for (let attempt = 0; attempt < 100 && peak <= 0.1; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      analyser.getFloatTimeDomainData(data)
      peak = Math.max(...data.map(Math.abs))
    }
    source.disconnect()
    await processor.destroy()
    oscillator.stop()
    raw.stop()
    await context.close()
    return { ready, peak }
  })
  expect(result.ready).toBe(false)
  expect(result.peak).toBeGreaterThan(0.1)
})

test('noise reduction is measurable on the received WebRTC track', async ({ page }, info) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const { measureVoiceLoopback } = await import(
      /* @vite-ignore */ '/tests/fixtures/voice-loopback.ts'
    )
    return measureVoiceLoopback()
  })
  await info.attach('noise-reduction-measurements.json', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  })
  console.log(`Noise reduction (${info.project.name}): ${JSON.stringify(result)}`)
  expect(result.processedBeforePublish).toBe(true)
  expect(result.workletReady).toBe(true)
  expect(result.bytesSent).toBeGreaterThan(0)
  expect(result.quietOff).toBeGreaterThan(0.00005)
  expect(result.balancedReductionDb).toBeGreaterThan(10)
  expect(result.strongReductionDb).toBeGreaterThan(20)
  expect(Math.abs(result.voiceChangeDb)).toBeLessThan(6)
  expect(result.voiceBalanced).toBeGreaterThan(0.02)
  expect(result.muted).toBeLessThan(0.00001)
  expect(result.unmuted).toBeGreaterThan(0.02)
})

test.describe('native microphone processing', () => {
  test('Chromium reports native suppression enabled and honors disabling it', async ({ page }, info) => {
    await page.goto('/')
    const settings = await page.evaluate(async () => {
      const { voiceCaptureOptions } = await import(/* @vite-ignore */ '/src/lib/voice-processing.ts')
      const { defaultAudioPreferences } = await import(/* @vite-ignore */ '/src/lib/audio-preferences.ts')
      const enabledStream = await navigator.mediaDevices.getUserMedia({
        audio: voiceCaptureOptions(defaultAudioPreferences),
      })
      const enabled = enabledStream.getAudioTracks()[0].getSettings()
      enabledStream.getTracks().forEach((track) => track.stop())
      const disabledStream = await navigator.mediaDevices.getUserMedia({
        audio: voiceCaptureOptions({ ...defaultAudioPreferences, profile: 'studio' }),
      })
      try {
        return { enabled, disabled: disabledStream.getAudioTracks()[0].getSettings() }
      } finally {
        disabledStream.getTracks().forEach((track) => track.stop())
      }
    })
    await info.attach('native-audio-settings.json', {
      body: JSON.stringify(settings, null, 2),
      contentType: 'application/json',
    })
    expect(settings.enabled.noiseSuppression).toBe(true)
    expect(settings.enabled.echoCancellation).toBe(true)
    expect(settings.disabled.noiseSuppression).toBe(false)
  })
})
