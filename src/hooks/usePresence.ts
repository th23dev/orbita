import { useEffect, useState } from 'react'
import { db } from '../lib/supabase'
import type { Profile } from '../lib/types'

export function usePresence(topic: string | null, me?: Profile) {
  const [online, setOnline] = useState<string[]>([])
  useEffect(() => {
    setOnline([])
    if (!topic || !me) return
    const channel = db().channel(topic, { config: { private: true, presence: { key: me.id } } })
    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<{ status: string }>()
        setOnline(Object.keys(state).filter((id) => state[id].some((p) => p.status !== 'offline')))
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') void channel.track({ status: me.status })
      })
    return () => {
      void db().removeChannel(channel)
    }
  }, [topic, me?.id, me?.status])
  return online
}
