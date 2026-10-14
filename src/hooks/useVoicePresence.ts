import { useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { db } from '../lib/supabase'
import type { Channel } from '../lib/types'
import { reconcileVoiceMembers, voiceMembers } from '../lib/voice-roster'
import type { VoiceMember, VoiceSession, VoiceState } from '../lib/voice-roster'

export type VoicePresence = VoiceState & { channelId: string }
export type { VoiceMember } from '../lib/voice-roster'

// Stable membership uses presence; frequent media changes use broadcast.
// Each private topic inherits the channel's existing Realtime authorization.
export function useVoicePresence(
  channels: Channel[],
  userId: string,
  active: VoicePresence | null,
) {
  const [rosters, setRosters] = useState<Record<string, VoiceMember[]>>({})
  const latestRosters = useRef<Record<string, VoiceMember[]>>({})
  const current = useRef(active)
  const synchronize = useRef(() => {})
  const channelKey = channels
    .filter((channel) => channel.kind === 'voice')
    .map((channel) => channel.id)
    .sort()
    .join(',')
  useEffect(() => {
    current.current = active
    synchronize.current()
  }, [active])
  useEffect(() => {
    let live = true
    const ids = channelKey.split(',').filter(Boolean)
    latestRosters.current = Object.fromEntries(
      Object.entries(latestRosters.current).filter(([id]) => ids.includes(id)),
    )
    setRosters(latestRosters.current)
    const entries: {
      id: string
      room: RealtimeChannel
      ready: boolean
      tracked: boolean
      busy: boolean
      lastStatus: string
      sessionId: string
      sequence: number
      broadcastAt: number
      synced: boolean
      visible: VoiceMember[]
      missing: Map<string, number>
      updates: Map<string, VoiceState & { sequence: number }>
    }[] = []
    const publish = async (entry: (typeof entries)[number]) => {
      if (!live || !entry.ready || entry.busy) return
      const value = current.current?.channelId === entry.id ? current.current : null
      entry.busy = true
      try {
        if (value && !entry.tracked) {
          const status = await entry.room.track({
            inCall: true,
            sessionId: entry.sessionId,
            ...value,
          })
          if (!live) return
          if (status === 'ok') {
            entry.tracked = true
            entry.lastStatus = ''
          }
        } else if (!value && entry.tracked) {
          if ((await entry.room.untrack()) === 'ok') {
            entry.tracked = false
            entry.lastStatus = ''
          }
        } else if (value && entry.tracked && Date.now() - entry.broadcastAt >= 300) {
          const signature = JSON.stringify(value)
          if (signature !== entry.lastStatus || Date.now() - entry.broadcastAt >= 5000) {
            entry.broadcastAt = Date.now()
            const status = await entry.room.send({
              type: 'broadcast',
              event: 'voice-state',
              payload: { ...value, sessionId: entry.sessionId, sequence: ++entry.sequence },
            })
            if (status === 'ok') entry.lastStatus = signature
          }
        }
      } catch {
        // Transient transport failures are retried by the next tick/rejoin.
      } finally {
        entry.busy = false
        // A departure during an in-flight track/send must not wait for the next tick.
        const next = current.current?.channelId === entry.id ? current.current : null
        if (live && Boolean(next) !== Boolean(value)) void publish(entry)
      }
    }
    const render = (entry: (typeof entries)[number]) => {
      if (!live) return
      const snapshot = entry.synced ? entry.room.presenceState<VoiceSession>() : {}
      const locallyActive = current.current?.channelId === entry.id
      const members = voiceMembers(snapshot, entry.updates,
        locallyActive ? undefined : entry.sessionId)
      // Only transport interruptions need a grace period. A synchronized departure
      // (including our own local departure) should disappear immediately.
      const previous = locallyActive || members.some((member) => member.userId === userId)
        ? entry.visible
        : entry.visible.filter((member) => member.userId !== userId)
      const next = reconcileVoiceMembers(previous, members, entry.missing, Date.now(),
        entry.synced ? 0 : 1500)
      if (JSON.stringify(next) !== JSON.stringify(entry.visible)) {
        entry.visible = next
        latestRosters.current = { ...latestRosters.current, [entry.id]: next }
        setRosters(latestRosters.current)
      }
    }
    for (const id of ids) {
      const room = db().channel(`channel:${id}:voice-roster`, {
        config: { private: true, presence: { key: userId }, broadcast: { self: true } },
      })
      const entry: (typeof entries)[number] = {
        id,
        room,
        ready: false,
        tracked: false,
        busy: false,
        lastStatus: '',
        sessionId: crypto.randomUUID(),
        sequence: 0,
        broadcastAt: 0,
        synced: false,
        visible: latestRosters.current[id] || [],
        missing: new Map(),
        updates: new Map(),
      }
      entries.push(entry)
      room
        .on('presence', { event: 'sync' }, () => {
          entry.synced = true
          render(entry)
        })
        .on('presence', { event: 'join' }, () => {
          // Send fresh flags to a newly connected observer.
          entry.lastStatus = ''
        })
        .on('broadcast', { event: 'voice-state' }, ({ payload }) => {
          if (
            !payload ||
            typeof payload.sessionId !== 'string' ||
            !Number.isFinite(payload.sequence) ||
            !['muted', 'speaking', 'camera', 'screen'].every(
              (key) => typeof payload[key] === 'boolean',
            )
          )
            return
          const known = Object.values(room.presenceState<VoiceSession>()).some((sessions) =>
            sessions.some(
              (session) => session.sessionId === payload.sessionId && session.inCall === true,
            ),
          )
          if (!known || payload.sequence <= (entry.updates.get(payload.sessionId)?.sequence ?? -1))
            return
          entry.updates.set(payload.sessionId, payload)
          render(entry)
        })
        .subscribe((status) => {
          if (!live) return
          if (status === 'SUBSCRIBED') {
            entry.ready = true
            void publish(entry)
          } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            entry.ready = false
            entry.tracked = false
            entry.synced = false
            render(entry)
          }
        })
    }
    const sync = () => {
      for (const entry of entries) {
        void publish(entry)
        render(entry)
      }
    }
    synchronize.current = sync
    // Coalesce frequent flags. A five-second broadcast refresh also updates
    // observers who subscribe without joining the call/publishing presence.
    const timer = setInterval(sync, 300)
    const onPageHide = () => {
      current.current = null
      for (const entry of entries) {
        // Send before the browser closes the socket, even if a media broadcast is pending.
        if (entry.ready) void entry.room.untrack().catch(() => {})
      }
      sync()
    }
    window.addEventListener('pagehide', onPageHide)
    return () => {
      live = false
      clearInterval(timer)
      window.removeEventListener('pagehide', onPageHide)
      synchronize.current = () => {}
      for (const entry of entries) void db().removeChannel(entry.room)
    }
  }, [channelKey, userId])
  return rosters
}
