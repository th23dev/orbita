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
  Users,
  UserPlus,
  MicOff,
  Video,
  MonitorUp,
  X,
} from 'lucide-react'
import { Auth } from './components/Auth'
import { Chat } from './components/Chat'
import { Friends } from './components/Friends'
import { Settings } from './components/Settings'
import { ServerAdmin } from './components/ServerAdmin'
import { ServerLogo } from './components/ServerLogo'
import { ServerMembers } from './components/ServerMembers'
import {
  clearInvitation,
  invitationCode,
  pendingInvitation,
  rememberInvitation,
} from './lib/invitations'
import { Avatar, Empty, IconButton, Logo, Modal } from './components/ui'
import { check, db, errorText, supabase } from './lib/supabase'
import { useWorkspace } from './hooks/useWorkspace'
import { usePresence } from './hooks/usePresence'
import { useVoicePresence } from './hooks/useVoicePresence'
import type { VoicePresence } from './hooks/useVoicePresence'
import type { Channel, Space } from './lib/types'

const Voice = lazy(() => import('./components/Voice').then((module) => ({ default: module.Voice })))

function Workspace({ session }: { session: Session }) {
  const [error, setError] = useState(''),
    [modal, setModal] = useState<string | null>(null),
    [serverId, setServerId] = useState(''),
    [selection, setSelection] = useState<{ kind: 'channel' | 'dm'; id: string } | null>(null)
  const [mobile, setMobile] = useState(false),
    [showMembers, setShowMembers] = useState(() => {
      if (window.matchMedia('(max-width: 1000px)').matches) return false
      try {
        return localStorage.getItem('orbita:members-sidebar') !== 'hidden'
      } catch {
        return true
      }
    }),
    [voice, setVoice] = useState<Channel | null>(null),
    [name, setName] = useState(''),
    [kind, setKind] = useState('text'),
    [busy, setBusy] = useState(false)
  const report = useCallback((message: string) => setError(message), [])
  const data = useWorkspace(session.user.id, report)
  const [callPresence, setCallPresence] = useState<VoicePresence | null>(null)
  const onPresenceChange = useCallback((next: VoicePresence | null) => {
    setCallPresence((previous) =>
      JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
    )
  }, [])
  const voiceRosters = useVoicePresence(data.channels, session.user.id, callPresence)
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
    const openInvite = () => {
      const code = pendingInvitation()
      if (code) {
        setName(code)
        setModal('join')
        setMobile(false)
        setShowMembers(false)
      }
    }
    openInvite()
    window.addEventListener('hashchange', openInvite)
    return () => window.removeEventListener('hashchange', openInvite)
  }, [])
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !modal) {
        setMobile(false)
        setShowMembers(false)
      }
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [modal])
  useEffect(() => {
    try {
      localStorage.setItem('orbita:members-sidebar', showMembers ? 'visible' : 'hidden')
    } catch {
      /* Browser storage may be disabled. */
    }
  }, [showMembers])
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
        const code = invitationCode(name)
        if (!code) throw new Error('Cole um link de convite da Órbita ou um código válido.')
        const id = check(await db().rpc('join_server', { invite_code: code }))
        await data.refresh()
        clearInvitation()
        setServerId(id)
        setSelection(null)
        window.history.replaceState(null, '', '#/')
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
      setMobile(false)
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
    setMobile(false)
  }
  function closeJoin() {
    clearInvitation()
    setModal(null)
  }
  const voiceVisible = Boolean(voice && selectedChannel?.id === voice.id)
  return (
    <div className={`app-shell ${mobile ? 'nav-open' : ''} ${!showMembers ? 'hide-members' : ''}`}>
      {mobile && (
        <button
          className="navigation-backdrop"
          aria-label="Fechar menu de navegação"
          onClick={() => setMobile(false)}
        />
      )}
      {currentServer && showMembers && (
        <button
          className="members-backdrop"
          aria-label="Fechar painel de membros"
          onClick={() => setShowMembers(false)}
        />
      )}
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
            <ServerLogo server={s} />
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
                  <SettingsIcon size={18} />
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
          {currentServer && owner && (
            <button className="sidebar-invite" onClick={() => openModal('invite')}>
              <UserPlus size={18} />
              <span>Adicionar membros</span>
            </button>
          )}
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
                      <div className="sidebar-channel" key={ch.id}>
                        <button
                          className={`sidebar-link ${selection?.id === ch.id ? 'active' : ''}`}
                          onClick={() => select('channel', ch.id)}
                        >
                          {type === 'text' ? <Hash size={19} /> : <Headphones size={18} />}
                          <span>{ch.name}</span>
                          {ch.is_private && <LockKeyhole size={12} />}
                          {!!voiceRosters[ch.id]?.length && (
                            <small
                              className="voice-channel-count"
                              aria-label={`${voiceRosters[ch.id].length} na chamada`}
                            >
                              {voiceRosters[ch.id].length}
                            </small>
                          )}
                        </button>
                        {type === 'voice' && !!voiceRosters[ch.id]?.length && (
                          <ul className="voice-roster" aria-label={`Na chamada de ${ch.name}`}>
                            {voiceRosters[ch.id].map((member) => {
                              const person = data.profiles.find(
                                (profile) => profile.id === member.userId,
                              )
                              return (
                                <li key={member.userId}>
                                  <button
                                    className={member.speaking ? 'speaking' : ''}
                                    onClick={() => select('channel', ch.id)}
                                    title={`${person?.display_name || 'Membro'} · ${member.muted ? 'Microfone desligado' : 'Na chamada'}`}
                                  >
                                    <Avatar profile={person} small />
                                    <span>{person?.display_name || 'Membro'}</span>
                                    {member.screen && (
                                      <MonitorUp size={13} aria-label="Transmitindo tela" />
                                    )}
                                    {member.camera && (
                                      <Video size={13} aria-label="Câmera ligada" />
                                    )}
                                    {member.muted && (
                                      <MicOff size={13} aria-label="Microfone desligado" />
                                    )}
                                  </button>
                                </li>
                              )
                            })}
                          </ul>
                        )}
                      </div>
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
                <SettingsIcon size={19} />
              </IconButton>
            )}
            {currentServer && (
              <IconButton
                className={`members-toggle ${showMembers ? 'active' : ''}`}
                label={showMembers ? 'Ocultar membros' : 'Mostrar membros'}
                aria-expanded={showMembers}
                aria-controls="members-sidebar"
                onClick={() => setShowMembers(!showMembers)}
              >
                <Users size={20} />
                <span>Membros</span>
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
                    onPresenceChange={onPresenceChange}
                  />
                </Suspense>
              </div>
            )}
          </div>
          {currentServer && showMembers && (
            <aside
              className="members-sidebar"
              id="members-sidebar"
              aria-label="Membros da comunidade"
            >
              <div className="section-label">
                <span>NA COMUNIDADE — {people.length}</span>
                <IconButton label="Fechar lista de membros" onClick={() => setShowMembers(false)}>
                  <X size={15} />
                </IconButton>
              </div>
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
      <nav className="mobile-dock" aria-label="Navegação principal no celular">
        <button
          className={mobile || (serverId && !voiceVisible) ? 'active' : ''}
          aria-label="Servidores e canais"
          aria-expanded={mobile}
          onClick={() => {
            setMobile(!mobile)
            setShowMembers(false)
          }}
        >
          <Orbit size={22} />
          <span>Servidores</span>
        </button>
        <button
          className={!serverId && !mobile ? 'active' : ''}
          onClick={() => {
            home()
            setShowMembers(false)
          }}
        >
          <Users size={22} />
          <span>Amigos</span>
        </button>
        <button
          className={voiceVisible && !mobile ? 'active' : ''}
          disabled={!voice}
          onClick={() => {
            if (voice) {
              setServerId(voice.server_id)
              select('channel', voice.id)
              setShowMembers(false)
            }
          }}
        >
          <Headphones size={22} />
          {voice && <i />}
          <span>Chamada</span>
        </button>
        <button disabled={!data.me} onClick={() => openModal('settings')}>
          <SettingsIcon size={22} />
          <span>Perfil</span>
        </button>
      </nav>
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
      {modal === 'invite' && currentServer && owner && (
        <Modal title={`Adicionar membros a ${currentServer.name}`} close={() => setModal(null)}>
          <ServerMembers
            server={currentServer}
            people={people}
            refresh={data.refresh}
            report={report}
          />
        </Modal>
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
          close={modal === 'join' ? closeJoin : () => setModal(null)}
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
                  ? 'Cole o link ou código compartilhado com você e confirme para entrar no servidor.'
                  : 'Organize as conversas do seu servidor.'}
            </p>
            <label>
              {modal === 'join' ? 'Link ou código de convite' : 'Nome'}
              <input
                autoFocus
                required
                value={name}
                maxLength={modal === 'join' ? 2048 : 64}
                onChange={(e) => setName(e.target.value)}
                placeholder={
                  modal === 'server'
                    ? 'Ex.: Nossa galáxia'
                    : modal === 'join'
                      ? 'https://th23dev.github.io/orbita/#/invite/…'
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
    rememberInvitation(window.location.hash)
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
