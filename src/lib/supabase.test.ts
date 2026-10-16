import { afterEach, describe, expect, it, vi } from 'vitest'
import { redirectUrl } from './supabase'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('authentication return URL', () => {
  it.each([
    ['./', 'https://orbita.undo.it/?code=secret#/channel/abc', 'https://orbita.undo.it/'],
    ['./', 'https://th23dev.github.io/orbita/?code=secret#/channel/abc', 'https://th23dev.github.io/orbita/'],
    ['/', 'http://localhost:5173/?code=secret#/channel/abc', 'http://localhost:5173/'],
    ['/orbita/', 'https://th23dev.github.io/orbita/#/channel/abc', 'https://th23dev.github.io/orbita/'],
  ])('resolves base %s from %s without retaining credentials or routes', (base, href, expected) => {
    vi.stubEnv('BASE_URL', base)
    vi.stubGlobal('window', { location: { href } })
    expect(redirectUrl()).toBe(expected)
  })
})
