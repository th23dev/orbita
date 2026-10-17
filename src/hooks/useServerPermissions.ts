import { useEffect, useState } from 'react'
import { db } from '../lib/supabase'
import { noPermissions, type Permissions } from '../lib/permissions'

export function useServerPermissions(serverId: string | null | undefined) {
  return useServerPermissionState(serverId).permissions
}

export function useServerPermissionState(serverId: string | null | undefined) {
  const [state, setState] = useState<{ id: string; permissions: Permissions; error: boolean } | null>(null)
  useEffect(() => {
    if (!serverId) return
    let active = true
    const load = async () => {
      try {
        const { data, error } = await db().rpc('server_permissions', { s: serverId })
        if (active) setState({ id: serverId, permissions: error || !data ? noPermissions : { ...noPermissions, ...data }, error: Boolean(error || !data) })
      } catch {
        if (active) setState({ id: serverId, permissions: noPermissions, error: true })
      }
    }
    void load()
    const subscription = db().channel(`permissions:${serverId}:${crypto.randomUUID()}`)
    for (const table of ['roles', 'member_roles', 'server_members']) {
      subscription.on('postgres_changes', { event: '*', schema: 'public', table, filter: `server_id=eq.${serverId}` }, () => { void load() })
    }
    subscription.subscribe()
    const timer = window.setInterval(() => { void load() }, 15000)
    return () => { active = false; clearInterval(timer); void db().removeChannel(subscription) }
  }, [serverId])
  const current = state?.id === serverId ? state : null
  return { permissions: current?.permissions ?? noPermissions, loading: Boolean(serverId && !current), error: current?.error ?? false }
}
