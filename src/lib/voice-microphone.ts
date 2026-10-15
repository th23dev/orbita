import { ConnectionState, LocalAudioTrack, Track } from 'livekit-client'
import type { Room } from 'livekit-client'
import type { AudioPreferences } from './audio-preferences'
import { VoiceProcessor, voiceCaptureOptions } from './voice-processing'

/** Serializes capture/settings so rapid clicks cannot publish multiple microphones. */
export class VoiceMicrophone {
  private queue: Promise<void> = Promise.resolve()
  private generation = 0

  constructor(
    private room: Room,
    private preferences: AudioPreferences,
    private onReady: (ready: boolean) => void,
  ) {}

  cancelPending() {
    this.generation++
  }
  getPreferences() {
    return this.preferences
  }

  private enqueue(action: (current: () => boolean) => Promise<void>) {
    const generation = this.generation
    const current = () => generation === this.generation
    const next = this.queue.then(async () => {
      if (current()) await action(current)
    })
    this.queue = next.catch(() => {})
    return next
  }

  configure(preferences: AudioPreferences) {
    return this.enqueue(async (current) => {
      if (preferences.inputDevice !== this.preferences.inputDevice) {
        const changed = await this.room.switchActiveDevice('audioinput', preferences.inputDevice)
        if (!changed) throw new Error('Não foi possível selecionar este microfone.')
      }
      const track = this.room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track
      if (track instanceof LocalAudioTrack) {
        const { noiseSuppression, echoCancellation, autoGainControl } =
          voiceCaptureOptions(preferences)
        try {
          await track.applyConstraints({ noiseSuppression, echoCancellation, autoGainControl })
        } catch (error) {
          if (preferences.inputDevice !== this.preferences.inputDevice) {
            await this.room
              .switchActiveDevice('audioinput', this.preferences.inputDevice)
              .catch(() => {})
          }
          throw error
        }
        if (!current()) return
        const processor = track.getProcessor()
        if (processor instanceof VoiceProcessor) processor.configure(preferences)
      }
      this.preferences = preferences
    })
  }

  setEnabled(enabled: boolean) {
    return this.enqueue(async (current) => {
      if (this.room.state !== ConnectionState.Connected) return
      const local = this.room.localParticipant
      if (!enabled || local.getTrackPublication(Track.Source.Microphone)?.track) {
        await local.setMicrophoneEnabled(enabled, voiceCaptureOptions(this.preferences))
        return
      }
      const tracks = await local.createTracks({
        audio: voiceCaptureOptions(this.preferences),
        video: false,
      })
      const track = tracks.find(
        (track): track is LocalAudioTrack => track instanceof LocalAudioTrack,
      )
      if (!track) {
        tracks.forEach((track) => track.stop())
        throw new Error('Não foi possível abrir o microfone.')
      }
      const valid = () => current() && this.room.state === ConnectionState.Connected
      let published = false
      try {
        if (!valid()) return
        const processor = new VoiceProcessor(this.preferences, (ready) => {
          if (valid()) this.onReady(ready)
        })
        try {
          await track.setProcessor(processor)
        } catch {
          await processor.destroy()
          if (valid()) this.onReady(false)
        }
        if (!valid()) return
        // The processed stream is already installed before any audio is transmitted.
        await local.publishTrack(track, { source: Track.Source.Microphone, dtx: true, red: true })
        if (!valid()) {
          await local.unpublishTrack(track)
          return
        }
        published = true
      } finally {
        if (!published) track.stop()
      }
    })
  }
}
