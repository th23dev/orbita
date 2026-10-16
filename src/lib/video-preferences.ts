import { useSyncExternalStore } from 'react'
import type { VideoCaptureOptions } from 'livekit-client'

export const cameraQualities = {
  '480': { label: '480p · mais leve', width: 854, height: 480 },
  '720': { label: '720p · equilibrado', width: 1280, height: 720 },
  '1080': { label: '1080p · mais detalhes', width: 1920, height: 1080 },
}
export interface VideoPreferences {
  device: string
  quality: keyof typeof cameraQualities
  mirror: boolean
}
export function parseVideoPreferences(value: unknown): VideoPreferences {
  const p = value && typeof value === 'object' ? (value as Partial<VideoPreferences>) : {}
  return {
    device: typeof p.device === 'string' && p.device ? p.device : 'default',
    quality: p.quality === '480' || p.quality === '1080' ? p.quality : '720',
    mirror: p.mirror !== false,
  }
}
const key = 'orbita:video-preferences'
function read() {
  try {
    return parseVideoPreferences(JSON.parse(localStorage.getItem(key) || '{}'))
  } catch {
    return parseVideoPreferences(null)
  }
}
let preferences = read()
const listeners = new Set<() => void>()
export const getVideoPreferences = () => preferences
export function updateVideoPreferences(patch: Partial<VideoPreferences>) {
  preferences = parseVideoPreferences({ ...preferences, ...patch })
  try {
    localStorage.setItem(key, JSON.stringify(preferences))
  } catch {
    /* Keep preferences for this session when storage is unavailable. */
  }
  listeners.forEach((listener) => listener())
}
export function useVideoPreferences() {
  return useSyncExternalStore(subscribe, getVideoPreferences)
}
function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export function cameraCaptureOptions(p = getVideoPreferences()): VideoCaptureOptions {
  const { width, height } = cameraQualities[p.quality]
  return {
    ...(p.device !== 'default' ? { deviceId: { exact: p.device } } : {}),
    resolution: { width, height, frameRate: 30 },
  }
}
export function cameraMediaConstraints(p: VideoPreferences): MediaTrackConstraints {
  const { width, height } = cameraQualities[p.quality]
  return {
    ...(p.device !== 'default' ? { deviceId: { exact: p.device } } : {}),
    width: { ideal: width },
    height: { ideal: height },
    frameRate: { ideal: 30 },
  }
}
