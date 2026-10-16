import { useEffect, useRef, useState } from 'react'
import { Shield, Trash2, Users, UserPlus, Hash, Settings2 } from 'lucide-react'
import { check, db, errorText } from '../lib/supabase'
import type { Channel, Profile, Role, Server, ServerMember } from '../lib/types'
import { IconButton, Modal } from './ui'
import { ServerLogo } from './ServerLogo'
import { upload, validateFile } from '../lib/files'
import { ServerMembers } from './ServerMembers'
import { MemberManager } from './MemberManager'
import { useDialogs } from './Dialogs'
import { ServerChannels } from './ServerChannels'

const sections = {
  identity: {
    label: 'Visão geral',
    description: 'Personalize o nome, a imagem e a descrição da sua comunidade.',
    icon: Settings2,
  },
  members: {
    label: 'Membros',
    description: 'Gerencie as pessoas e as permissões de administração do servidor.',
    icon: Users,
  },
  invites: {
    label: 'Convites',
    description: 'Convide pessoas e gerencie os links de acesso à comunidade.',
    icon: UserPlus,
  },
  roles: {
    label: 'Cargos',
    description: 'Organize os cargos e escolha quem faz parte de cada um.',
    icon: Shield,
  },
  channels: {
    label: 'Canais e acesso',
    description: 'Organize os espaços de conversa e gerencie quem pode participar.',
    icon: Hash,
  },
  deletion: {
    label: 'Exclusão do servidor',
    description: 'Gerencie a exclusão permanente da comunidade.',
    icon: Trash2,
  },
}

export function ServerAdmin({
  server,
  channels,
  people,
  close,
  refresh,
  report,
  members,
  userId,
  manageChannel,
}: {
  server: Server
  channels: Channel[]
  people: Profile[]
  close: () => void
  refresh: () => Promise<void>
  report: (s: string) => void
  members: ServerMember[]
  userId: string
  manageChannel: (channel: Channel) => void
}) {
  const dialogs = useDialogs()
  const [section, setSection] = useState<keyof typeof sections>('identity')
  const content = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (content.current) content.current.scrollTop = 0
  }, [section])
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
    <Modal
      title={`Gerenciar ${server.name}`}
      close={close}
      className="user-settings-modal server-settings-modal"
    >
      <aside className="user-settings-sidebar">
        <button className="user-settings-identity" onClick={() => setSection('identity')}>
          <span className="server-settings-logo">
            <ServerLogo server={server} />
          </span>
          <span>
            <strong>{server.name}</strong>
            <small>Configurações do servidor</small>
          </span>
        </button>
        <nav aria-label="Categorias de configurações do servidor">
          {[
            { label: 'Servidor', items: ['identity', 'channels'] as const },
            { label: 'Comunidade', items: ['members', 'invites', 'roles'] as const },
          ].map((group) => (
            <div className="user-settings-nav-group" key={group.label}>
              <span className="user-settings-nav-label">{group.label}</span>
              {group.items.map((key) => {
                const Icon = sections[key].icon
                return (
                  <button
                    key={key}
                    aria-current={section === key ? 'page' : undefined}
                    onClick={() => setSection(key)}
                  >
                    <Icon size={18} />
                    {sections[key].label}
                  </button>
                )
              })}
            </div>
          ))}
          {server.owner_id === userId && (
            <div className="user-settings-nav-group user-settings-session">
              <button
                aria-current={section === 'deletion' ? 'page' : undefined}
                onClick={() => setSection('deletion')}
              >
                <Trash2 size={18} /> Exclusão do servidor
              </button>
            </div>
          )}
        </nav>
      </aside>
      <div className="user-settings-content" ref={content}>
        <div className="user-settings-page">
          <div className="user-settings-intro">
            <h2>{sections[section].label}</h2>
            <p>{sections[section].description}</p>
          </div>
          <div className="admin-sections">
            <section hidden={section !== 'identity'}>
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
                            check(
                              await db().storage.from('server-icons').remove([server.icon_path]),
                            )
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
                <button className="primary" disabled={busy || !serverName.trim()}>
                  Salvar identidade
                </button>
              </form>
            </section>
            <div hidden={section !== 'invites'}>
              <ServerMembers server={server} people={people} refresh={refresh} report={report} />
            </div>
            <div hidden={section !== 'members'}>
              <MemberManager
                server={server}
                people={people}
                members={members}
                userId={userId}
                refresh={refresh}
                report={report}
              />
            </div>
            <section hidden={section !== 'roles'}>
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
              {roles.length === 0 && (
                <p className="server-settings-empty">
                  Nenhum cargo criado. Adicione o primeiro cargo para organizar sua comunidade.
                </p>
              )}
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
            <section hidden={section !== 'channels'}>
              <ServerChannels channels={channels} manage={manageChannel} />
            </section>
            {server.owner_id === userId && (
              <section hidden={section !== 'deletion'} className="server-settings-danger">
                <h3>Excluir servidor</h3>
                <p className="muted">
                  Exclui permanentemente este servidor, seus canais e o histórico de mensagens para
                  todos os participantes. Somente o proprietário pode realizar esta ação.
                </p>
                <button
                  className="danger-button"
                  disabled={busy}
                  onClick={async () => {
                    if (
                      !(await dialogs.confirm({
                        title: `Excluir o servidor ${server.name}?`,
                        message:
                          'Todos os canais, mensagens, cargos e convites deste servidor serão apagados permanentemente. Os participantes perderão o acesso, inclusive aos anexos. Esta ação não pode ser desfeita.',
                        confirm: 'Excluir servidor',
                        danger: true,
                      }))
                    )
                      return
                    setBusy(true)
                    try {
                      check(
                        await db()
                          .from('servers')
                          .delete()
                          .eq('id', server.id)
                          .select('id')
                          .single(),
                      )
                      await refresh()
                      close()
                    } catch (error) {
                      report(errorText(error))
                      setBusy(false)
                    }
                  }}
                >
                  <Trash2 size={17} />
                  Excluir servidor
                </button>
              </section>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}
