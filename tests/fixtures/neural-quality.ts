import { VoiceProcessor } from '../../src/lib/voice-processing'
import { defaultAudioPreferences } from '../../src/lib/audio-preferences'

function spectrum(samples: Float32Array, start: number, size = 1024) {
  const real = new Float64Array(size),
    imag = new Float64Array(size)
  for (let i = 0; i < size; i++)
    real[i] = samples[start + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)))
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) [real[i], real[j]] = [real[j], real[i]]
  }
  for (let length = 2; length <= size; length *= 2) {
    for (let start = 0; start < size; start += length) {
      for (let j = 0; j < length / 2; j++) {
        const angle = (-2 * Math.PI * j) / length
        const a = start + j,
          b = a + length / 2
        const r = real[b] * Math.cos(angle) - imag[b] * Math.sin(angle)
        const im = real[b] * Math.sin(angle) + imag[b] * Math.cos(angle)
        real[b] = real[a] - r
        imag[b] = imag[a] - im
        real[a] += r
        imag[a] += im
      }
    }
  }
  return real.slice(0, size / 2).map((value, i) => Math.hypot(value, imag[i]))
}

/** Measures distortion/noise during voiced windows, not just silence attenuation. */
export async function measureNeuralQuality(sampleRate = 48000) {
  const context = new AudioContext({ sampleRate })
  await context.resume()
  const processor = new VoiceProcessor(defaultAudioPreferences)
  const speech = context.createBufferSource()
  const noise = context.createBufferSource()
  const input = context.createMediaStreamDestination()
  let recorder: ScriptProcessorNode | undefined
  try {
    speech.buffer = await context.decodeAudioData(
      await (await fetch('/tests/fixtures/voice-reference.wav')).arrayBuffer(),
    )
    const noiseBuffer = context.createBuffer(1, sampleRate * 10, sampleRate)
    let seed = 721
    for (let i = 0; i < noiseBuffer.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      noiseBuffer.getChannelData(0)[i] = ((seed / 2 ** 32) * 2 - 1) * 0.06
    }
    noise.buffer = noiseBuffer
    noise.loop = true
    speech.connect(input)
    noise.connect(input)
    await processor.init({
      kind: 'audio' as any,
      track: input.stream.getAudioTracks()[0],
      audioContext: context,
    })
    const merger = context.createChannelMerger(3)
    speech.connect(merger, 0, 0)
    speech.connect(merger, 0, 1)
    noise.connect(merger, 0, 1)
    context
      .createMediaStreamSource(new MediaStream([processor.processedTrack!]))
      .connect(merger, 0, 2)
    // Test-only tap: no deprecated API is used by the production processor.
    recorder = context.createScriptProcessor(4096, 3, 1)
    merger.connect(recorder).connect(context.destination)
    const frames: Float32Array[][] = [[], [], []]
    const start = context.currentTime
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Audio capture timed out')), 20000)
      recorder!.onaudioprocess = ({ inputBuffer }) => {
        if (context.currentTime - start > 2) {
          for (let ch = 0; ch < 3; ch++) frames[ch].push(inputBuffer.getChannelData(ch).slice())
        }
        if (context.currentTime - start > 8) {
          clearTimeout(timeout)
          resolve()
        }
      }
      noise.start()
      speech.start()
    })
    recorder.onaudioprocess = null
    const [clean, noisy, filtered] = frames.map((chunks) => {
      const data = new Float32Array(chunks.length * 4096)
      chunks.forEach((chunk, i) => data.set(chunk, i * 4096))
      return data
    })
    // Align unknown worklet, resampling and MediaStream delay by cross-correlation.
    const margin = Math.round(sampleRate * 0.12)
    const correlation = (lag: number, stride = 16) => {
      let sum = 0
      for (let i = margin; i < clean.length - margin; i += stride)
        sum += clean[i] * filtered[i + lag]
      return sum
    }
    let bestLag = 0,
      best = -Infinity
    for (let lag = -margin; lag <= margin; lag += 4) {
      const value = correlation(lag)
      if (value > best) {
        best = value
        bestLag = lag
      }
    }
    const coarse = bestLag
    best = -Infinity
    for (let lag = coarse - 3; lag <= coarse + 3; lag++) {
      const value = correlation(lag, 1)
      if (value > best) {
        best = value
        bestLag = lag
      }
    }
    // Count only 20 ms windows with speech. A gate that only closes during pauses cannot pass.
    const indices: number[] = []
    const block = Math.round(sampleRate * 0.02)
    for (let start = margin; start + block < clean.length - margin; start += block) {
      let power = 0
      for (let i = start; i < start + block; i++) power += clean[i] ** 2
      if (power / block > 0.0004) for (let i = start; i < start + block; i++) indices.push(i)
    }
    let signal = 0,
      inputError = 0,
      cross = 0,
      outputPower = 0
    for (const i of indices) {
      signal += clean[i] ** 2
      inputError += (noisy[i] - clean[i]) ** 2
      cross += clean[i] * filtered[i + bestLag]
      outputPower += filtered[i + bestLag] ** 2
    }
    const gain = cross / signal
    // Compare spectral magnitudes: high-pass phase shift is not residual noise.
    // Normalize once for gain, and exclude pauses; muting speech cannot pass.
    const windows: { reference: Float64Array; before: Float64Array; after: Float64Array }[] = []
    let spectralCross = 0,
      spectralSignal = 0
    for (let start = margin; start + 1024 < clean.length - margin; start += 512) {
      let power = 0
      for (let i = start; i < start + 1024; i++) power += clean[i] ** 2
      if (power / 1024 < 0.0004) continue
      const reference = spectrum(clean, start),
        before = spectrum(noisy, start),
        after = spectrum(filtered, start + bestLag)
      windows.push({ reference, before, after })
      for (let i = 2; i < reference.length; i++) {
        spectralSignal += reference[i] ** 2
        spectralCross += reference[i] * after[i]
      }
    }
    const spectralGain = spectralCross / spectralSignal
    let beforeError = 0,
      afterError = 0
    for (const { reference, before, after } of windows) {
      for (let i = 2; i < reference.length; i++) {
        beforeError += (before[i] - reference[i]) ** 2
        afterError += (after[i] / spectralGain - reference[i]) ** 2
      }
    }
    return {
      sampleRate,
      voicedSeconds: indices.length / sampleRate,
      delayMs: (bestLag / sampleRate) * 1000,
      inputSnrDb: 10 * Math.log10(signal / inputError),
      spectralErrorReductionDb: 10 * Math.log10(beforeError / afterError),
      voiceGainDb: 20 * Math.log10(gain),
      outputRms: Math.sqrt(outputPower / indices.length),
    }
  } finally {
    recorder?.disconnect()
    speech.stop()
    noise.stop()
    await processor.destroy()
    input.stream.getTracks().forEach((track) => track.stop())
    await context.close()
  }
}
