import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Room } from 'livekit-client'
import { LocalAudioTrack } from 'livekit-client'
import { VoiceMicrophone } from './voice-microphone'
import { defaultAudioPreferences } from './audio-preferences'

vi.mock('livekit-client', () => ({
  ConnectionState: { Connected: 'connected' },
  Track: { Source: { Microphone: 'microphone' } },
  LocalAudioTrack: class {
    processor: unknown
    stop = vi.fn()
    applyConstraints = vi.fn().mockResolvedValue(undefined)
    setProcessor = vi.fn(async (processor) => {
      this.processor = processor
    })
    getProcessor() {
      return this.processor
    }
  },
}))
vi.mock('./voice-processing', () => ({
  voiceCaptureOptions: (p: typeof defaultAudioPreferences) => ({
    noiseSuppression: p.noiseSuppression !== 'off',
    deviceId: p.inputDevice,
  }),
  VoiceProcessor: class {
    configure = vi.fn()
    destroy = vi.fn()
  },
}))

function setup() {
  const track = new LocalAudioTrack({} as MediaStreamTrack)
  let publication: { track: LocalAudioTrack } | undefined
  const local = {
    createTracks: vi.fn().mockResolvedValue([track]),
    publishTrack: vi.fn(async () => {
      publication = { track }
    }),
    unpublishTrack: vi.fn(async () => {
      publication = undefined
    }),
    getTrackPublication: vi.fn(() => publication),
    setMicrophoneEnabled: vi.fn().mockResolvedValue(undefined),
  }
  const room = {
    state: 'connected',
    localParticipant: local,
    switchActiveDevice: vi.fn().mockResolvedValue(true),
  }
  const mic = new VoiceMicrophone(room as unknown as Room, defaultAudioPreferences, vi.fn())
  return { mic, track, local, room }
}
beforeEach(() => vi.clearAllMocks())
describe('call microphone lifecycle', () => {
  it('installs processing before publishing, and serializes duplicate enables', async () => {
    const { mic, track, local } = setup()
    await Promise.all([mic.setEnabled(true), mic.setEnabled(true)])
    expect(local.createTracks).toHaveBeenCalledOnce()
    expect(local.publishTrack).toHaveBeenCalledOnce()
    expect(local.publishTrack).toHaveBeenCalledWith(
      track,
      expect.objectContaining({ stopMicTrackOnMute: true }),
    )
    expect(vi.mocked(track.setProcessor).mock.invocationCallOrder[0]).toBeLessThan(
      local.publishTrack.mock.invocationCallOrder[0],
    )
    await mic.setEnabled(false)
    expect(local.setMicrophoneEnabled).toHaveBeenLastCalledWith(false, expect.any(Object))
  })
  it('stops a late microphone when the call is closed during permission', async () => {
    const { mic, track, local } = setup()
    let resolve!: (tracks: LocalAudioTrack[]) => void
    local.createTracks.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done
      }),
    )
    const pending = mic.setEnabled(true)
    await Promise.resolve()
    mic.cancelPending()
    resolve([track])
    await pending
    expect(track.stop).toHaveBeenCalledOnce()
    expect(local.publishTrack).not.toHaveBeenCalled()
  })
  it('cleans up failed publications and permits retry', async () => {
    const { mic, track, local } = setup()
    local.publishTrack.mockRejectedValueOnce(new Error('network'))
    await expect(mic.setEnabled(true)).rejects.toThrow('network')
    expect(track.stop).toHaveBeenCalledOnce()
    await mic.setEnabled(true)
    expect(local.publishTrack).toHaveBeenCalledTimes(2)
  })
  it('changes input device and settings without unmuting the track', async () => {
    const { mic, local, room, track } = setup()
    await mic.setEnabled(true)
    await mic.setEnabled(false)
    local.setMicrophoneEnabled.mockClear()
    await mic.configure({ ...defaultAudioPreferences, inputDevice: 'usb', inputVolume: 0.5 })
    expect(room.switchActiveDevice).toHaveBeenCalledWith('audioinput', 'usb')
    expect(track.applyConstraints).toHaveBeenCalled()
    expect(local.setMicrophoneEnabled).not.toHaveBeenCalled()
  })
})
