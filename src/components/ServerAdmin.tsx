import { useEffect, useState } from 'react'
import { Copy, Plus, Shield, Trash2 } from 'lucide-react'
import { check, db, errorText } from '../lib/supabase'
import type { Channel, Profile, Role, Server } from '../lib/types'
import { IconButton, Modal } from './ui'

export function ServerAdmin({
  server,
  channels,
  people,
  close,
  refresh,
  report,
}: {
  server: Server
  channels: Channel[]
  people: Profile[]
  close: () => void
  refresh: () => Promise<void>
  report: (s: string) => void
}) {
  const [roles, setRoles] = useState<Role[]>([]),
    [assignments, setAssignments] = useState<{ role_id: string; user_id: string }[]>([]),
    [permissions, setPermissions] = useState<{ id: string; channel_id: string; role_id: string }[]>(
      [],
    )
  const [roleName, setRoleName] = useState(''),
    [invites, setInvites] = useState<
      { id: string; code: string; uses: number; max_uses: number; expires_at: string }[]
    >([]),
    [busy, setBusy] = useState(false)
  async function load() {
    const [r, m, p, i] = await Promise.all([
      db().from('roles').select('*').eq('server_id', server.id),
      db().from('member_roles').select('*').eq('server_id', server.id),
      db().from('channel_permissions').select('*').eq('server_id', server.id),
      db().from('invitations').select('*').eq('server_id', server.id),
    ])
    setRoles(check(r) as Role[])
    setAssignments(check(m))
    setPermissions(check(p))
    setInvites(check(i))
  }
  useEffect(() => {
    void load().catch((e) => report(errorText(e)))
  }, [server.id])
  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    try {
      await action()
      await load()
      await refresh()
    } catch (e) {
      report(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={`Gerenciar ${server.name}`} close={close}>
      <div className="admin-sections">
        <section>
          <h3>Convites</h3>
          <p className="muted">Os convites valem por 7 dias e permitem 25 entradas.</p>
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                check(
                  await db()
                    .from('invitations')
                    .insert({ server_id: server.id, created_by: server.owner_id }),
                )
              })
            }
          >
            <Plus size={16} />
            Gerar convite
          </button>
          {invites.map((inv) => (
            <div className="admin-row" key={inv.id}>
              <code>{inv.code}</code>
              <small>
                {inv.uses}/{inv.max_uses}
              </small>
              <IconButton
                label="Copiar convite"
                onClick={() =>
                  void run(async () => {
                    await navigator.clipboard.writeText(inv.code)
                  })
                }
              >
                <Copy size={16} />
              </IconButton>
              <IconButton
                label="Revogar convite"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    check(await db().from('invitations').delete().eq('id', inv.id))
                  })
                }
              >
                <Trash2 size={16} />
              </IconButton>
            </div>
          ))}
        </section>
        <section>
          <h3>
            <Shield size={17} />
            Cargos
          </h3>
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault()
              void run(async () => {
                check(await db().from('roles').insert({ server_id: server.id, name: roleName }))
                setRoleName('')
              })
            }}
          >
            <input
              aria-label="Nome do cargo"
              placeholder="Novo cargo"
              required
              maxLength={32}
              value={roleName}
              onChange={(e) => setRoleName(e.target.value)}
            />
            <button className="secondary" disabled={busy}>
              Criar
            </button>
          </form>
          {roles.map((role) => (
            <div className="role-section" key={role.id}>
              <div className="admin-row">
                <strong>{role.name}</strong>
                <IconButton
                  label={`Excluir cargo ${role.name}`}
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      check(await db().from('roles').delete().eq('id', role.id))
                    })
                  }
                >
                  <Trash2 size={15} />
                </IconButton>
              </div>
              <div className="checkbox-grid">
                {people.map((person) => (
                  <label key={person.id}>
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={assignments.some(
                        (a) => a.role_id === role.id && a.user_id === person.id,
                      )}
                      onChange={(e) => {
                        const enabled = e.target.checked
                        void run(async () => {
                          if (enabled)
                            check(
                              await db()
                                .from('member_roles')
                                .insert({
                                  server_id: server.id,
                                  user_id: person.id,
                                  role_id: role.id,
                                }),
                            )
                          else
                            check(
                              await db()
                                .from('member_roles')
                                .delete()
                                .eq('server_id', server.id)
                                .eq('user_id', person.id)
                                .eq('role_id', role.id),
                            )
                        })
                      }}
                    />
                    {person.display_name}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </section>
        <section>
          <h3>Canais e acesso</h3>
          <p className="muted">
            Canais privados ficam disponíveis ao proprietário e aos cargos selecionados.
          </p>
          {channels.map((channel) => (
            <div className="role-section" key={channel.id}>
              <div className="admin-row">
                <strong>
                  {channel.kind === 'text' ? '#' : '◖'} {channel.name}
                </strong>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={channel.is_private}
                    disabled={busy}
                    onChange={(e) => {
                      const value = e.target.checked
                      void run(async () => {
                        check(
                          await db()
                            .from('channels')
                            .update({ is_private: value })
                            .eq('id', channel.id),
                        )
                      })
                    }}
                  />
                  Privado
                </label>
                <IconButton
                  label={`Arquivar ${channel.name}`}
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        'Arquivar este canal? Seu histórico ficará inacessível até a restauração pelo banco.',
                      )
                    )
                      void run(async () => {
                        check(
                          await db()
                            .from('channels')
                            .update({ archived: true })
                            .eq('id', channel.id),
                        )
                      })
                  }}
                >
                  <Trash2 size={15} />
                </IconButton>
              </div>
              {channel.is_private && (
                <div className="checkbox-grid">
                  {roles.map((role) => (
                    <label key={role.id}>
                      <input
                        type="checkbox"
                        disabled={busy}
                        checked={permissions.some(
                          (p) => p.channel_id === channel.id && p.role_id === role.id,
                        )}
                        onChange={(e) => {
                          const enabled = e.target.checked
                          void run(async () => {
                            if (enabled)
                              check(
                                await db()
                                  .from('channel_permissions')
                                  .insert({
                                    server_id: server.id,
                                    channel_id: channel.id,
                                    role_id: role.id,
                                  }),
                              )
                            else
                              check(
                                await db()
                                  .from('channel_permissions')
                                  .delete()
                                  .eq('channel_id', channel.id)
                                  .eq('role_id', role.id),
                              )
                          })
                        }}
                      />
                      {role.name}
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
        </section>
      </div>
    </Modal>
  )
}
