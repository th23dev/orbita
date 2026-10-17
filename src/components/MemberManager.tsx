import { useEffect, useState } from 'react'
import { useServerPermissions } from '../hooks/useServerPermissions'
import type { Profile, Server, ServerMember } from '../lib/types'
import { check, db, errorText } from '../lib/supabase'
import { Avatar } from './ui'
import { useDialogs } from './Dialogs'

export function MemberManager({
  server,
  people,
  members,
  userId,
  refresh,
  report,
}: {
  server: Server
  people: Profile[]
  members: ServerMember[]
  userId: string
  refresh: () => Promise<void>
  report: (s: string) => void
}) {
  const dialogs = useDialogs()
  const [busy, setBusy] = useState(false)
  const owner = userId === server.owner_id
  const permissions = useServerPermissions(server.id)
  const manager = owner || members.some(m => m.user_id === userId && m.access_role === 'admin')
  const [bans, setBans] = useState<{ user_id: string; name?: string }[]>([])
  const loadBans = async () => {
    const rows = check(await db().from('server_bans').select('user_id').eq('server_id', server.id)) as { user_id: string }[]
    const profiles = rows.length ? check(await db().from('profiles').select('id,display_name').in('id', rows.map(row => row.user_id))) as { id: string; display_name: string }[] : []
    setBans(rows.map(row => ({ ...row, name: profiles.find(p => p.id === row.user_id)?.display_name })))
  }
  useEffect(() => { if (permissions.ban_members) void loadBans().catch(e => report(errorText(e))) }, [server.id, permissions.ban_members])
  const run = async (id: string, action: string) => {
    setBusy(true)
    try {
      if (action === 'ban' || action === 'unban') {
        check(await db().rpc('ban_member', { s: server.id, target_user: id, banned: action === 'ban' }))
        await loadBans()
      } else check(await db().rpc('manage_membership', { s: server.id, target_user: id, action }))
      await refresh()
    } catch (e) {
      report(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section>
      <h3>Membros e cargos</h3>
      <p className="muted">
        Administradores gerenciam canais e membros. Apenas o proprietário promove administradores.
      </p>
      {people.map((person) => {
        const role = members.find((m) => m.user_id === person.id)?.access_role || 'member'
        return (
          <div className="managed-person" key={person.id}>
            <Avatar profile={person} small />
            <div>
              <strong>{person.display_name}</strong>
              <small>
                {person.id === server.owner_id
                  ? 'Proprietário'
                  : role === 'admin'
                    ? 'Administrador'
                    : 'Membro'}
              </small>
            </div>
            {person.id !== server.owner_id && person.id !== userId && (
              <div className="member-actions">
                {owner && (
                  <select
                    aria-label={`Cargo de ${person.display_name}`}
                    disabled={busy}
                    value={role}
                    onChange={(e) =>
                      void run(person.id, e.target.value === 'admin' ? 'promote' : 'demote')
                    }
                  >
                    <option value="member">Membro</option>
                    <option value="admin">Administrador</option>
                  </select>
                )}
                {manager && (owner || role !== 'admin') && (
                  <button
                    className="text-button danger-text"
                    disabled={busy}
                    onClick={async () => {
                      if (
                        await dialogs.confirm({
                          title: 'Remover membro?',
                          message: `${person.display_name} perderá acesso ao servidor e aos canais.`,
                          confirm: 'Remover',
                          danger: true,
                        })
                      )
                        await run(person.id, 'remove')
                    }}
                  >
                    Remover
                  </button>
                )}
                {permissions.ban_members && role !== 'admin' && <button className="text-button danger-text" disabled={busy} onClick={async () => {
                  if (await dialogs.confirm({ title: 'Banir usuário?', message: `${person.display_name} perderá o acesso e não poderá entrar novamente por convite até o banimento ser revogado.`, confirm: 'Banir', danger: true })) await run(person.id, 'ban')
                }}>Banir</button>}
              </div>
            )}
          </div>
        )
      })}
      {permissions.ban_members && bans.length > 0 && <section><h3>Usuários banidos</h3>{bans.map(ban => <div className="managed-person" key={ban.user_id}><span>{ban.name || ban.user_id}</span><button disabled={busy} onClick={() => void run(ban.user_id, 'unban')}>Revogar banimento</button></div>)}</section>}
    </section>
  )
}
