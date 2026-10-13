import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  ArrowUpRight,
  AudioLines,
  ChevronDown,
  Hash,
  Headphones,
  LockKeyhole,
  Menu,
  MessageCircle,
  Orbit,
  Plus,
  Settings as SettingsIcon,
  Shield,
  Users,
  X,
} from 'lucide-react'
import { Auth } from './components/Auth'
import { Chat } from './components/Chat'
import { Friends } from './components/Friends'
import { Settings } from './components/Settings'
import { ServerAdmin } from './components/ServerAdmin'
import { Avatar, Empty, IconButton, Logo, Modal } from './components/ui'
import { check, db, errorText, supabase } from './lib/supabase'
import { useWorkspace } from './hooks/useWorkspace'
import { usePresence } from './hooks/usePresence'
import type { Channel, Space } from './lib/types'

const Voice = lazy(() => import('./components/Voice').then((module) => ({ default: module.Voice })))

function Workspace({ session }: { session: Session }) {
  const [error, setError] = useState(''),
    [modal, setModal] = useState<string | null>(null),
    [serverId, setServerId] = useState(''),
    [selection, setSelection] = useState<{ kind: 'channel' | 'dm'; id: string } | null>(null)
  const [mobile, setMobile] = useState(false),
    [showMembers, setShowMembers] = useState(true),
    [voice, setVoice] = useState<Channel | null>(null),
    [name, setName] = useState(''),
    [kind, setKind] = useState('text'),
    [busy, setBusy] = useState(false)
  const report = useCallback((message: string) => setError(message), [])
  const data = useWorkspace(session.user.id, report)
  const currentServer = data.servers.find((s) => s.id === serverId)
  const serverChannels = data.channels.filter((c) => c.server_id === serverId)
  const selectedChannel =
    selection?.kind === 'channel' ? data.channels.find((c) => c.id === selection.id) : null
  const selectedDm =
    selection?.kind === 'dm' ? data.conversations.find((c) => c.id === selection.id) : null
  const space: Space | null =
    selectedChannel?.kind === 'text'
      ? {
          id: selectedChannel.id,
          kind: 'channel',
          name: selectedChannel.name,
          topic: selectedChannel.topic,
        }
      : selectedDm
        ? { id: selectedDm.id, kind: 'dm', name: selectedDm.name }
        : null
  const online = usePresence(currentServer ? `server:${currentServer.id}` : null, data.me)
  const memberIds = data.members.filter((m) => m.server_id === serverId).map((m) => m.user_id)
  const people = data.profiles
    .filter((p) => memberIds.includes(p.id))
    .sort((a, b) => Number(online.includes(b.id)) - Number(online.includes(a.id)))
  const owner = currentServer?.owner_id === session.user.id
  const leave = useCallback(() => setVoice(null), [])
  useEffect(() => {
    if (voice && !data.loading && !data.channels.some((c) => c.id === voice.id)) setVoice(null)
  }, [data.channels, data.loading, voice])
  useEffect(() => {
    if (data.loading) return
    const match = window.location.hash.match(/^#\/(channel|dm)\/([a-f0-9-]{36})$/)
    if (match && selection === null) {
      const ch = data.channels.find((c) => c.id === match[2])
      if (ch) {
        setServerId(ch.server_id)
        setSelection({ kind: 'channel', id: ch.id })
      } else if (data.conversations.some((c) => c.id === match[2]))
        setSelection({ kind: 'dm', id: match[2] })
    }
  }, [data.loading])
  function select(kind: 'channel' | 'dm', id: string) {
    setSelection({ kind, id })
    window.history.replaceState(null, '', `#/${kind}/${id}`)
    setMobile(false)
  }
  function chooseServer(id: string) {
    setServerId(id)
    const first = data.channels.find((c) => c.server_id === id && c.kind === 'text')
    setSelection(first ? { kind: 'channel', id: first.id } : null)
    window.history.replaceState(null, '', first ? `#/channel/${first.id}` : '#/')
    setMobile(false)
  }
  function home() {
    setServerId('')
    setSelection(null)
    window.history.replaceState(null, '', '#/')
    setMobile(false)
  }
  async function submit() {
    setBusy(true)
    try {
      if (modal === 'server') {
        const server = check(
          await db()
            .from('servers')
            .insert({ owner_id: session.user.id, name: name.trim() })
            .select()
            .single(),
        )
        await data.refresh()
        setServerId(server.id)
        setSelection(null)
      }
      if (modal === 'join') {
        const id = check(await db().rpc('join_server', { invite_code: name.trim() }))
        await data.refresh()
        setServerId(id)
        setSelection(null)
      }
      if (modal === 'channel') {
        const channel = check(
          await db()
            .from('channels')
            .insert({ server_id: serverId, name: name.trim(), kind })
            .select()
            .single(),
        )
        await data.refresh()
        select('channel', channel.id)
      }
      setModal(null)
      setName('')
    } catch (e) {
      report(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  function openModal(value: string) {
    setName('')
    setModal(value)
  }
  const voiceVisible = Boolean(voice && selectedChannel?.id === voice.id)
  return (
    <div className={`app-shell ${mobile ? 'nav-open' : ''} ${!showMembers ? 'hide-members' : ''}`}>
      <aside className="server-rail" aria-label="Servidores">
        <button className={`rail-home ${!serverId ? 'active' : ''}`} title="Início" onClick={home}>
          <Orbit size={29} />
        </button>
        <div className="rail-divider" />
        {data.servers.map((s, i) => (
          <button
            key={s.id}
            className={`server-icon color-${i % 4} ${serverId === s.id ? 'active' : ''}`}
            title={s.name}
            onClick={() => chooseServer(s.id)}
          >
            {s.name.slice(0, 2).toUpperCase()}
          </button>
        ))}
        <button className="rail-add" title="Criar servidor" onClick={() => openModal('server')}>
          <Plus size={24} />
        </button>
        <button className="rail-join" title="Entrar com convite" onClick={() => openModal('join')}>
          <ArrowUpRight size={22} />
        </button>
        <span className="rail-spacer" />
        <span className="rail-bottom">O.</span>
      </aside>
      <aside className="channel-sidebar">
        <header className="sidebar-header">
          {currentServer ? (
            <>
              <strong>{currentServer.name}</strong>
              {owner && (
                <IconButton label="Gerenciar servidor" onClick={() => setModal('admin')}>
                  <ChevronDown size={18} />
                </IconButton>
              )}
            </>
          ) : (
            <Logo />
          )}
          <IconButton
            label="Fechar navegação"
            className="icon-button mobile-only"
            onClick={() => setMobile(false)}
          >
            <X size={18} />
          </IconButton>
        </header>
        <div className="sidebar-content">
          <button
            className={`sidebar-link ${!serverId && !selection ? 'active' : ''}`}
            onClick={home}
          >
            <Users size={19} />
            Amigos
            <span className="count">
              {data.friends.filter(
                (f) => f.status === 'pending' && f.addressee_id === session.user.id,
              ).length || ''}
            </span>
          </button>
          {currentServer ? (
            <>
              <div className="server-card">
                <span className="eyebrow">SUA COMUNIDADE</span>
                <strong>
                  Um espaço para
                  <br />
                  chamar de nosso.
                </strong>
                <span>
                  <span className="tiny-dot" />
                  {people.length} membro{people.length === 1 ? '' : 's'}
                </span>
              </div>
              {(['text', 'voice'] as const).map((type) => (
                <div className="channel-group" key={type}>
                  <div className="section-label">
                    <span>
                      <ChevronDown size={12} />
                      {type === 'text' ? 'CANAIS DE TEXTO' : 'CANAIS DE VOZ'}
                    </span>
                    {owner && (
                      <IconButton
                        label={`Criar canal de ${type === 'text' ? 'texto' : 'voz'}`}
                        onClick={() => {
                          setKind(type)
                          openModal('channel')
                        }}
                      >
                        <Plus size={15} />
                      </IconButton>
                    )}
                  </div>
                  {serverChannels
                    .filter((c) => c.kind === type)
                    .map((ch) => (
                      <button
                        key={ch.id}
                        className={`sidebar-link ${selection?.id === ch.id ? 'active' : ''}`}
                        onClick={() => select('channel', ch.id)}
                      >
                        {type === 'text' ? <Hash size={19} /> : <Headphones size={18} />}
                        <span>{ch.name}</span>
                        {ch.is_private && <LockKeyhole size={12} />}
                      </button>
                    ))}
                </div>
              ))}
            </>
          ) : (
            <>
              <div className="section-label">
                <span>MENSAGENS DIRETAS</span>
                <MessageCircle size={14} />
              </div>
              {data.conversations.map((c) => (
                <button
                  className={`sidebar-link ${selection?.id === c.id ? 'active' : ''}`}
                  key={c.id}
                  onClick={() => {
                    setServerId('')
                    select('dm', c.id)
                  }}
                >
                  <span className="dm-icon">{c.name.slice(0, 1).toUpperCase()}</span>
                  <span>{c.name}</span>
                </button>
              ))}
              {!data.conversations.length && (
                <p className="sidebar-help">
                  Suas conversas vão morar aqui. Adicione um amigo para começar.
                </p>
              )}
              <div className="sidebar-start">
                <Orbit size={28} />
                <strong>Encontre sua turma.</strong>
                <p>Crie um servidor e reúna suas pessoas favoritas.</p>
                <button className="secondary" onClick={() => openModal('server')}>
                  Criar servidor
                  <Plus size={15} />
                </button>
              </div>
            </>
          )}
        </div>
        {voice && (
          <div className="voice-indicator">
            <button
              onClick={() => {
                setServerId(voice.server_id)
                select('channel', voice.id)
              }}
            >
              <AudioLines size={18} />
              <span>
                Sala de voz<strong>{voice.name}</strong>
              </span>
            </button>
            <IconButton label="Sair da sala de voz" onClick={leave}>
              <X size={16} />
            </IconButton>
          </div>
        )}
        <div className="user-panel">
          <Avatar profile={data.me} online small />
          <div>
            <strong>{data.me?.display_name || 'Carregando…'}</strong>
            <small>
              {data.me?.status === 'busy'
                ? 'Ocupado'
                : data.me?.status === 'away'
                  ? 'Ausente'
                  : data.me?.status === 'offline'
                    ? 'Invisível'
                    : 'Disponível'}
            </small>
          </div>
          <IconButton
            label="Configurações"
            disabled={!data.me}
            onClick={() => setModal('settings')}
          >
            <SettingsIcon size={19} />
          </IconButton>
        </div>
      </aside>
      <main className="workspace-main">
        <header className="workspace-header">
          <IconButton
            label="Abrir navegação"
            className="icon-button mobile-only"
            onClick={() => setMobile(true)}
          >
            <Menu size={21} />
          </IconButton>
          <span className="header-icon">
            {selectedChannel ? (
              selectedChannel.kind === 'text' ? (
                <Hash size={22} />
              ) : (
                <Headphones size={21} />
              )
            ) : selectedDm ? (
              <MessageCircle size={21} />
            ) : (
              <Users size={21} />
            )}
          </span>
          <strong>{selectedChannel?.name || selectedDm?.name || 'Amigos'}</strong>
          <span className="header-divider" />
          <span className="header-topic">
            {selectedChannel?.topic || 'Seu ponto de encontro, todos os dias.'}
          </span>
          <div className="header-actions">
            {owner && (
              <IconButton label="Convites e permissões" onClick={() => setModal('admin')}>
                <Shield size={19} />
              </IconButton>
            )}
            {currentServer && (
              <IconButton label="Mostrar membros" onClick={() => setShowMembers(!showMembers)}>
                <Users size={20} />
              </IconButton>
            )}
          </div>
        </header>
        <div className="workspace-body">
          <div className="main-content">
            {data.loading ? (
              <Empty icon={<Orbit className="spin" />} title="Entrando na sua órbita…" />
            ) : space ? (
              <Chat
                key={`${space.kind}:${space.id}`}
                space={space}
                userId={session.user.id}
                profiles={data.profiles}
                report={report}
              />
            ) : selectedChannel?.kind === 'voice' && !voiceVisible ? (
              <Empty icon={<Headphones size={35} />} title={selectedChannel.name}>
                Um lugar para conversar sem pressa.
                <button
                  className="primary"
                  onClick={() => {
                    if (voice && !window.confirm('Sair da sala atual e abrir esta?')) return
                    setVoice(selectedChannel)
                  }}
                >
                  Abrir sala de voz
                  <Headphones size={18} />
                </button>
              </Empty>
            ) : !serverId ? (
              <Friends
                userId={session.user.id}
                profiles={data.profiles}
                friends={data.friends}
                refresh={data.refresh}
                openDm={(id) => {
                  setServerId('')
                  select('dm', id)
                }}
                report={report}
              />
            ) : !voiceVisible ? (
              <Empty icon={<Hash size={35} />} title="Escolha onde a conversa acontece">
                Selecione um canal na barra lateral.
                {owner && (
                  <button
                    className="secondary"
                    onClick={() => {
                      setKind('text')
                      openModal('channel')
                    }}
                  >
                    Criar canal
                  </button>
                )}
              </Empty>
            ) : null}
            {voice && data.me && (
              <div className={voiceVisible ? 'voice-container' : 'voice-container hidden'}>
                <Suspense fallback={<p className="center muted">Carregando sala de voz…</p>}>
                  <Voice
                    key={voice.id}
                    channel={voice}
                    me={data.me}
                    profiles={data.profiles}
                    initialVolume={data.settings.soundboard_volume}
                    report={report}
                    leave={leave}
                  />
                </Suspense>
              </div>
            )}
          </div>
          {currentServer && (
            <aside className="members-sidebar">
              <div className="section-label">NA COMUNIDADE — {people.length}</div>
              {people.map((p) => (
                <div className={`member ${online.includes(p.id) ? '' : 'is-offline'}`} key={p.id}>
                  <Avatar profile={p} online={online.includes(p.id)} small />
                  <div>
                    <strong>
                      {p.display_name}
                      {p.id === currentServer.owner_id && <span className="owner-mark">✦</span>}
                    </strong>
                    <small>
                      {online.includes(p.id)
                        ? p.status === 'busy'
                          ? 'Ocupado'
                          : p.status === 'away'
                            ? 'Ausente'
                            : 'Online'
                        : 'Offline'}
                    </small>
                  </div>
                </div>
              ))}
              <div className="members-footer">
                <Orbit size={20} />
                <p>
                  Ótimas pessoas.
                  <br />
                  Boas conversas.
                </p>
              </div>
            </aside>
          )}
        </div>
      </main>
      {error && (
        <div className="toast" role="alert">
          <span>{error}</span>
          <IconButton label="Fechar aviso" onClick={() => setError('')}>
            <X size={17} />
          </IconButton>
        </div>
      )}
      {modal === 'settings' && data.me && (
        <Settings
          me={data.me}
          settings={data.settings}
          refresh={data.refresh}
          close={() => setModal(null)}
          report={report}
        />
      )}
      {modal === 'admin' && currentServer && owner && (
        <ServerAdmin
          server={currentServer}
          channels={serverChannels}
          people={people}
          refresh={data.refresh}
          close={() => setModal(null)}
          report={report}
        />
      )}
      {['server', 'join', 'channel'].includes(modal || '') && (
        <Modal
          title={
            modal === 'server'
              ? 'Crie um ponto de encontro'
              : modal === 'join'
                ? 'Entre em uma comunidade'
                : 'Um novo canal, novas conversas'
          }
          close={() => setModal(null)}
        >
          <form
            className="create-form"
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
          >
            <p className="muted">
              {modal === 'server'
                ? 'Dê um nome ao espaço que vai reunir suas pessoas.'
                : modal === 'join'
                  ? 'Cole o código de convite compartilhado com você.'
                  : 'Organize as conversas do seu servidor.'}
            </p>
            <label>
              {modal === 'join' ? 'Código de convite' : 'Nome'}
              <input
                autoFocus
                required
                value={name}
                maxLength={modal === 'join' ? 36 : 64}
                onChange={(e) => setName(e.target.value)}
                placeholder={
                  modal === 'server'
                    ? 'Ex.: Nossa galáxia'
                    : modal === 'join'
                      ? 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
                      : 'Ex.: ideias-e-projetos'
                }
              />
            </label>
            {modal === 'channel' && (
              <label>
                Tipo de canal
                <select value={kind} onChange={(e) => setKind(e.target.value)}>
                  <option value="text">Texto</option>
                  <option value="voice">Voz</option>
                </select>
              </label>
            )}
            <button className="primary" disabled={busy}>
              {busy ? 'Salvando…' : modal === 'join' ? 'Entrar no servidor' : 'Criar'}
            </button>
          </form>
        </Modal>
      )}
    </div>
  )
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null),
    [loading, setLoading] = useState(Boolean(supabase)),
    [recovery, setRecovery] = useState(false),
    [error, setError] = useState('')
  useEffect(() => {
    if (!supabase) return
    let active = true
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (active) {
          setSession(data.session)
          setLoading(false)
          if (error) setError(error.message)
        }
      })
      .catch((e) => {
        if (active) {
          setError(errorText(e))
          setLoading(false)
        }
      })
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next)
      setLoading(false)
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      if (event === 'SIGNED_OUT') {
        setRecovery(false)
        document.documentElement.dataset.theme = 'dark'
      }
    })
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])
  if (loading)
    return (
      <div className="boot">
        <Logo />
        <span>Conectando…</span>
      </div>
    )
  return (
    <>
      {session && !recovery ? (
        <Workspace key={session.user.id} session={session} />
      ) : (
        <Auth recovery={recovery} recovered={() => setRecovery(false)} />
      )}{' '}
      {error && (
        <div className="toast" role="alert">
          {error}
          <IconButton label="Fechar erro" onClick={() => setError('')}>
            <X size={16} />
          </IconButton>
        </div>
      )}
    </>
  )
}
