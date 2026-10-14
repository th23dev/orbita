import { useCallback, useEffect, useState } from 'react'
import { check, db, errorText } from '../lib/supabase'
import type {
  Channel,
  Conversation,
  Friendship,
  Profile,
  Server,
  Settings,
  ServerMember,
  ChannelMembership,
  CommunityInvite,
} from '../lib/types'

export function useWorkspace(userId: string, report: (s: string) => void) {
  const [servers, setServers] = useState<Server[]>([]),
    [channels, setChannels] = useState<Channel[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([]),
    [conversations, setConversations] = useState<Conversation[]>([])
  const [friends, setFriends] = useState<Friendship[]>([]),
    [members, setMembers] = useState<ServerMember[]>([])
  const [channelMembers, setChannelMembers] = useState<ChannelMembership[]>([])
  const [invites, setInvites] = useState<CommunityInvite[]>([])
  const [dmMembers, setDmMembers] = useState<{ conversation_id: string; user_id: string }[]>([])
  const [communityReady, setCommunityReady] = useState(true)
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
      db().from('server_members').select('*'),
      db().from('user_settings').select('*').eq('user_id', userId).single(),
      db().from('channel_memberships').select('*'),
      db().from('community_invites').select('*').eq('invitee_id', userId),
      db().from('direct_conversation_members').select('*'),
    ])
    const [s, c, p, d, f, m, st] = results.slice(0, 7).map(check)
    // A rolling frontend/database update must not hide existing workspace data.
    const missingSchema = (error: { code?: string } | null) =>
      error && ['42P01', '42703', 'PGRST205', 'PGRST204'].includes(error.code || '')
    const ready = !results.slice(7, 9).some((result) => missingSchema(result.error))
    const cm = missingSchema(results[7].error) ? [] : check(results[7])
    const ci = missingSchema(results[8].error) ? [] : check(results[8])
    const dm = check(results[9])
    setCommunityReady(ready)
    setServers(s as Server[])
    setChannels(c as Channel[])
    setProfiles(p as Profile[])
    setConversations(d as Conversation[])
    setFriends(f as Friendship[])
    setMembers(
      (m as typeof members).map((member) => ({
        ...member,
        access_role: member.access_role || 'member',
      })),
    )
    setSettings(st as Settings)
    setChannelMembers(cm as ChannelMembership[])
    setInvites(ci as CommunityInvite[])
    setDmMembers(dm as typeof dmMembers)
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
      'channel_member_permissions',
      'roles',
      'community_invites',
      'channel_memberships',
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
  return {
    servers,
    channels,
    profiles,
    conversations,
    friends,
    members,
    channelMembers,
    invites,
    dmMembers,
    communityReady,
    settings,
    loading,
    refresh,
    me: profiles.find((p) => p.id === userId),
  }
}
