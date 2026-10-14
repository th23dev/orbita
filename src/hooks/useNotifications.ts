import { useEffect, useRef, useState } from 'react'
import { db } from '../lib/supabase'
import type { Channel, Message, Profile, Space } from '../lib/types'
import { notificationTarget, notificationWorker, shouldNotify, showDesktopNotification } from '../lib/notifications'
import type { NotificationTarget } from '../lib/notifications'

export function useNotifications(options: {
  userId: string; enabled: boolean; space: Space | null; profiles: Profile[]; channels: Channel[]
  open: (target: NotificationTarget) => void
  report: (message: string) => void
}) {
  const current = useRef(options)
  current.current = options
  const [notices, setNotices] = useState<(NotificationTarget & { messageId: string; title: string })[]>([])
  const dismiss = (id: string) => setNotices((items) => items.filter((item) => item.messageId !== id))
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const target = event.data
      if (target?.type === 'orbita-notification-open' && ['channel', 'dm'].includes(target.kind) &&
        typeof target.id === 'string' && /^[a-f0-9-]{36}$/.test(target.id)) current.current.open(target)
    }
    navigator.serviceWorker?.addEventListener('message', handler)
    return () => navigator.serviceWorker?.removeEventListener('message', handler)
  }, [])
  useEffect(() => {
    setNotices([])
    if (!options.enabled) return
    let live = true
    const seen = new Set<string>()
    void notificationWorker().catch(() => {})
    const sub = db().channel(`notifications:${options.userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, ({ new: row }) => {
        const message = row as Message
        const state = current.current
        if (!live || !state.enabled || seen.has(message.id)) return
        seen.add(message.id)
        if (seen.size > 200) seen.delete(seen.values().next().value!)
        const focused = !document.hidden && document.hasFocus()
        if (!shouldNotify(message, state.userId, state.space, focused)) return
        const target = notificationTarget(message)!
        const author = state.profiles.find((p) => p.id === message.author_id)?.display_name || 'Alguém'
        const channel = state.channels.find((c) => c.id === message.channel_id)
        const title = target.kind === 'dm' ? `${author} enviou uma mensagem` : `${author} em #${channel?.name || 'canal'}`
        const notice = { ...target, messageId: message.id, title }
        const showInApp = () => {
          if (live && current.current.enabled) setNotices((items) => [...items.slice(-3), notice])
        }
        if (focused) showInApp()
        else void showDesktopNotification(title, target, () => current.current.open(target))
          .then((shown) => { if (!shown) showInApp() })
      })
      .subscribe((status) => {
        if (live && status === 'CHANNEL_ERROR') current.current.report('Notificações desconectadas. Tentando reconectar…')
      })
    return () => { live = false; void db().removeChannel(sub) }
  }, [options.enabled, options.userId])
  return { notices, dismiss, open: options.open }
}
