import { useCallback, useEffect, useState } from 'react'
import { check, db, errorText } from '../lib/supabase'
import type { Channel, Conversation, Friendship, Profile, Server, Settings } from '../lib/types'

export function useWorkspace(userId: string, report: (s: string) => void) {
  const [servers, setServers] = useState<Server[]>([]),
    [channels, setChannels] = useState<Channel[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([]),
    [conversations, setConversations] = useState<Conversation[]>([])
  const [friends, setFriends] = useState<Friendship[]>([]),
    [members, setMembers] = useState<{ server_id: string; user_id: string }[]>([])
  const [settings, setSettings] = useState<Settings>({
    user_id: userId,
    theme: 'dark',
    notifications: false,
    soundboard_volume: 0.5,
  })
  const [loading, setLoading] = useState(true)
  const refresh = useCallback(async () => {
    const results = await Promise.all([
      db().from('servers').select('*').order('created_at'),
      db().from('channels').select('*').eq('archived', false).order('created_at'),
      db().from('profiles').select('*').limit(1000),
      db().from('direct_conversations').select('*').order('created_at'),
      db().from('friendships').select('*'),
      db().from('server_members').select('server_id,user_id'),
      db().from('user_settings').select('*').eq('user_id', userId).single(),
    ])
    const [s, c, p, d, f, m, st] = results.map(check)
    setServers(s as Server[])
    setChannels(c as Channel[])
    setProfiles(p as Profile[])
    setConversations(d as Conversation[])
    setFriends(f as Friendship[])
    setMembers(m as typeof members)
    setSettings(st as Settings)
    setLoading(false)
  }, [userId])
  useEffect(() => {
    let active = true,
      timer: ReturnType<typeof setTimeout>
    const reload = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (active)
          void refresh().catch((e) => {
            report(errorText(e))
            setLoading(false)
          })
      }, 150)
    }
    const sub = db().channel(`workspace:${userId}`)
    for (const table of [
      'servers',
      'channels',
      'server_members',
      'profiles',
      'user_settings',
      'friendships',
      'direct_conversations',
      'direct_conversation_members',
      'member_roles',
      'channel_permissions',
      'roles',
    ]) {
      sub.on('postgres_changes', { event: '*', schema: 'public', table }, reload)
    }
    sub.subscribe((status) => {
      if (status === 'SUBSCRIBED') reload()
      if (status === 'CHANNEL_ERROR')
        report('Não foi possível sincronizar. Verifique a conexão e a configuração Realtime.')
    })
    reload()
    const visibility = () => {
      if (!document.hidden) reload()
    }
    window.addEventListener('online', reload)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      active = false
      clearTimeout(timer)
      void db().removeChannel(sub)
      window.removeEventListener('online', reload)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [userId, refresh, report])
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme
  }, [settings.theme])
  useEffect(() => {
    if (
      !settings.notifications ||
      !('Notification' in window) ||
      Notification.permission !== 'granted'
    )
      return
    const sub = db()
      .channel(`notifications:${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        ({ new: row }) => {
          if (row.author_id !== userId && document.hidden)
            new Notification('Nova mensagem na Órbita', {
              body: 'Abra a Órbita para ler a conversa.',
              tag: row.channel_id || row.conversation_id,
            })
        },
      )
      .subscribe()
    return () => {
      void db().removeChannel(sub)
    }
  }, [settings.notifications, userId])
  return {
    servers,
    channels,
    profiles,
    conversations,
    friends,
    members,
    settings,
    loading,
    refresh,
    me: profiles.find((p) => p.id === userId),
  }
}
