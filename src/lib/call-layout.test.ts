import { expect, it } from 'vitest'
import { featuredStream } from './call-layout'
const camera = { sid: 'camera', kind: 'camera' as const }
const screen = { sid: 'screen', kind: 'screen' as const }
it('features one camera and prefers a shared screen by default', () => {
  expect(featuredStream([camera], null)).toBe(camera)
  expect(featuredStream([camera, screen], null)).toBe(screen)
})
it('lets the viewer choose a camera or another screen', () => {
  const other = { sid: 'other', kind: 'screen' as const }
  expect(featuredStream([camera, screen, other], 'camera')).toBe(camera)
  expect(featuredStream([camera, screen, other], 'other')).toBe(other)
})
it('falls back when the chosen stream ends and leaves multiple cameras in a grid', () => {
  expect(featuredStream([screen], 'camera')).toBe(screen)
  expect(featuredStream([camera, { ...camera, sid: 'second' }], null)).toBeNull()
  expect(featuredStream([], 'camera')).toBeNull()
})
