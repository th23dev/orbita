import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { check, db, errorText } from '../lib/supabase'
import type { Attachment, Message, Reaction, Space } from '../lib/types'

export function useChat(space: Space, userId: string, report: (s: string) => void) {
  const [messages, setMessages] = useState<Message[]>([]),
    [reactions, setReactions] = useState<Reaction[]>([]),
    [attachments, setAttachments] = useState<Attachment[]>([])
  const [typing, setTyping] = useState<Record<string, number>>({}),
    [connected, setConnected] = useState(false),
    [more, setMore] = useState(true),
    [loading, setLoading] = useState(true)
  const live = useRef<RealtimeChannel | null>(null),
    lastType = useRef(0),
    rows = useRef<Message[]>([])
  const field = space.kind === 'channel' ? 'channel_id' : 'conversation_id'
  const merge = useCallback(
    (incoming: Message[]) =>
      setMessages((previous) => {
        const map = new Map(previous.map((m) => [m.id, m]))
        incoming.forEach((m) => {
          const old = map.get(m.id)
          if (
            !old ||
            (m.deleted_at || m.edited_at || m.created_at) >=
              (old.deleted_at || old.edited_at || old.created_at)
          )
            map.set(m.id, m)
        })
        const next = [...map.values()].sort(
          (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
        )
        rows.current = next
        return next
      }),
    [],
  )
  const fetchRelated = useCallback(async () => {
    const ids = rows.current.filter((m) => !m.deleted_at).map((m) => m.id)
    if (!ids.length) {
      setReactions([])
      setAttachments([])
      return
    }
    const [r, a] = await Promise.all([
      db().from('message_reactions').select('*').in('message_id', ids).eq('active', true),
      db().from('attachments').select('*').in('message_id', ids).eq('ready', true),
    ])
    setReactions(check(r) as Reaction[])
    setAttachments(check(a) as Attachment[])
  }, [])
  useEffect(() => {
    let active = true,
      timer: ReturnType<typeof setTimeout>
    const handle = (e: unknown) => {
      if (active) report(errorText(e))
    }
    const related = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (active) void fetchRelated().catch(handle)
      }, 120)
    }
    const sync = async () => {
      let query = db()
        .from('messages')
        .select('*')
        .eq(field, space.id)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
      if (rows.current.length) query = query.gte('created_at', rows.current[0].created_at)
      const data = check(await query.limit(rows.current.length ? 1000 : 50)) as Message[]
      if (active) {
        merge(data)
        setLoading(false)
        if (!rows.current.length) setMore(data.length === 50)
        related()
      }
    }
    const sub = db().channel(`${space.kind}:${space.id}`, {
      config: { private: true, broadcast: { self: false } },
    })
    sub.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'messages', filter: `${field}=eq.${space.id}` },
      (payload) => {
        if (payload.eventType !== 'DELETE') merge([payload.new as Message])
        related()
      },
    )
    for (const table of ['message_reactions', 'attachments'])
      sub.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `${field}=eq.${space.id}` },
        related,
      )
    sub
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (typeof payload?.user_id === 'string' && payload.user_id !== userId)
          setTyping((previous) => ({ ...previous, [payload.user_id]: Date.now() + 4000 }))
      })
      .subscribe((status) => {
        if (!active) return
        setConnected(status === 'SUBSCRIBED')
        if (status === 'SUBSCRIBED') void sync().catch(handle)
      })
    live.current = sub
    void sync().catch(handle)
    const interval = setInterval(
      () =>
        setTyping((previous) =>
          Object.fromEntries(Object.entries(previous).filter(([, until]) => until > Date.now())),
        ),
      1000,
    )
    const visibility = () => {
      if (!document.hidden) void sync().catch(handle)
    }
    document.addEventListener('visibilitychange', visibility)
    return () => {
      active = false
      clearTimeout(timer)
      clearInterval(interval)
      document.removeEventListener('visibilitychange', visibility)
      live.current = null
      void db().removeChannel(sub)
    }
  }, [space.id, space.kind, field, userId, report, merge, fetchRelated])
  async function loadMore() {
    const first = messages[0]
    if (!first) return
    const data = check(
      await db()
        .from('messages')
        .select('*')
        .eq(field, space.id)
        .or(
          `created_at.lt.${first.created_at},and(created_at.eq.${first.created_at},id.lt.${first.id})`,
        )
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(50),
    ) as Message[]
    merge(data)
    setMore(data.length === 50)
    // React applies the merged history on the next task.
    setTimeout(() => {
      void fetchRelated().catch((e) => report(errorText(e)))
    }, 0)
  }
  function sendTyping() {
    if (Date.now() - lastType.current > 1500) {
      lastType.current = Date.now()
      void live.current?.send({ type: 'broadcast', event: 'typing', payload: { user_id: userId } })
    }
  }
  return {
    messages,
    reactions,
    attachments,
    typing: Object.keys(typing),
    connected,
    loading,
    more,
    loadMore,
    sendTyping,
    merge,
    fetchRelated,
  }
}
