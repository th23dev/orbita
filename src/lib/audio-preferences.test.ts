import { describe, expect, it } from 'vitest'
import {
  defaultAudioPreferences,
  parseAudioPreferences,
  processingPreferences,
} from './audio-preferences'

describe('audio preferences', () => {
  it('validates corrupt persisted preferences and bounds volume', () => {
    expect(parseAudioPreferences(null)).toEqual(defaultAudioPreferences)
    expect(
      parseAudioPreferences({
        inputVolume: Infinity,
        outputVolume: 50,
        inputDevice: '',
        sensitivity: -999,
        noiseSuppression: 'invalid',
      }),
    ).toMatchObject({
      inputVolume: 1,
      outputVolume: 1,
      inputDevice: 'default',
      sensitivity: -70,
      noiseSuppression: 'balanced',
    })
  })
  it('studio bypasses all voice processing while preserving volume', () => {
    expect(
      processingPreferences({ ...defaultAudioPreferences, profile: 'studio', inputVolume: 0.7 }),
    ).toMatchObject({
      noiseSuppression: 'off',
      echoCancellation: false,
      autoGainControl: false,
      inputVolume: 0.7,
    })
  })
  it('custom settings are retained when choosing a preset', () => {
    const custom = {
      ...defaultAudioPreferences,
      profile: 'custom' as const,
      noiseSuppression: 'strong' as const,
      autoGainControl: false,
    }
    expect(processingPreferences(custom)).toEqual(custom)
    expect(processingPreferences({ ...custom, profile: 'voice' })).toMatchObject({
      noiseSuppression: 'balanced',
      autoGainControl: true,
    })
    expect(custom.autoGainControl).toBe(false)
  })
})
