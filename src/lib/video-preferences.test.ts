import { describe, expect, it } from 'vitest'
import {
  cameraCaptureOptions,
  cameraMediaConstraints,
  parseVideoPreferences,
} from './video-preferences'

describe('camera preferences', () => {
  it('recovers from malformed saved values', () => {
    const defaults = { device: 'default', quality: '720', mirror: true }
    expect(parseVideoPreferences(null)).toEqual(defaults)
    expect(parseVideoPreferences({ device: '', quality: '__proto__', mirror: 'false' })).toEqual(
      defaults,
    )
  })
  it('uses the selected device and matching resolution in previews and calls', () => {
    const preferences = parseVideoPreferences({
      device: 'usb-camera',
      quality: '1080',
      mirror: false,
    })
    expect(cameraCaptureOptions(preferences)).toEqual({
      deviceId: { exact: 'usb-camera' },
      resolution: { width: 1920, height: 1080, frameRate: 30 },
    })
    expect(cameraMediaConstraints(preferences)).toEqual({
      deviceId: { exact: 'usb-camera' },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 30 },
    })
    expect(preferences.mirror).toBe(false)
  })
  it('lets the browser choose the default camera without an invalid device constraint', () => {
    const preferences = parseVideoPreferences({ quality: '480' })
    expect(cameraCaptureOptions(preferences)).not.toHaveProperty('deviceId')
    expect(cameraMediaConstraints(preferences)).toMatchObject({
      width: { ideal: 854 },
      height: { ideal: 480 },
    })
  })
})
