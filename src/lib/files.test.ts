import { describe, expect, it } from 'vitest'
import { safePreview, validateFile } from './files'

describe('Untrusted uploads', () => {
  it('rejects empty and oversized files', () => {
    for (const size of [0, 26214401])
      expect(() => validateFile({ name: 'x.zip', type: 'application/zip', size })).toThrow()
  })
  it('permits ordinary documents as download-only attachments', () => {
    expect(() => validateFile({ name: 'source.ts', type: 'text/plain', size: 20 })).not.toThrow()
    expect(safePreview('text/html')).toBe(false)
    expect(safePreview('image/svg+xml')).toBe(false)
    expect(safePreview('application/pdf')).toBe(false)
  })
  it('limits avatars to passive images and two megabytes', () => {
    expect(() =>
      validateFile({ name: 'x.svg', type: 'image/svg+xml', size: 50 }, 'avatar'),
    ).toThrow()
    expect(() =>
      validateFile({ name: 'x.png', type: 'image/png', size: 2097153 }, 'avatar'),
    ).toThrow()
  })
  it('limits sounds to supported audio types', () => {
    expect(() => validateFile({ name: 'x.mp3', type: 'text/html', size: 50 }, 'sound')).toThrow()
    expect(() =>
      validateFile({ name: 'x.ogg', type: 'audio/ogg', size: 50 }, 'sound'),
    ).not.toThrow()
  })
})
