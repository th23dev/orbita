export type NoiseSuppressionMode = 'off' | 'balanced' | 'strong'

export function isNoiseSuppressionMode(value: unknown): value is NoiseSuppressionMode {
  return value === 'off' || value === 'balanced' || value === 'strong'
}

/** A gentle expander after browser denoising, not a speech/AI classifier. */
export class VoiceGate {
  private envelope = 0
  private noise = 10 ** (-65 / 20)
  private gain = 1
  private hold = 0
  autoSensitivity = true
  sensitivity = -50
  private readonly attack: number
  private readonly release: number
  private readonly noiseRise: number
  private readonly noiseFall: number

  constructor(
    private rate: number,
    public mode: NoiseSuppressionMode = 'balanced',
  ) {
    this.attack = Math.exp(-1 / (rate * 0.003))
    this.release = Math.exp(-1 / (rate * 0.15))
    this.noiseRise = Math.exp(-1 / (rate * 2))
    this.noiseFall = Math.exp(-1 / (rate * 0.25))
  }

  process(input: Float32Array, output: Float32Array) {
    const strong = this.mode === 'strong'
    const minimum = 10 ** ((strong ? -50 : -58) / 20)
    const ceiling = 10 ** ((strong ? -38 : -46) / 20)
    const floorGain = strong ? 0.025 : 0.1
    for (let i = 0; i < output.length; i++) {
      const sample = input[i] || 0
      const magnitude = Math.abs(sample)
      const envelopeSpeed = magnitude > this.envelope ? this.attack : this.release
      this.envelope = envelopeSpeed * this.envelope + (1 - envelopeSpeed) * magnitude
      // Never learn normal speech as noise. Adapt only beneath a conservative ceiling.
      if (this.envelope < ceiling) {
        const speed = this.envelope < this.noise ? this.noiseFall : this.noiseRise
        this.noise = speed * this.noise + (1 - speed) * this.envelope
      }
      const threshold = this.autoSensitivity
        ? Math.max(minimum, Math.min(ceiling, this.noise * 2.5))
        : 10 ** (this.sensitivity / 20)
      if (this.envelope >= threshold) this.hold = this.rate * 0.2
      else this.hold = Math.max(0, this.hold - 1)
      // A soft slope and hold preserve quiet word endings and avoid hard chopping.
      const target =
        this.mode === 'off' || this.hold > 0
          ? 1
          : Math.max(floorGain, Math.min(1, (this.envelope / threshold) ** 2))
      const speed = target > this.gain ? this.attack : this.release
      this.gain = speed * this.gain + (1 - speed) * target
      output[i] = this.mode === 'off' ? sample : sample * this.gain
    }
  }
}
