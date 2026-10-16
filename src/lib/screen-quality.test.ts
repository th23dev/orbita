import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConnectionState, Track, type Room } from 'livekit-client'
import {
  changePublishedScreenQuality,
  defaultScreenQuality,
  screenCaptureOptions,
  screenPublishOptions,
  screenVideoCodec,
  setReceivedScreenQuality,
} from './screen-quality'

function fixture() {
  const previousConstraints = { width: { max: 1920 }, frameRate: { max: 60 } }
  const track = {
    mediaStreamTrack: {
      readyState: 'live',
      getConstraints: () => previousConstraints,
      applyConstraints: vi.fn().mockResolvedValue(undefined),
    },
    stop: vi.fn(),
  }
  const previousOptions = screenPublishOptions(defaultScreenQuality)
  const participant = {
    getTrackPublication: vi.fn().mockReturnValue({ videoTrack: track, options: previousOptions }),
    unpublishTrack: vi.fn().mockResolvedValue(undefined),
    publishTrack: vi.fn().mockResolvedValue(undefined),
    setScreenShareEnabled: vi.fn().mockResolvedValue(undefined),
  }
  const room = {
    state: ConnectionState.Connected,
    localParticipant: participant,
  } as unknown as Room
  return { room, participant, track, previousConstraints, previousOptions }
}

describe('screen sharing quality', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('preserves 1080p60 while reducing auxiliary encoding load and keeping game audio intact', () => {
    expect(screenCaptureOptions(defaultScreenQuality)).toMatchObject({
      contentHint: 'motion',
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 2,
        suppressLocalAudioPlayback: false,
      },
      selfBrowserSurface: 'exclude',
      resolution: { width: 1920, height: 1080, frameRate: 60 },
    })
    const options = screenPublishOptions(defaultScreenQuality)
    expect(options.source).toBeUndefined()
    expect(options.screenShareEncoding).toMatchObject({ maxFramerate: 60, maxBitrate: 8_000_000 })
    expect(options.degradationPreference).toBe('maintain-framerate')
    expect(options.screenShareSimulcastLayers?.map((layer) => layer.encoding.maxFramerate)).toEqual(
      [15, 30],
    )
    expect(options).toMatchObject({
      forceStereo: true,
      dtx: false,
      audioPreset: { maxBitrate: 128_000 },
    })
  })

  it('prefers an advertised H264 encoder and falls back to VP8 when unavailable', () => {
    vi.stubGlobal('RTCRtpSender', {
      getCapabilities: () => ({ codecs: [{ mimeType: 'video/H264' }] }),
    })
    expect(screenVideoCodec()).toBe('h264')
    vi.stubGlobal('RTCRtpSender', {
      getCapabilities: () => ({ codecs: [{ mimeType: 'video/VP8' }] }),
    })
    expect(screenVideoCodec()).toBe('vp8')
    vi.stubGlobal('RTCRtpSender', undefined)
    expect(screenVideoCodec()).toBe('vp8')
  })

  it('offers 1080p30 without lowering the source resolution', () => {
    expect(screenCaptureOptions('1080p30').resolution).toEqual({
      width: 1920,
      height: 1080,
      frameRate: 30,
    })
    expect(screenPublishOptions('1080p30').screenShareEncoding).toMatchObject({
      maxFramerate: 30,
      maxBitrate: 5_000_000,
    })
  })

  it('reduces capture, encoder bitrate and fps without stopping capture or touching other tracks', async () => {
    const { room, participant, track } = fixture()
    await changePublishedScreenQuality(room, '480p30')
    expect(participant.getTrackPublication).toHaveBeenCalledExactlyOnceWith(
      Track.Source.ScreenShare,
    )
    expect(track.mediaStreamTrack.applyConstraints).toHaveBeenCalledWith({
      width: { ideal: 854, max: 854 },
      height: { ideal: 480, max: 480 },
      frameRate: { ideal: 30, max: 30 },
    })
    expect(participant.unpublishTrack).toHaveBeenCalledExactlyOnceWith(track, false)
    expect(participant.publishTrack).toHaveBeenCalledWith(
      track,
      expect.objectContaining({
        screenShareEncoding: expect.objectContaining({ maxBitrate: 1_000_000, maxFramerate: 30 }),
      }),
    )
    expect(track.stop).not.toHaveBeenCalled()
    expect(participant.setScreenShareEnabled).not.toHaveBeenCalled()
    await changePublishedScreenQuality(room, '1080p60')
    expect(participant.publishTrack).toHaveBeenLastCalledWith(
      track,
      screenPublishOptions('1080p60'),
    )
  })

  it('restores the previous capture and encoder when publishing the new quality fails', async () => {
    const { room, participant, track, previousConstraints, previousOptions } = fixture()
    participant.publishTrack.mockRejectedValueOnce(new Error('network failed'))
    await expect(changePublishedScreenQuality(room, '720p30')).rejects.toThrow('network failed')
    expect(track.mediaStreamTrack.applyConstraints).toHaveBeenLastCalledWith(previousConstraints)
    expect(participant.publishTrack).toHaveBeenLastCalledWith(track, previousOptions)
    expect(track.stop).not.toHaveBeenCalled()
  })

  it('keeps the existing publication when capture constraints are rejected', async () => {
    const { room, participant, track } = fixture()
    track.mediaStreamTrack.applyConstraints.mockRejectedValueOnce(new Error('unsupported'))
    await expect(changePublishedScreenQuality(room, '720p30')).rejects.toThrow('unsupported')
    expect(participant.unpublishTrack).not.toHaveBeenCalled()
    expect(participant.publishTrack).not.toHaveBeenCalled()
  })

  it('releases the detached capture if the call ends during republishing', async () => {
    const { room, participant, track } = fixture()
    participant.unpublishTrack.mockImplementation(async () => {
      room.state = ConnectionState.Disconnected
    })
    await expect(changePublishedScreenQuality(room, '720p30')).rejects.toThrow('encerrada')
    expect(participant.publishTrack).not.toHaveBeenCalled()
    expect(track.stop).toHaveBeenCalledOnce()
  })

  it('cleans up screen capture and audio if rollback also fails', async () => {
    const { room, participant, track } = fixture()
    const audio = { kind: 'audio' }
    participant.getTrackPublication.mockImplementation((source) =>
      source === Track.Source.ScreenShareAudio
        ? { track: audio }
        : { videoTrack: track, options: screenPublishOptions(defaultScreenQuality) },
    )
    participant.publishTrack.mockRejectedValue(new Error('network failed'))
    await expect(changePublishedScreenQuality(room, '720p30')).rejects.toThrow(
      'Compartilhe a tela novamente',
    )
    expect(track.stop).toHaveBeenCalledOnce()
    expect(participant.unpublishTrack).toHaveBeenLastCalledWith(audio)
  })

  it('limits only incoming screen tracks, including newly subscribed participants', () => {
    const publication = { setVideoDimensions: vi.fn(), setVideoFPS: vi.fn() }
    const participant = { getTrackPublication: vi.fn().mockReturnValue(publication) }
    const room = { remoteParticipants: new Map([['viewer', participant]]) } as unknown as Room
    setReceivedScreenQuality(room, '480p30')
    expect(participant.getTrackPublication).toHaveBeenCalledExactlyOnceWith(
      Track.Source.ScreenShare,
    )
    expect(publication.setVideoDimensions).toHaveBeenCalledWith({ width: 854, height: 480 })
    expect(publication.setVideoFPS).toHaveBeenCalledWith(30)
    setReceivedScreenQuality(room, '1080p60')
    expect(publication.setVideoFPS).toHaveBeenLastCalledWith(60)
  })
})
