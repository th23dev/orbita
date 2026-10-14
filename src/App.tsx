import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  ArrowUpRight,
  AudioLines,
  ChevronDown,
  Hash,
  Headphones,
  LockKeyhole,
  LogOut,
  Mail,
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
import { ChannelSettings } from './components/ChannelSettings'
import { FriendPicker } from './components/FriendPicker'
import { InviteInbox } from './components/InviteInbox'
import { MemberManager } from './components/MemberManager'
import { ProfileCard } from './components/ProfileCard'
import { useDialogs } from './components/Dialogs'
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
import type { Channel, Profile, Space } from './lib/types'

const Voice = lazy(() => import('./components/Voice').then((module) => ({ default: module.Voice })))

function Workspace({ session }: { session: Session }) {
  const dialogs = useDialogs()
  const [description, setDescription] = useState('')
  const [restricted, setRestricted] = useState(false)
  const [invitedFriends, setInvitedFriends] = useState<string[]>([])
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null)
  const [viewProfile, setViewProfile] = useState<Profile | null>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem('orbita:channel-groups') || '{}')
    } catch {
      return {}
    }
  })
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
  const friendIds = data.friends
    .filter((f) => f.status === 'accepted')
    .map((f) => (f.requester_id === session.user.id ? f.addressee_id : f.requester_id))
  const friendProfiles = data.profiles.filter((p) => friendIds.includes(p.id))
  const conversationName = (id: string, fallback: string) => {
    const members = data.dmMembers.filter((m) => m.conversation_id === id)
    return members.length === 2
      ? data.profiles.find(
          (p) => p.id === members.find((m) => m.user_id !== session.user.id)?.user_id,
        )?.display_name || fallback
      : fallback
  }
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
        ? {
            id: selectedDm.canonical_id || selectedDm.id,
            kind: 'dm',
            name: conversationName(selectedDm.canonical_id || selectedDm.id, selectedDm.name),
            conversationIds: data.conversations
              .filter(
                (c) =>
                  c.id === (selectedDm.canonical_id || selectedDm.id) ||
                  c.canonical_id === (selectedDm.canonical_id || selectedDm.id),
              )
              .map((c) => c.id),
          }
        : null
  const online = usePresence(currentServer ? `server:${currentServer.id}` : null, data.me)
  const memberIds = data.members.filter((m) => m.server_id === serverId).map((m) => m.user_id)
  const people = data.profiles
    .filter((p) => memberIds.includes(p.id))
    .sort((a, b) => Number(online.includes(b.id)) - Number(online.includes(a.id)))
  const owner = currentServer?.owner_id === session.user.id
  const manager =
    owner ||
    data.members.some(
      (m) => m.server_id === serverId && m.user_id === session.user.id && m.access_role === 'admin',
    )
  const canManageChannel = (id: string) =>
    manager ||
    data.channelMembers.some(
      (m) =>
        m.channel_id === id &&
        m.user_id === session.user.id &&
        m.status === 'accepted' &&
        m.role === 'moderator',
    )
  const leave = useCallback(() => setVoice(null), [])
  useEffect(() => {
    try {
      localStorage.setItem('orbita:channel-groups', JSON.stringify(collapsed))
    } catch {
      /* Optional preference. */
    }
  }, [collapsed])
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
        const id = check(
          await db().rpc('create_community', {
            title: name.trim(),
            description: description.trim(),
            people: invitedFriends,
          }),
        )
        await data.refresh()
        setServerId(id)
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
        const id = check(
          await db().rpc('create_community', {
            title: name.trim(),
            description: description.trim(),
            people: invitedFriends,
            s: serverId,
            channel_kind: kind,
            restricted,
          }),
        )
        await data.refresh()
        select('channel', id)
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
    setDescription('')
    setRestricted(false)
    setInvitedFriends([])
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
            aria-label={s.name}
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
              {manager && (
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
          {currentServer && manager && (
            <button className="sidebar-invite" onClick={() => openModal('invite')}>
              <UserPlus size={18} />
              <span>Adicionar membros</span>
            </button>
          )}
          <button className="sidebar-link" onClick={() => openModal('inbox')}>
            <Mail size={19} />
            <span>Convites</span>
            {data.invites.length > 0 && <span className="count">{data.invites.length}</span>}
          </button>
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
                    <button
                      className="section-toggle"
                      aria-expanded={!collapsed[`${serverId}:${type}`]}
                      aria-controls={`channel-group-${type}`}
                      onClick={() =>
                        setCollapsed((old) => ({
                          ...old,
                          [`${serverId}:${type}`]: !old[`${serverId}:${type}`],
                        }))
                      }
                    >
                      <ChevronDown
                        size={12}
                        className={collapsed[`${serverId}:${type}`] ? 'collapsed' : ''}
                      />
                      {type === 'text' ? 'CANAIS DE TEXTO' : 'CANAIS DE VOZ'}
                    </button>
                    {manager && (
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
                  <div id={`channel-group-${type}`} hidden={!!collapsed[`${serverId}:${type}`]}>
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
                          <IconButton
                            className="channel-settings-button"
                            label={`Configurações de ${ch.name}`}
                            onClick={() => setEditingChannel(ch)}
                          >
                            <SettingsIcon size={15} />
                          </IconButton>
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
                </div>
              ))}
            </>
          ) : (
            <>
              <div className="section-label">
                <span>MENSAGENS DIRETAS</span>
                <MessageCircle size={14} />
              </div>
              {data.conversations
                .filter((c) => !c.canonical_id)
                .map((c) => (
                  <button
                    className={`sidebar-link ${selection?.id === c.id ? 'active' : ''}`}
                    key={c.id}
                    onClick={() => {
                      setServerId('')
                      select('dm', c.id)
                    }}
                  >
                    <span className="dm-icon">
                      {conversationName(c.id, c.name).slice(0, 1).toUpperCase()}
                    </span>
                    <span>{conversationName(c.id, c.name)}</span>
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
        {currentServer && !owner && (
          <button
            className="sidebar-leave"
            onClick={async () => {
              if (
                await dialogs.confirm({
                  title: `Sair de ${currentServer.name}?`,
                  message: 'Você perderá acesso aos canais. Para voltar, aceite um novo convite.',
                  confirm: 'Sair do servidor',
                  danger: true,
                })
              ) {
                try {
                  check(
                    await db().rpc('manage_membership', {
                      s: serverId,
                      target_user: session.user.id,
                      action: 'leave',
                    }),
                  )
                  if (voice?.server_id === serverId) leave()
                  await data.refresh()
                  home()
                } catch (e) {
                  report(errorText(e))
                }
              }
            }}
          >
            <LogOut size={16} />
            Sair do servidor
          </button>
        )}
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
          <strong>
            {selectedChannel?.name ||
              (selectedDm &&
                conversationName(selectedDm.canonical_id || selectedDm.id, selectedDm.name)) ||
              'Amigos'}
          </strong>
          <span className="header-divider" />
          <span className="header-topic">
            {selectedChannel?.topic || 'Seu ponto de encontro, todos os dias.'}
          </span>
          <div className="header-actions">
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
            {!data.communityReady && (
              <div className="history-context" role="status">
                Os novos convites e cargos estão aguardando a atualização do serviço. Seus dados
                continuam disponíveis.
                <button
                  className="secondary"
                  onClick={() => void data.refresh().catch((e) => report(errorText(e)))}
                >
                  Tentar novamente
                </button>
              </div>
            )}
            {data.loading ? (
              <Empty icon={<Orbit className="spin" />} title="Entrando na sua órbita…" />
            ) : space ? (
              <Chat
                key={`${space.kind}:${space.id}`}
                space={space}
                userId={session.user.id}
                profiles={data.profiles}
                report={report}
                openProfile={setViewProfile}
              />
            ) : selectedChannel?.kind === 'voice' && !voiceVisible ? (
              <Empty icon={<Headphones size={35} />} title={selectedChannel.name}>
                Um lugar para conversar sem pressa.
                <button
                  className="primary"
                  onClick={async () => {
                    if (
                      voice &&
                      !(await dialogs.confirm({
                        title: 'Trocar de chamada?',
                        message: 'Você sairá da sala atual para abrir esta.',
                        confirm: 'Trocar de sala',
                      }))
                    )
                      return
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
                {manager && (
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
                <button
                  className={`member member-profile ${online.includes(p.id) ? '' : 'is-offline'}`}
                  key={p.id}
                  onClick={() => setViewProfile(p)}
                >
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
                </button>
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
          members={data.members.filter((m) => m.server_id === serverId)}
          userId={session.user.id}
        />
      )}
      {modal === 'admin' && currentServer && manager && !owner && (
        <Modal title={`Gerenciar ${currentServer.name}`} close={() => setModal(null)}>
          <MemberManager
            server={currentServer}
            people={people}
            members={data.members.filter((m) => m.server_id === serverId)}
            userId={session.user.id}
            refresh={data.refresh}
            report={report}
          />
        </Modal>
      )}
      {modal === 'invite' && currentServer && manager && (
        <Modal title={`Adicionar membros a ${currentServer.name}`} close={() => setModal(null)}>
          <ServerMembers
            server={currentServer}
            people={people}
            refresh={data.refresh}
            report={report}
            canCreateLinks={owner}
          />
        </Modal>
      )}
      {modal === 'inbox' && (
        <InviteInbox
          invites={data.invites}
          profiles={data.profiles}
          refresh={data.refresh}
          report={report}
          close={() => setModal(null)}
          enter={(s, c) => {
            setServerId(s)
            if (c) select('channel', c)
            else setSelection(null)
          }}
        />
      )}
      {editingChannel && currentServer && (
        <ChannelSettings
          channel={editingChannel}
          server={currentServer}
          userId={session.user.id}
          canManage={canManageChannel(editingChannel.id)}
          canPromote={manager}
          profiles={data.profiles}
          friends={friendProfiles}
          refresh={data.refresh}
          close={() => setEditingChannel(null)}
          report={report}
        />
      )}
      {viewProfile && (
        <ProfileCard
          profile={viewProfile}
          close={() => setViewProfile(null)}
          message={
            friendIds.includes(viewProfile.id)
              ? () => {
                  void (async () => {
                    try {
                      const id = check(
                        await db().rpc('create_dm', {
                          people: [viewProfile.id],
                          title: viewProfile.display_name,
                        }),
                      )
                      await data.refresh()
                      setViewProfile(null)
                      setServerId('')
                      select('dm', id)
                    } catch (e) {
                      report(errorText(e))
                    }
                  })()
                }
              : undefined
          }
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
            {modal !== 'join' && (
              <>
                <label>
                  {modal === 'channel' ? 'Descrição do canal' : 'Descrição do servidor'}
                  <textarea
                    maxLength={modal === 'channel' ? 300 : 500}
                    placeholder="Sobre o que vocês vão conversar?"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </label>
                {modal === 'channel' && (
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={restricted}
                      onChange={(e) => setRestricted(e.target.checked)}
                    />
                    Canal privado · acesso por convite ou cargo
                  </label>
                )}
                <FriendPicker
                  people={friendProfiles}
                  selected={invitedFriends}
                  change={setInvitedFriends}
                />
              </>
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
