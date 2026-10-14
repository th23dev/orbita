import { useEffect, useState } from 'react'
import { Shield, Trash2 } from 'lucide-react'
import { check, db, errorText } from '../lib/supabase'
import type { Channel, Profile, Role, Server, ServerMember } from '../lib/types'
import { IconButton, Modal } from './ui'
import { ServerLogo } from './ServerLogo'
import { upload, validateFile } from '../lib/files'
import { ServerMembers } from './ServerMembers'
import { MemberManager } from './MemberManager'

export function ServerAdmin({
  server,
  channels,
  people,
  close,
  refresh,
  report,
  members,
  userId,
}: {
  server: Server
  channels: Channel[]
  people: Profile[]
  close: () => void
  refresh: () => Promise<void>
  report: (s: string) => void
  members: ServerMember[]
  userId: string
}) {
  const [serverName, setServerName] = useState(server.name)
  const [description, setDescription] = useState(server.description)
  const [roles, setRoles] = useState<Role[]>([]),
    [assignments, setAssignments] = useState<{ role_id: string; user_id: string }[]>([])
  const [roleName, setRoleName] = useState(''),
    [busy, setBusy] = useState(false)
  async function load() {
    const [r, m] = await Promise.all([
      db().from('roles').select('*').eq('server_id', server.id),
      db().from('member_roles').select('*').eq('server_id', server.id),
    ])
    setRoles(check(r) as Role[])
    setAssignments(check(m))
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
        <ServerMembers server={server} people={people} refresh={refresh} report={report} />
        <MemberManager
          server={server}
          people={people}
          members={members}
          userId={userId}
          refresh={refresh}
          report={report}
        />
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
            Use a engrenagem ao lado do nome de cada canal na barra lateral para renomear, convidar
            participantes, gerenciar cargos e alterar a privacidade.
          </p>
          <p className="muted">{channels.length} canais neste servidor.</p>
        </section>
      </div>
    </Modal>
  )
}
