import { isNoiseSuppressionMode, VoiceGate } from './voice-gate'

declare const sampleRate: number
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void

class VoiceWorklet extends AudioWorkletProcessor {
  private gate = new VoiceGate(sampleRate)
  private running = true

  constructor() {
    super()
    this.port.onmessage = ({ data }) => {
      if (data === 'dispose') this.running = false
      else if (isNoiseSuppressionMode(data)) this.gate.mode = data
      else if (data && typeof data === 'object') {
        this.gate.autoSensitivity = data.autoSensitivity !== false
        if (Number.isFinite(data.sensitivity))
          this.gate.sensitivity = Math.max(-70, Math.min(-20, data.sensitivity))
      }
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]) {
    const output = outputs[0]?.[0]
    if (output) {
      const input = inputs[0]?.[0]
      if (input) this.gate.process(input, output)
      else output.fill(0)
    }
    return this.running
  }
}

registerProcessor('orbita-voice', VoiceWorklet)
