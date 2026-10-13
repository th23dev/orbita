const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const pendingInviteKey = 'orbita:pending-invite'

export function invitationCode(value: string): string | null {
  const input = value.trim()
  if (uuid.test(input)) return input.toLowerCase()
  const route = input.startsWith('#/')
    ? input
    : (() => {
        try {
          const url = new URL(input)
          return ['http:', 'https:'].includes(url.protocol) ? url.hash : ''
        } catch {
          return ''
        }
      })()
  const code = route.match(/^#\/invite\/([^/?#]+)\/?$/)?.[1]
  return code && uuid.test(code) ? code.toLowerCase() : null
}

export function invitationLink(code: string, location = window.location.href): string {
  const url = new URL(location)
  // A loopback link cannot be opened by a friend on another device.
  const base = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    ? new URL('https://th23dev.github.io/orbita/')
    : url
  base.search = ''
  base.hash = `/invite/${code}`
  return base.href
}

export function rememberInvitation(hash: string) {
  const code = invitationCode(hash)
  if (code) {
    try {
      sessionStorage.setItem(pendingInviteKey, code)
    } catch {
      /* Hash still preserves it. */
    }
  }
  return code
}

export function pendingInvitation() {
  const code = rememberInvitation(window.location.hash)
  if (code) return code
  try {
    return invitationCode(sessionStorage.getItem(pendingInviteKey) || '')
  } catch {
    return null
  }
}

export function clearInvitation() {
  try {
    sessionStorage.removeItem(pendingInviteKey)
  } catch {
    /* Optional storage. */
  }
  if (window.location.hash.startsWith('#/invite/')) window.history.replaceState(null, '', '#/')
}
