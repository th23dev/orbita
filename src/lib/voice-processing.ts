import type {
  AudioCaptureOptions,
  AudioProcessorOptions,
  TrackProcessor,
  Track,
} from 'livekit-client'
import workletUrl from './voice-worklet.ts?worker&url'
import type { NoiseSuppressionMode } from './voice-gate'
import { processingPreferences } from './audio-preferences'
import type { AudioPreferences } from './audio-preferences'

const modules = new WeakMap<AudioContext, Promise<void>>()
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

/** Uses LiveKit's context; never plays the microphone through local speakers. */
export class VoiceProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  readonly name = 'orbita-voice'
  processedTrack?: MediaStreamTrack
  private context?: AudioContext
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
  }

  async init(options: AudioProcessorOptions) {
    const generation = ++this.generation
    // LiveKit also calls restart without audioContext when reacquiring a device.
    this.context = options.audioContext ?? this.context
    const context = this.context
    try {
      if (!context || context.state === 'closed') throw new Error('Audio context unavailable')
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
        module = context.audioWorklet.addModule(workletUrl).catch((error) => {
          modules.delete(context)
          throw error
        })
        modules.set(context, module)
      }
      await module
      if (generation !== this.generation) return
      const filter = context.createBiquadFilter()
      this.nodes.push(filter)
      this.filter = filter
      filter.type = 'highpass'
      filter.frequency.value = this.mode === 'strong' ? 100 : 75
      filter.Q.value = 0.707
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
      source.connect(filter).connect(gate).connect(compressor).connect(wet).connect(volume)
      gate.onprocessorerror = () => {
        this.ready = false
        this.setMode(this.mode)
        this.onReady(false)
      }
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
    if (this.worklet) {
      this.worklet.onprocessorerror = null
      this.worklet.port.postMessage('dispose')
      this.worklet.port.close()
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
    // The SDK owns both the microphone and the shared context.
  }
}
