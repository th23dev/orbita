import { useState } from 'react'
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
  const run = async (id: string, action: string) => {
    setBusy(true)
    try {
      check(await db().rpc('manage_membership', { s: server.id, target_user: id, action }))
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
                {(owner || role !== 'admin') && (
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
              </div>
            )}
          </div>
        )
      })}
    </section>
  )
}
