import { useState } from 'react'
import { Check, MessageCircle, UserPlus, Users, X } from 'lucide-react'
import { check, db, errorText } from '../lib/supabase'
import type { Friendship, Profile } from '../lib/types'
import { Avatar, Empty, IconButton } from './ui'
import { ProfileCard, statusLabel } from './ProfileCard'
import { useDialogs } from './Dialogs'

export function Friends({
  userId,
  profiles,
  friends,
  refresh,
  openDm,
  report,
}: {
  userId: string
  profiles: Profile[]
  friends: Friendship[]
  refresh: () => Promise<void>
  openDm: (id: string) => void
  report: (s: string) => void
}) {
  const dialogs = useDialogs()
  const [viewProfile, setViewProfile] = useState<Profile | null>(null)
  const [username, setUsername] = useState(''),
    [tab, setTab] = useState('all'),
    [selected, setSelected] = useState<string[]>([]),
    [name, setName] = useState(''),
    [busy, setBusy] = useState(false)
  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    try {
      await action()
      await refresh()
    } catch (e) {
      report(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const pending = friends.filter((f) => f.status === 'pending')
  const visible = friends.filter((f) =>
    tab === 'pending' ? f.status === 'pending' : f.status === 'accepted',
  )
  async function create(people: string[], title: string) {
    const id = check(await db().rpc('create_dm', { people, title }))
    await refresh()
    openDm(id)
  }
  return (
    <section className="friends-panel">
      <div className="friends-heading">
        <span className="eyebrow">GENTE QUE FAZ PARTE</span>
        <h1>Na sua órbita</h1>
        <p>As melhores conversas começam com uma conexão.</p>
      </div>
      <form
        className="add-friend"
        onSubmit={(e) => {
          e.preventDefault()
          void run(async () => {
            const profile = check(
              await db()
                .from('profiles')
                .select('id')
                .eq('username', username.toLowerCase().trim())
                .maybeSingle(),
            )
            if (!profile) throw new Error('Nenhum usuário encontrado com esse nome.')
            if (profile.id === userId) throw new Error('Esse é seu próprio perfil.')
            check(
              await db()
                .from('friendships')
                .insert({ requester_id: userId, addressee_id: profile.id }),
            )
            setUsername('')
            setTab('pending')
          })
        }}
      >
        <UserPlus size={21} />
        <input
          aria-label="Nome de usuário do amigo"
          placeholder="Adicionar pelo nome de usuário"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
        <button className="primary" disabled={busy}>
          Enviar convite
        </button>
      </form>
      <nav className="tabs">
        <button className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>
          Todos os amigos <span>{friends.length - pending.length}</span>
        </button>
        <button className={tab === 'pending' ? 'active' : ''} onClick={() => setTab('pending')}>
          Solicitações <span>{pending.length}</span>
        </button>
      </nav>
      {!visible.length && (
        <Empty
          icon={<Users size={32} />}
          title={tab === 'all' ? 'Uma boa companhia faz a diferença.' : 'Tudo em dia por aqui.'}
        >
          {tab === 'all'
            ? 'Adicione um amigo pelo nome de usuário para começar.'
            : 'Novas solicitações de amizade aparecem aqui.'}
        </Empty>
      )}
      <div className="friends-list">
        {visible.map((f) => {
          const id = f.requester_id === userId ? f.addressee_id : f.requester_id,
            p = profiles.find((p) => p.id === id)
          return (
            <div className="friend" key={f.id}>
              {f.status === 'accepted' && (
                <input
                  aria-label={`Selecionar ${p?.display_name}`}
                  type="checkbox"
                  checked={selected.includes(id)}
                  onChange={(e) =>
                    setSelected((old) =>
                      e.target.checked ? [...old, id] : old.filter((x) => x !== id),
                    )
                  }
                />
              )}
              <button
                className="profile-trigger"
                aria-label={`Ver perfil de ${p?.display_name || 'membro'}`}
                onClick={() => p && setViewProfile(p)}
              >
                <Avatar profile={p} online={p?.status !== 'offline'} />
              </button>
              <div>
                <button className="profile-trigger" onClick={() => p && setViewProfile(p)}>
                  <strong>{p?.display_name || 'Membro'}</strong>
                </button>
                <small>
                  {p ? `@${p.username}` : ''}
                  {f.status === 'pending'
                    ? f.requester_id === userId
                      ? ' · Convite enviado'
                      : ' · Quer se conectar'
                    : p
                      ? ` · ${statusLabel[p.status]}`
                      : ''}
                </small>
              </div>
              {f.status === 'accepted' ? (
                <IconButton
                  label="Conversar"
                  disabled={busy}
                  onClick={() =>
                    void run(() => create([id], p?.display_name || 'Conversa privada'))
                  }
                >
                  <MessageCircle size={19} />
                </IconButton>
              ) : (
                f.addressee_id === userId && (
                  <IconButton
                    label="Aceitar solicitação"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        check(
                          await db()
                            .from('friendships')
                            .update({ status: 'accepted' })
                            .eq('id', f.id),
                        )
                      })
                    }
                  >
                    <Check size={19} />
                  </IconButton>
                )
              )}
              <IconButton
                label={f.status === 'accepted' ? 'Remover amizade' : 'Cancelar solicitação'}
                disabled={busy}
                onClick={async () => {
                  if (
                    f.status === 'pending' ||
                    (await dialogs.confirm({
                      title: 'Remover amizade?',
                      message:
                        'Vocês precisarão de uma nova solicitação para se conectar novamente.',
                      confirm: 'Remover',
                      danger: true,
                    }))
                  )
                    void run(async () => {
                      check(await db().from('friendships').delete().eq('id', f.id))
                      setSelected((old) => old.filter((x) => x !== id))
                    })
                }}
              >
                <X size={18} />
              </IconButton>
            </div>
          )
        })}
      </div>
      {viewProfile && (
        <ProfileCard
          profile={viewProfile}
          close={() => setViewProfile(null)}
          message={() =>
            void run(async () => {
              await create([viewProfile.id], viewProfile.display_name)
              setViewProfile(null)
            })
          }
        />
      )}
      {selected.length > 0 && (
        <form
          className="group-form"
          onSubmit={(e) => {
            e.preventDefault()
            void run(() => create(selected, name.trim()))
          }}
        >
          <label>
            Nome da conversa em grupo
            <input
              required
              maxLength={64}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nosso ponto de encontro"
            />
          </label>
          <button className="primary" disabled={busy || selected.length > 9}>
            Criar conversa com {selected.length} amigo(s)
          </button>
        </form>
      )}
    </section>
  )
}
