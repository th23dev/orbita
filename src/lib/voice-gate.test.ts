import { describe, expect, it } from 'vitest'
import { VoiceGate } from './voice-gate'

function signal(gate: VoiceGate, rate: number, amplitude: number, seconds: number) {
  const input = Float32Array.from(
    { length: Math.round(rate * seconds) },
    (_, i) => amplitude * Math.sin((2 * Math.PI * 220 * i) / rate),
  )
  const output = new Float32Array(input.length)
  gate.process(input, output)
  return { input, output }
}
function rms(samples: Float32Array) {
  return Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length)
}

describe.each([16000, 44100, 48000])('voice expander at %i Hz', (rate) => {
  it('attenuates quiet background noise by at least 15 dB after settling', () => {
    const { input, output } = signal(new VoiceGate(rate), rate, 0.0005, 3)
    expect(rms(output.slice(-rate)) / rms(input.slice(-rate))).toBeLessThan(0.18)
  })
  it('opens quickly for speech after silence and keeps quiet endings', () => {
    const gate = new VoiceGate(rate)
    signal(gate, rate, 0, 2)
    const speech = signal(gate, rate, 0.08, 0.2)
    expect(
      rms(speech.output.slice(Math.round(rate * 0.025))) /
        rms(speech.input.slice(Math.round(rate * 0.025))),
    ).toBeGreaterThan(0.95)
    const ending = signal(gate, rate, 0.002, 0.15)
    expect(rms(ending.output) / rms(ending.input)).toBeGreaterThan(0.95)
  })
  it('does not learn sustained speech as noise', () => {
    const { input, output } = signal(new VoiceGate(rate, 'strong'), rate, 0.03, 8)
    expect(rms(output.slice(-rate)) / rms(input.slice(-rate))).toBeGreaterThan(0.99)
  })
  it('bypasses bit for bit when disabled', () => {
    const gate = new VoiceGate(rate, 'off')
    const { input, output } = signal(gate, rate, 0.0005, 0.2)
    expect(output).toEqual(input)
  })
  it('applies a user-selected sensitivity and keeps samples finite', () => {
    const gate = new VoiceGate(rate)
    gate.autoSensitivity = false
    gate.sensitivity = -25
    const { input, output } = signal(gate, rate, 0.005, 2)
    expect(rms(output.slice(-rate)) / rms(input.slice(-rate))).toBeLessThan(0.2)
    expect(output.every(Number.isFinite)).toBe(true)
  })
})
