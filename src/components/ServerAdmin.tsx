import { useEffect, useState } from 'react'
import { Copy, Plus, Shield, Trash2 } from 'lucide-react'
import { check, db, errorText } from '../lib/supabase'
import type { Channel, Profile, Role, Server } from '../lib/types'
import { IconButton, Modal } from './ui'
import { ServerLogo } from './ServerLogo'
import { upload, validateFile } from '../lib/files'

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
  const [serverName, setServerName] = useState(server.name)
  const [description, setDescription] = useState(server.description)
  const [memberAccess, setMemberAccess] = useState<{ channel_id: string; user_id: string }[]>([])
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
    const [r, m, p, i, a] = await Promise.all([
      db().from('roles').select('*').eq('server_id', server.id),
      db().from('member_roles').select('*').eq('server_id', server.id),
      db().from('channel_permissions').select('*').eq('server_id', server.id),
      db().from('invitations').select('*').eq('server_id', server.id),
      db()
        .from('channel_member_permissions')
        .select('channel_id,user_id')
        .eq('server_id', server.id),
    ])
    setRoles(check(r) as Role[])
    setAssignments(check(m))
    setPermissions(check(p))
    setInvites(check(i))
    setMemberAccess(check(a))
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
          <h3>Identidade do servidor</h3>
          <div className="server-identity">
            <div className="server-logo-preview">
              <ServerLogo server={server} />
            </div>
            <div>
              <label className={`secondary logo-upload ${busy ? 'disabled' : ''}`}>
                Trocar logo
                <input
                  type="file"
                  aria-label="Logo do servidor"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    if (!file) return
                    void run(async () => {
                      validateFile(file, 'avatar')
                      const bitmap = await createImageBitmap(file)
                      bitmap.close()
                      const path = `${server.id}/${crypto.randomUUID()}`
                      await upload('server-icons', path, file, () => {})
                      try {
                        check(
                          await db()
                            .from('servers')
                            .update({ icon_path: path })
                            .eq('id', server.id)
                            .select('id')
                            .single(),
                        )
                      } catch (error) {
                        await db().storage.from('server-icons').remove([path])
                        throw error
                      }
                      if (server.icon_path)
                        check(await db().storage.from('server-icons').remove([server.icon_path]))
                    })
                  }}
                />
              </label>
              <p className="muted">JPG, PNG ou WebP de até 2 MB.</p>
              {server.icon_path && (
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      check(
                        await db()
                          .from('servers')
                          .update({ icon_path: null })
                          .eq('id', server.id)
                          .select('id')
                          .single(),
                      )
                      check(await db().storage.from('server-icons').remove([server.icon_path!]))
                    })
                  }
                >
                  Remover logo
                </button>
              )}
            </div>
          </div>
          <form
            className="server-identity-form"
            onSubmit={(event) => {
              event.preventDefault()
              void run(async () => {
                check(
                  await db()
                    .from('servers')
                    .update({ name: serverName.trim(), description: description.trim() })
                    .eq('id', server.id)
                    .select('id')
                    .single(),
                )
              })
            }}
          >
            <label>
              Nome do servidor
              <input
                required
                maxLength={64}
                value={serverName}
                onChange={(event) => setServerName(event.target.value)}
              />
            </label>
            <label>
              Descrição
              <textarea
                maxLength={500}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <button className="secondary" disabled={busy || !serverName.trim()}>
              Salvar identidade
            </button>
          </form>
        </section>
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
                              await db().from('member_roles').insert({
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
            Canais públicos estão disponíveis a todos. Nos privados, libere acesso por cargo ou por
            usuário. O proprietário sempre tem acesso. As alterações são salvas automaticamente.
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
                <>
                  <h4>Cargos com acesso</h4>
                  <div className="checkbox-grid">
                    {roles.length === 0 && (
                      <p className="muted">Crie um cargo acima ou escolha usuários abaixo.</p>
                    )}
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
                                  await db().from('channel_permissions').insert({
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
                  <h4>Permissões por usuário</h4>
                  <p className="muted">
                    Permite ver o canal e participar da conversa. Acesso concedido por cargo
                    continua válido.
                  </p>
                  <div className="checkbox-grid">
                    {people.map((person) => {
                      const isOwner = person.id === server.owner_id
                      const fromRole = permissions.some(
                        (permission) =>
                          permission.channel_id === channel.id &&
                          assignments.some(
                            (assignment) =>
                              assignment.user_id === person.id &&
                              assignment.role_id === permission.role_id,
                          ),
                      )
                      const direct = memberAccess.some(
                        (access) =>
                          access.channel_id === channel.id && access.user_id === person.id,
                      )
                      return (
                        <label key={person.id}>
                          <input
                            type="checkbox"
                            aria-label={`Acesso de ${person.display_name} a ${channel.name}`}
                            checked={isOwner || fromRole || direct}
                            disabled={busy || isOwner || fromRole}
                            onChange={(event) => {
                              const enabled = event.target.checked
                              void run(async () => {
                                if (enabled)
                                  check(
                                    await db()
                                      .from('channel_member_permissions')
                                      .insert({
                                        server_id: server.id,
                                        channel_id: channel.id,
                                        user_id: person.id,
                                      }),
                                  )
                                else
                                  check(
                                    await db()
                                      .from('channel_member_permissions')
                                      .delete()
                                      .eq('channel_id', channel.id)
                                      .eq('user_id', person.id),
                                  )
                              })
                            }}
                          />
                          {person.display_name}
                          {isOwner ? ' · proprietário' : fromRole ? ' · via cargo' : ''}
                        </label>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
          ))}
        </section>
      </div>
    </Modal>
  )
}
