import { describe, expect, it } from 'vitest'
import { invitationCode, invitationLink } from './invitations'

const code = '11111111-2222-4333-8444-555555555555'
describe('server invitations', () => {
  it('accepts a pasted code, route or shared Pages link', () => {
    for (const input of [
      code,
      `  ${code}  `,
      `#/invite/${code}`,
      `https://th23dev.github.io/orbita/#/invite/${code}`,
      `https://orbita.undo.it/#/invite/${code}`,
    ])
      expect(invitationCode(input)).toBe(code)
  })
  it('rejects malformed links and unrelated routes', () => {
    for (const input of [
      'invalid',
      `#/channel/${code}`,
      `javascript:alert(1)#/invite/${code}`,
      `https://example.com/#/invite/${code}/extra`,
      `#/invite/${code}?extra=1`,
    ])
      expect(invitationCode(input)).toBeNull()
  })
  it('uses a reachable public URL when copied from local development', () => {
    expect(invitationLink(code, 'http://127.0.0.1:5173/#/channel/abc')).toBe(
      `https://th23dev.github.io/orbita/#/invite/${code}`,
    )
    expect(invitationLink(code, 'https://th23dev.github.io/orbita/?code=auth#/channel/abc')).toBe(
      `https://th23dev.github.io/orbita/#/invite/${code}`,
    )
  })
  it('preserves the custom domain and removes login parameters from shared invitations', () => {
    expect(invitationLink(code, 'https://orbita.undo.it/?code=auth#/channel/abc')).toBe(
      `https://orbita.undo.it/#/invite/${code}`,
    )
  })
})
