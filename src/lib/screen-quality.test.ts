import { describe, expect, it, vi } from 'vitest'
import { ConnectionState, Track, type Room } from 'livekit-client'
import {
  changePublishedScreenQuality,
  defaultScreenQuality,
  screenCaptureOptions,
  screenPublishOptions,
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
  it('captures and encodes at 1080p60 by default, with useful fallback layers', () => {
    expect(screenCaptureOptions(defaultScreenQuality)).toMatchObject({
      contentHint: 'motion',
      audio: true,
      resolution: { width: 1920, height: 1080, frameRate: 60 },
    })
    const options = screenPublishOptions(defaultScreenQuality)
    expect(options.source).toBeUndefined()
    expect(options.screenShareEncoding).toMatchObject({ maxFramerate: 60, maxBitrate: 8_000_000 })
    expect(options.degradationPreference).toBe('maintain-framerate')
    expect(options.screenShareSimulcastLayers?.map((layer) => layer.encoding.maxFramerate)).toEqual(
      [30, 60],
    )
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
