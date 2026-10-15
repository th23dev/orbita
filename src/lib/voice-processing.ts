import type {
  AudioCaptureOptions,
  AudioProcessorOptions,
  TrackProcessor,
  Track,
} from 'livekit-client'
import workletUrl from './voice-worklet.ts?worker&url'
import rnnoiseWorkletUrl from './neural-worklet.ts?worker&url'
import rnnoiseWasmUrl from '@shiguredo/rnnoise-wasm/dist/rnnoise.wasm?url'
import rnnoiseSimdUrl from '@shiguredo/rnnoise-wasm/dist/rnnoise_simd.wasm?url'
import type { NoiseSuppressionMode } from './voice-gate'
import { processingPreferences } from './audio-preferences'
import type { AudioPreferences } from './audio-preferences'

const modules = new WeakMap<AudioContext, Promise<void>>()
let neuralBinary: Promise<ArrayBuffer> | undefined
async function loadNeuralBinary() {
  neuralBinary ??= (async () => {
    const simd = WebAssembly.validate(
      new Uint8Array([
        0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0,
        253, 15, 253, 98, 11,
      ]),
    )
    const response = await fetch(simd ? rnnoiseSimdUrl : rnnoiseWasmUrl, {
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) throw new Error('Neural model unavailable')
    const binary = await response.arrayBuffer()
    // Validate before publishing: HTML error pages or incompatible WASM must use fallback.
    await WebAssembly.compile(binary)
    return binary
  })().catch((error) => {
    neuralBinary = undefined
    throw error
  })
  return neuralBinary
}
export function voiceCaptureOptions(preferences: AudioPreferences): AudioCaptureOptions {
  const p = processingPreferences(preferences)
  return {
    echoCancellation: p.echoCancellation,
    autoGainControl: p.autoGainControl,
    noiseSuppression: p.noiseSuppression !== 'off',
    channelCount: 1,
    deviceId: p.inputDevice,
  }
}

/** Processes at 48 kHz; never plays the microphone through local speakers. */
export class VoiceProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  readonly name = 'orbita-voice'
  processedTrack?: MediaStreamTrack
  private context?: AudioContext
  private sharedContext?: AudioContext
  private ownsContext = false
  private neural?: AudioWorkletNode
  private cancelInitialization?: () => void
  private nodes: AudioNode[] = []
  private dry?: GainNode
  private wet?: GainNode
  private filter?: BiquadFilterNode
  private worklet?: AudioWorkletNode
  private ready = false
  private generation = 0
  private volume?: GainNode
  private mode: NoiseSuppressionMode

  constructor(
    private preferences: AudioPreferences,
    private onReady: (ready: boolean) => void = () => {},
  ) {
    this.mode = processingPreferences(preferences).noiseSuppression
  }

  configure(preferences: AudioPreferences) {
    this.preferences = preferences
    const p = processingPreferences(preferences)
    this.setMode(p.noiseSuppression)
    this.volume?.gain.setTargetAtTime(p.inputVolume, this.context?.currentTime ?? 0, 0.015)
    this.worklet?.port.postMessage({
      autoSensitivity: p.autoSensitivity,
      sensitivity: p.sensitivity,
    })
  }

  setMode(mode: NoiseSuppressionMode) {
    this.mode = mode
    const enabled = mode !== 'off' && this.ready
    const now = this.context?.currentTime ?? 0
    this.dry?.gain.setTargetAtTime(enabled ? 0 : 1, now, 0.015)
    this.wet?.gain.setTargetAtTime(enabled ? 1 : 0, now, 0.015)
    this.filter?.frequency.setTargetAtTime(mode === 'strong' ? 100 : 75, now, 0.015)
    this.worklet?.port.postMessage(mode)
    this.neural?.port.postMessage(mode)
  }

  async init(options: AudioProcessorOptions) {
    const generation = ++this.generation
    // LiveKit also calls restart without audioContext when reacquiring a device.
    this.sharedContext = options.audioContext ?? this.sharedContext
    // RNNoise operates at 48 kHz. Web Audio resamples capture from 44.1 kHz devices.
    this.ownsContext = Boolean(this.sharedContext && this.sharedContext.sampleRate !== 48000)
    this.context = this.ownsContext ? new AudioContext({ sampleRate: 48000 }) : this.sharedContext
    const context = this.context
    try {
      if (!context || context.state === 'closed') throw new Error('Audio context unavailable')
      if (this.ownsContext) await context.resume()
      if (generation !== this.generation) return
      const source = context.createMediaStreamSource(new MediaStream([options.track]))
      this.nodes.push(source)
      const destination = context.createMediaStreamDestination()
      this.nodes.push(destination)
      this.processedTrack = destination.stream.getAudioTracks()[0]
      const volume = context.createGain()
      this.nodes.push(volume)
      this.volume = volume
      volume.gain.value = this.preferences.inputVolume
      volume.connect(destination)
      const dry = context.createGain()
      this.nodes.push(dry)
      this.dry = dry
      source.connect(dry).connect(volume)
      if (!context.audioWorklet) throw new Error('AudioWorklet unavailable')
      let module = modules.get(context)
      if (!module) {
        module = Promise.all([
          context.audioWorklet.addModule(workletUrl),
          context.audioWorklet.addModule(rnnoiseWorkletUrl),
        ])
          .then(() => {})
          .catch((error) => {
            modules.delete(context)
            throw error
          })
        modules.set(context, module)
      }
      const [, binary] = await Promise.all([module, loadNeuralBinary()])
      if (generation !== this.generation) return
      const filter = context.createBiquadFilter()
      this.nodes.push(filter)
      this.filter = filter
      filter.type = 'highpass'
      filter.frequency.value = this.mode === 'strong' ? 100 : 75
      filter.Q.value = 0.707
      const neural = new AudioWorkletNode(context, 'orbita-neural', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        channelCountMode: 'explicit',
        processorOptions: { binary },
      })
      this.neural = neural
      this.nodes.push(neural)
      const gate = new AudioWorkletNode(context, 'orbita-voice', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        channelCountMode: 'explicit',
      })
      this.worklet = gate
      this.nodes.push(gate)
      const compressor = context.createDynamicsCompressor()
      this.nodes.push(compressor)
      compressor.threshold.value = -12
      compressor.knee.value = 12
      compressor.ratio.value = 3
      compressor.attack.value = 0.005
      compressor.release.value = 0.15
      const wet = context.createGain()
      this.wet = wet
      this.nodes.push(wet)
      wet.gain.value = 0
      source
        .connect(filter)
        .connect(neural)
        .connect(gate)
        .connect(compressor)
        .connect(wet)
        .connect(volume)
      const failed = () => {
        this.ready = false
        this.setMode(this.mode)
        this.onReady(false)
      }
      gate.onprocessorerror = neural.onprocessorerror = failed
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Neural initialization timed out')),
          15000,
        )
        const finish = (error?: Error) => {
          clearTimeout(timeout)
          this.cancelInitialization = undefined
          if (error) reject(error)
          else resolve()
        }
        this.cancelInitialization = () => finish(new Error('Processor stopped'))
        neural.onprocessorerror = () => {
          finish(new Error('Neural processor failed'))
          failed()
        }
        neural.port.onmessage = ({ data }) => {
          if (data === 'ready') finish()
          else if (data === 'failed') {
            finish(new Error('Neural model failed'))
            failed()
          }
        }
      })
      if (generation !== this.generation) return
      this.ready = true
      this.configure(this.preferences)
      this.onReady(true)
    } catch {
      if (generation !== this.generation) return
      // Keep a dry path (or the original track) so a failed effect never silences the call.
      this.ready = false
      this.setMode(this.mode)
      this.onReady(false)
    }
  }

  async restart(options: AudioProcessorOptions) {
    await this.destroy()
    await this.init(options)
  }

  async destroy() {
    this.generation++
    this.cancelInitialization?.()
    if (this.worklet) {
      this.worklet.onprocessorerror = null
      this.worklet.port.postMessage('dispose')
      this.worklet.port.close()
    }
    if (this.neural) {
      this.neural.onprocessorerror = null
      this.neural.port.postMessage('dispose')
      this.neural.port.onmessage = null
      this.neural.port.close()
      this.neural = undefined
    }
    for (const node of this.nodes) node.disconnect()
    this.nodes = []
    this.processedTrack?.stop()
    this.processedTrack = undefined
    this.dry = this.wet = undefined
    this.filter = undefined
    this.worklet = undefined
    this.volume = undefined
    this.ready = false
    if (this.ownsContext) await this.context?.close().catch(() => {})
    this.ownsContext = false
    // The SDK owns both the microphone and the shared context.
  }
}
