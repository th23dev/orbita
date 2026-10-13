import { LocalAudioTrack, Track } from 'livekit-client'
import type { Room } from 'livekit-client'

/** One dedicated WebRTC track carries every sound to the room, independently of mic mute. */
export class Soundboard {
  private context: AudioContext | null = null
  private destination: MediaStreamAudioDestinationNode | null = null
  private gain: GainNode | null = null
  private track: LocalAudioTrack | null = null
  private sources = new Set<AudioBufferSourceNode>()
  private disposed = false
  private generation = 0
  private init: Promise<void> | null = null
  constructor(private room: Room) {}
  private async initialize() {
    if (this.init) return this.init
    this.init = (async () => {
      this.context = new AudioContext()
      this.destination = this.context.createMediaStreamDestination()
      this.gain = this.context.createGain()
      this.gain.connect(this.destination)
      this.gain.connect(this.context.destination)
      this.track = new LocalAudioTrack(
        this.destination.stream.getAudioTracks()[0],
        undefined,
        false,
      )
      await this.room.localParticipant.publishTrack(this.track, {
        name: 'orbita-soundboard',
        source: Track.Source.Unknown,
        dtx: false,
        red: true,
      })
    })()
    return this.init
  }
  async play(load: () => Promise<ArrayBuffer>, volume: number) {
    if (this.disposed) throw new Error('Entre em uma chamada para tocar um som.')
    this.stop()
    const generation = this.generation
    await this.initialize()
    if (this.disposed || generation !== this.generation) return
    await this.context!.resume()
    const data = await load()
    if (this.disposed || generation !== this.generation) return
    const buffer = await this.context!.decodeAudioData(data)
    if (this.disposed || generation !== this.generation) return
    if (buffer.duration > 30) throw new Error('Use sons com até 30 segundos.')
    this.setVolume(volume)
    const source = this.context!.createBufferSource()
    source.buffer = buffer
    source.connect(this.gain!)
    this.sources.add(source)
    source.onended = () => {
      this.sources.delete(source)
      source.disconnect()
    }
    source.start()
  }
  setVolume(volume: number) {
    if (this.gain) this.gain.gain.value = Math.max(0, Math.min(1, volume))
  }
  stop() {
    this.generation++
    for (const source of this.sources) {
      source.stop()
      source.disconnect()
    }
    this.sources.clear()
  }
  async dispose() {
    this.disposed = true
    this.stop()
    await this.init?.catch(() => {})
    if (this.track) {
      await this.room.localParticipant.unpublishTrack(this.track)
      this.track.stop()
    }
    this.destination?.stream.getTracks().forEach((t) => t.stop())
    await this.context?.close()
  }
}
