import { NeuralDenoiser } from './rnnoise'
import { isNoiseSuppressionMode } from './voice-gate'
import type { NoiseSuppressionMode } from './voice-gate'

declare const sampleRate: number
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}
declare function registerProcessor(
  name: string,
  processor: new (options: { processorOptions: { binary: ArrayBuffer } }) => AudioWorkletProcessor,
): void

/** Converts arbitrary render quanta into RNNoise's 10 ms, 48 kHz PCM frames. */
class NeuralWorklet extends AudioWorkletProcessor {
  private state?: NeuralDenoiser
  private running = true
  private frame = new Float32Array(480)
  private output = new Float32Array(480)
  private position = 0
  private hold = 0
  private gain = 1
  private mode: NoiseSuppressionMode = 'balanced'

  constructor(options: { processorOptions: { binary: ArrayBuffer } }) {
    super()
    this.port.onmessage = ({ data }) => {
      if (data === 'dispose') {
        this.running = false
        this.state?.destroy()
        this.state = undefined
      } else if (isNoiseSuppressionMode(data)) this.mode = data
    }
    void NeuralDenoiser.create(options.processorOptions.binary)
      .then((state) => {
        if (!this.running || sampleRate !== 48000) {
          state.destroy()
          if (this.running) throw new Error('Unsupported neural sample rate')
          return
        }
        this.state = state
        this.port.postMessage('ready')
      })
      .catch(() => this.fail())
  }

  private fail() {
    this.state?.destroy()
    this.state = undefined
    this.running = false
    this.port.postMessage('failed')
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]) {
    const input = inputs[0]?.[0],
      output = outputs[0]?.[0]
    if (!this.running) return false
    if (!this.state || !output) return true
    try {
      for (let i = 0; i < output.length; i++) {
        output[i] = this.output[this.position]
        this.frame[this.position++] = (input?.[i] ?? 0) * 32768
        if (this.position === 480) {
          const probability = this.state.processFrame(this.frame)
          const strong = this.mode === 'strong'
          // Neural voice detection closes on loud non-speech too. Hold preserves word endings.
          if (probability >= (strong ? 0.5 : 0.3)) this.hold = 20
          else this.hold = Math.max(0, this.hold - 1)
          const target = this.hold > 0 || this.mode === 'off' ? 1 : strong ? 0.02 : 0.1
          const speed = Math.exp(-1 / (48000 * (target > this.gain ? 0.003 : 0.15)))
          for (let j = 0; j < 480; j++) {
            this.gain = speed * this.gain + (1 - speed) * target
            this.output[j] = (this.frame[j] / 32768) * this.gain
          }
          this.position = 0
        }
      }
    } catch {
      this.fail()
      return false
    }
    return true
  }
}

registerProcessor('orbita-neural', NeuralWorklet)
