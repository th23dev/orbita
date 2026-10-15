import { useSyncExternalStore } from 'react'
import { isNoiseSuppressionMode } from './voice-gate'
import type { NoiseSuppressionMode } from './voice-gate'

export interface AudioPreferences {
  inputDevice: string
  outputDevice: string
  inputVolume: number
  outputVolume: number
  profile: 'voice' | 'studio' | 'custom'
  noiseSuppression: NoiseSuppressionMode
  echoCancellation: boolean
  autoGainControl: boolean
  autoSensitivity: boolean
  sensitivity: number
}

export const defaultAudioPreferences: AudioPreferences = {
  inputDevice: 'default',
  outputDevice: 'default',
  inputVolume: 1,
  outputVolume: 1,
  profile: 'voice',
  noiseSuppression: 'balanced',
  echoCancellation: true,
  autoGainControl: true,
  autoSensitivity: true,
  sensitivity: -50,
}
const key = 'orbita:audio-preferences'
export function parseAudioPreferences(value: unknown): AudioPreferences {
  const p = value && typeof value === 'object' ? (value as Partial<AudioPreferences>) : {}
  const number = (value: unknown, fallback: number, min: number, max: number) =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.max(min, Math.min(max, value))
      : fallback
  return {
    inputDevice: typeof p.inputDevice === 'string' && p.inputDevice ? p.inputDevice : 'default',
    outputDevice: typeof p.outputDevice === 'string' && p.outputDevice ? p.outputDevice : 'default',
    inputVolume: number(p.inputVolume, 1, 0, 2),
    outputVolume: number(p.outputVolume, 1, 0, 1),
    profile: p.profile === 'studio' || p.profile === 'custom' ? p.profile : 'voice',
    noiseSuppression: isNoiseSuppressionMode(p.noiseSuppression) ? p.noiseSuppression : 'balanced',
    echoCancellation: p.echoCancellation !== false,
    autoGainControl: p.autoGainControl !== false,
    autoSensitivity: p.autoSensitivity !== false,
    sensitivity: number(p.sensitivity, -50, -70, -20),
  }
}
function read() {
  try {
    return parseAudioPreferences(JSON.parse(localStorage.getItem(key) || '{}'))
  } catch {
    return { ...defaultAudioPreferences }
  }
}
let preferences = read()
const listeners = new Set<() => void>()
export const getAudioPreferences = () => preferences
export function updateAudioPreferences(patch: Partial<AudioPreferences>) {
  preferences = parseAudioPreferences({ ...preferences, ...patch })
  try {
    localStorage.setItem(key, JSON.stringify(preferences))
  } catch {
    /* Session still works. */
  }
  listeners.forEach((listener) => listener())
}
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export function useAudioPreferences() {
  return useSyncExternalStore(subscribe, getAudioPreferences)
}

export function processingPreferences(p: AudioPreferences) {
  if (p.profile === 'studio')
    return {
      ...p,
      noiseSuppression: 'off' as const,
      echoCancellation: false,
      autoGainControl: false,
    }
  if (p.profile === 'voice')
    return {
      ...p,
      noiseSuppression: 'balanced' as const,
      echoCancellation: true,
      autoGainControl: true,
      autoSensitivity: true,
    }
  return p
}

export const canSelectAudioOutput = () =>
  typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype
