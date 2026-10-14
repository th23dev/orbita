import { useEffect, useState } from 'react'
import { LogOut, Save, Trash2, UserPlus } from 'lucide-react'
import { check, db, errorText } from '../lib/supabase'
import type { Channel, Profile, Server } from '../lib/types'
import { Avatar, Modal } from './ui'
import { FriendPicker } from './FriendPicker'
import { useDialogs } from './Dialogs'

export function ChannelSettings({
  channel,
  server,
  userId,
  canManage,
  canPromote,
  friends,
  profiles,
  refresh,
  close,
  report,
}: {
  channel: Channel
  server: Server
  userId: string
  canManage: boolean
  canPromote: boolean
  friends: Profile[]
  profiles: Profile[]
  refresh: () => Promise<void>
  close: () => void
  report: (s: string) => void
}) {
  const dialogs = useDialogs()
  const [name, setName] = useState(channel.name)
  const [topic, setTopic] = useState(channel.topic)
  const [restricted, setRestricted] = useState(channel.is_private)
  const [selected, setSelected] = useState<string[]>([])
  const [members, setMembers] = useState<{ user_id: string; role: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const load = async () => setMembers(check(await db().rpc('channel_people', { c: channel.id })))
  useEffect(() => {
    void load().catch((e) => report(errorText(e)))
  }, [channel.id])
  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    try {
      await action()
      await refresh()
      await load()
    } catch (e) {
      report(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const manage = (target: string, action: string) =>
    run(async () => {
      check(
        await db().rpc('manage_membership', {
          s: server.id,
          c: channel.id,
          target_user: target,
          action,
        }),
      )
    })
  return (
    <Modal title={`Configurações de ${channel.name}`} close={close}>
      <div className="admin-sections">
        {canManage && (
          <form
            className="create-form"
            onSubmit={(e) => {
              e.preventDefault()
              void run(async () => {
                check(
                  await db()
                    .from('channels')
                    .update({ name: name.trim(), topic: topic.trim(), is_private: restricted })
                    .eq('id', channel.id)
                    .select('id')
                    .single(),
                )
                setNotice('Configurações salvas.')
              })
            }}
          >
            <label>
              Nome do canal
              <input
                required
                maxLength={64}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Descrição do canal
              <textarea maxLength={300} value={topic} onChange={(e) => setTopic(e.target.value)} />
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={restricted}
                onChange={(e) => setRestricted(e.target.checked)}
              />
              Canal privado
            </label>
            <p className="muted">
              {restricted
                ? 'Somente pessoas com acesso podem ver e participar.'
                : 'Disponível aos membros do servidor, exceto quem saiu ou foi removido.'}
            </p>
            <button className="primary" disabled={busy || !name.trim()}>
              <Save size={17} />
              Salvar alterações
            </button>
          </form>
        )}
        <section>
          <h3>Participantes · {members.length}</h3>
          {members.map((member) => {
            const person = profiles.find((p) => p.id === member.user_id)
            const protectedMember = ['owner', 'admin'].includes(member.role)
            return (
              <div className="managed-person" key={member.user_id}>
                <Avatar profile={person} small />
                <div>
                  <strong>{person?.display_name || 'Membro'}</strong>
                  <small>
                    {
                      (
                        {
                          owner: 'Proprietário',
                          admin: 'Administrador',
                          moderator: 'Moderador',
                          member: 'Membro',
                        } as Record<string, string>
                      )[member.role]
                    }
                  </small>
                </div>
                {canManage && member.user_id !== userId && !protectedMember && (
                  <div className="member-actions">
                    {canPromote && (
                      <select
                        aria-label={`Cargo de ${person?.display_name}`}
                        value={member.role}
                        disabled={busy}
                        onChange={(e) =>
                          void manage(
                            member.user_id,
                            e.target.value === 'moderator' ? 'promote' : 'demote',
                          )
                        }
                      >
                        <option value="member">Membro</option>
                        <option value="moderator">Moderador</option>
                      </select>
                    )}
                    <button
                      className="text-button danger-text"
                      disabled={busy}
                      onClick={async () => {
                        if (
                          await dialogs.confirm({
                            title: 'Remover participante?',
                            message: `${person?.display_name || 'Esta pessoa'} perderá o acesso a este canal.`,
                            confirm: 'Remover',
                            danger: true,
                          })
                        )
                          await manage(member.user_id, 'remove')
                      }}
                    >
                      Remover
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </section>
        {canManage && (
          <section>
            <FriendPicker
              people={friends.filter((p) => !members.some((m) => m.user_id === p.id))}
              selected={selected}
              change={setSelected}
            />
            <button
              className="secondary"
              disabled={busy || !selected.length}
              onClick={() =>
                void run(async () => {
                  for (const id of selected)
                    check(
                      await db().rpc('invite_member', {
                        s: server.id,
                        c: channel.id,
                        target_user: id,
                      }),
                    )
                  setSelected([])
                  setNotice('Convites enviados. O acesso será liberado após a aceitação.')
                })
              }
            >
              <UserPlus size={17} />
              Enviar convites
            </button>
          </section>
        )}
        {notice && (
          <p className="member-notice" role="status">
            {notice}
          </p>
        )}
        <footer className="dialog-actions">
          {!canPromote && userId !== server.owner_id && (
            <button
              className="danger-button"
              disabled={busy}
              onClick={async () => {
                if (
                  await dialogs.confirm({
                    title: 'Sair do canal?',
                    message: 'Para voltar, você precisará aceitar um novo convite.',
                    confirm: 'Sair do canal',
                    danger: true,
                  })
                ) {
                  setBusy(true)
                  try {
                    check(
                      await db().rpc('manage_membership', {
                        s: server.id,
                        c: channel.id,
                        target_user: userId,
                        action: 'leave',
                      }),
                    )
                    await refresh()
                    close()
                  } catch (e) {
                    report(errorText(e))
                    setBusy(false)
                  }
                }
              }}
            >
              <LogOut size={17} />
              Sair do canal
            </button>
          )}
          {canManage && (
            <button
              className="text-button danger-text"
              disabled={busy}
              onClick={async () => {
                if (
                  await dialogs.confirm({
                    title: 'Arquivar canal?',
                    message: 'O canal ficará indisponível. O histórico será preservado.',
                    confirm: 'Arquivar',
                    danger: true,
                  })
                ) {
                  setBusy(true)
                  try {
                    check(
                      await db()
                        .from('channels')
                        .update({ archived: true })
                        .eq('id', channel.id)
                        .select('id')
                        .single(),
                    )
                    await refresh()
                    close()
                  } catch (e) {
                    report(errorText(e))
                    setBusy(false)
                  }
                }
              }}
            >
              <Trash2 size={16} />
              Arquivar canal
            </button>
          )}
        </footer>
      </div>
    </Modal>
  )
}
