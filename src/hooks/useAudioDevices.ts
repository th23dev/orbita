import { useEffect, useSyncExternalStore } from 'react'

// The dock remains mounted while settings opens. Both must see the same inventory,
// including permissions granted by the other panel or by joining a call.
let snapshot: { devices: MediaDeviceInfo[]; error: string } = { devices: [], error: '' }
const listeners = new Set<() => void>()
let request = 0
const getSnapshot = () => snapshot
function publish(next: typeof snapshot) {
  snapshot = next
  listeners.forEach((listener) => listener())
}

async function refresh() {
  if (!navigator.mediaDevices?.enumerateDevices) return
  const current = ++request
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    if (current === request) publish({ devices, error: '' })
  } catch {
    if (current === request)
      publish({ ...snapshot, error: 'Não foi possível listar os dispositivos de áudio.' })
  }
}

function refreshWhenVisible() {
  if (!document.hidden) void refresh()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (listeners.size === 1) {
    navigator.mediaDevices?.addEventListener('devicechange', refresh)
    window.addEventListener('focus', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)
  }
  return () => {
    listeners.delete(listener)
    if (!listeners.size) {
      request++
      navigator.mediaDevices?.removeEventListener('devicechange', refresh)
      window.removeEventListener('focus', refreshWhenVisible)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }
}

async function authorize() {
  publish({ ...snapshot, error: '' })
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach((track) => track.stop())
    await refresh()
  } catch {
    publish({
      ...snapshot,
      error: 'Permita o acesso ao microfone no navegador para listar e testar seus dispositivos.',
    })
  }
}

export function useAudioDevices() {
  const { devices, error } = useSyncExternalStore(subscribe, getSnapshot)
  useEffect(() => {
    void refresh()
  }, [])
  return { devices, error, authorize, refresh }
}
