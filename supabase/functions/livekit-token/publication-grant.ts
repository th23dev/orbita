import { TrackSource } from 'npm:@livekit/protocol@1.51.0'
import type { VideoGrant } from 'npm:livekit-server-sdk@2.19.1'

export function publicationGrant(permissions: {
  speak?: boolean
  use_camera?: boolean
  share_screen?: boolean
}): Pick<VideoGrant, 'canPublish' | 'canPublishSources'> {
  // Unrestricted members may also publish the independent soundboard track.
  // UNKNOWN cannot be serialized in canPublishSources by the LiveKit SDK.
  if (permissions.speak && permissions.use_camera && permissions.share_screen)
    return { canPublish: true }

  const sources: TrackSource[] = []
  if (permissions.speak) sources.push(TrackSource.MICROPHONE)
  if (permissions.use_camera) sources.push(TrackSource.CAMERA)
  if (permissions.share_screen)
    sources.push(TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO)
  return { canPublish: sources.length > 0, canPublishSources: sources }
}
