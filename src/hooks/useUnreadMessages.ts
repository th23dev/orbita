import { useCallback, useEffect, useRef, useState } from 'react'
import { db } from '../lib/supabase'
import type { Channel } from '../lib/types'

type ReadState = { since: string; channels: Record<string, string> }
function loadReadState(key: string): ReadState {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null')
    if (value && Number.isFinite(Date.parse(value.since)) && typeof value.channels === 'object' && value.channels)
      return { since: value.since, channels: Object.fromEntries(Object.entries(value.channels)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && Number.isFinite(Date.parse(entry[1])))) }
  } catch { /* Keep tracking in memory when browser storage is unavailable. */ }
  return { since: new Date().toISOString(), channels: {} }
}

export function useUnreadMessages(userId: string, channels: Channel[]) {
  const key = `orbita:read-messages:${userId}`
  const read = useRef(loadReadState(key))
  const [counts, setCounts] = useState<Record<string, number>>({})
  const refreshChannel = useRef<(id: string) => void>(() => {})
  const channelKey = channels.filter((channel) => channel.kind === 'text').map((channel) => channel.id).sort().join(',')
  const markRead = useCallback((id: string, timestamp: string) => {
    const previous = read.current.channels[id] || read.current.since
    if (!Number.isFinite(Date.parse(timestamp)) || Date.parse(timestamp) <= Date.parse(previous)) return
    read.current.channels[id] = timestamp
    try { localStorage.setItem(key, JSON.stringify(read.current)) } catch { /* Optional persistence. */ }
    setCounts((previous) => ({ ...previous, [id]: 0 }))
    refreshChannel.current(id)
  }, [key])

  useEffect(() => {
    read.current = loadReadState(key)
    try { localStorage.setItem(key, JSON.stringify(read.current)) } catch { /* Optional persistence. */ }
    setCounts({})
  }, [key])
  useEffect(() => {
    let live = true
    const ids = channelKey.split(',').filter(Boolean)
    const versions = new Map<string, number>()
    const timers = new Map<string, ReturnType<typeof setTimeout>>()
    const update = async (id: string) => {
      if (!live || !ids.includes(id)) return
      const version = (versions.get(id) || 0) + 1
      versions.set(id, version)
      const since = read.current.channels[id] || read.current.since
      const { count, error } = await db().from('messages').select('id', { count: 'exact', head: true })
        .eq('channel_id', id).neq('author_id', userId).is('deleted_at', null).gt('created_at', since)
      if (!live || error || versions.get(id) !== version || since !== (read.current.channels[id] || read.current.since)) return
      setCounts((previous) => previous[id] === count ? previous : { ...previous, [id]: count || 0 })
    }
    const schedule = (id: string) => {
      clearTimeout(timers.get(id))
      timers.set(id, setTimeout(() => {
        timers.delete(id)
        void update(id).catch(() => {})
      }, 100))
    }
    refreshChannel.current = schedule
    const refresh = () => ids.forEach(schedule)
    const storage = (event: StorageEvent) => {
      if (event.key === key) { read.current = loadReadState(key); refresh() }
    }
    const sub = db().channel(`unread:${userId}`).on('postgres_changes',
      { event: '*', schema: 'public', table: 'messages' }, ({ new: row, eventType }) => {
        if (eventType === 'DELETE') refresh()
        else if ('channel_id' in row && typeof row.channel_id === 'string') schedule(row.channel_id)
      }).subscribe((status) => { if (status === 'SUBSCRIBED') refresh() })
    refresh()
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    window.addEventListener('storage', storage)
    return () => {
      live = false
      timers.forEach(clearTimeout)
      refreshChannel.current = () => {}
      window.removeEventListener('focus', refresh)
      window.removeEventListener('online', refresh)
      window.removeEventListener('storage', storage)
      void db().removeChannel(sub)
    }
  }, [channelKey, userId, key])
  const servers: Record<string, number> = {}
  for (const channel of channels) servers[channel.server_id] = (servers[channel.server_id] || 0) + (counts[channel.id] || 0)
  return { servers, markRead }
}
