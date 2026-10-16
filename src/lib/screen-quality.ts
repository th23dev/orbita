import { AudioPresets, ConnectionState, Track, VideoPreset } from 'livekit-client'
import type {
  AudioCaptureOptions,
  Room,
  ScreenShareCaptureOptions,
  TrackPublishOptions,
} from 'livekit-client'

export const screenQualities = {
  '1080p60': { label: '1080p · 60 fps', width: 1920, height: 1080, fps: 60, bitrate: 8_000_000 },
  '1080p30': { label: '1080p · 30 fps', width: 1920, height: 1080, fps: 30, bitrate: 5_000_000 },
  '720p60': { label: '720p · 60 fps', width: 1280, height: 720, fps: 60, bitrate: 4_000_000 },
  '720p30': { label: '720p · 30 fps', width: 1280, height: 720, fps: 30, bitrate: 2_500_000 },
  '480p30': {
    label: '480p · 30 fps (economia)',
    width: 854,
    height: 480,
    fps: 30,
    bitrate: 1_000_000,
  },
} as const

export type ScreenQuality = keyof typeof screenQualities
export const defaultScreenQuality: ScreenQuality = '1080p60'

export function screenCaptureOptions(quality: ScreenQuality): ScreenShareCaptureOptions {
  const { width, height, fps } = screenQualities[quality]
  // Keep this inside `audio`: the installed SDK does not forward its top-level
  // suppressLocalAudioPlayback option into getDisplayMedia's audio constraints.
  const audio: AudioCaptureOptions & { suppressLocalAudioPlayback: boolean } = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 2,
    suppressLocalAudioPlayback: false,
  }
  return {
    audio,
    selfBrowserSurface: 'exclude',
    systemAudio: 'include',
    contentHint: 'motion',
    resolution: { width, height, frameRate: fps },
  }
}

export function screenVideoCodec(): 'h264' | 'vp8' {
  // H.264 may use the GPU encoder. Availability does not guarantee acceleration.
  const codecs =
    typeof RTCRtpSender !== 'undefined'
      ? RTCRtpSender.getCapabilities?.('video')?.codecs
      : undefined
  return codecs?.some((codec) => codec.mimeType.toLowerCase() === 'video/h264') ? 'h264' : 'vp8'
}

export function screenPublishOptions(quality: ScreenQuality): TrackPublishOptions {
  const { height, fps, bitrate } = screenQualities[quality]
  return {
    // Leave source unset: setScreenShareEnabled also uses these options for shared audio.
    videoCodec: screenVideoCodec(),
    audioPreset: AudioPresets.musicHighQualityStereo,
    forceStereo: true,
    dtx: false,
    degradationPreference: 'maintain-framerate',
    screenShareEncoding: { maxBitrate: bitrate, maxFramerate: fps, priority: 'high' },
    simulcast: true,
    // Preserve the selected fps on the main stream. Auxiliary streams should not
    // compete with a running game by encoding a second 60 fps video.
    screenShareSimulcastLayers: [
      height > 480
        ? new VideoPreset(854, 480, 800_000, 15)
        : new VideoPreset(640, 360, 500_000, 15),
      ...(height > 720 ? [new VideoPreset(1280, 720, 2_500_000, 30)] : []),
    ],
  }
}

export function screenConstraints(quality: ScreenQuality): MediaTrackConstraints {
  const { width, height, fps } = screenQualities[quality]
  return {
    width: { ideal: width, max: width },
    height: { ideal: height, max: height },
    frameRate: { ideal: fps, max: fps },
  }
}

// Reuse the existing capture so changing quality never opens the screen picker again.
// Republish only screen video: the microphone, camera and shared audio keep running.
export async function changePublishedScreenQuality(room: Room, quality: ScreenQuality) {
  const participant = room.localParticipant
  const publication = participant.getTrackPublication(Track.Source.ScreenShare)
  const track = publication?.videoTrack
  if (!track) return
  const previousConstraints = track.mediaStreamTrack.getConstraints()
  const previousOptions = publication.options
  const canPublish = () =>
    room.state === ConnectionState.Connected && track.mediaStreamTrack.readyState !== 'ended'
  let unpublished = false
  try {
    await track.mediaStreamTrack.applyConstraints(screenConstraints(quality))
    if (!canPublish()) throw new Error('A transmissão foi encerrada.')
    await participant.unpublishTrack(track, false)
    unpublished = true
    if (!canPublish()) throw new Error('A transmissão foi encerrada.')
    await participant.publishTrack(track, screenPublishOptions(quality))
  } catch (error) {
    if (track.mediaStreamTrack.readyState !== 'ended' && room.state === ConnectionState.Connected) {
      try {
        await track.mediaStreamTrack.applyConstraints(previousConstraints)
        if (unpublished) await participant.publishTrack(track, previousOptions)
      } catch {
        track.stop()
        await participant.unpublishTrack(track).catch(() => {})
        const audio = participant.getTrackPublication(Track.Source.ScreenShareAudio)?.track
        if (audio) await participant.unpublishTrack(audio).catch(() => {})
        throw new Error('Não foi possível recuperar a transmissão. Compartilhe a tela novamente.')
      }
    } else if (unpublished) {
      track.stop()
    }
    throw error
  }
}

export function setReceivedScreenQuality(room: Room, quality: ScreenQuality) {
  const { width, height, fps } = screenQualities[quality]
  for (const participant of room.remoteParticipants.values()) {
    const publication = participant.getTrackPublication(Track.Source.ScreenShare)
    publication?.setVideoDimensions({ width, height })
    publication?.setVideoFPS(fps)
  }
}
