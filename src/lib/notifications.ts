import type { Message, Space } from './types'

export type NotificationTarget = { kind: 'channel' | 'dm'; id: string }
export function notificationTarget(message: Message): NotificationTarget | null {
  if (message.channel_id) return { kind: 'channel', id: message.channel_id }
  if (message.conversation_id) return { kind: 'dm', id: message.conversation_id }
  return null
}
export function shouldNotify(message: Message, userId: string, space: Space | null, focused: boolean) {
  if (message.author_id === userId || message.deleted_at || !notificationTarget(message)) return false
  if (!focused || !space) return true
  return space.kind === 'channel'
    ? message.channel_id !== space.id
    : ![space.id, ...(space.conversationIds || [])].includes(message.conversation_id || '')
}

let registration: Promise<ServiceWorkerRegistration> | null = null
export function notificationWorker() {
  if (!('serviceWorker' in navigator)) return Promise.reject(new Error('Service worker indisponível'))
  registration ??= (async () => {
    await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}notifications-sw.js`)
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Notificações indisponíveis')), 8000) }),
      ])
    } finally { clearTimeout(timer) }
  })().catch((error) => { registration = null; throw error })
  return registration
}

export async function showDesktopNotification(title: string, target: NotificationTarget, open: () => void) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false
  const options = {
    body: 'Abra a Órbita para ler a mensagem.',
    tag: `orbita:${target.kind}:${target.id}`,
    icon: `${import.meta.env.BASE_URL}orbita-logo.png`,
    data: target,
  }
  try {
    const worker = await notificationWorker()
    await worker.showNotification(title, options)
    return true
  } catch {
    try {
      const notification = new Notification(title, options)
      notification.onclick = () => { notification.close(); window.focus(); open() }
      return true
    } catch { return false }
  }
}
