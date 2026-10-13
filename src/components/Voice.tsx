import { useEffect, useRef, useState } from 'react'
import { ConnectionState, Room, RoomEvent, Track, createLocalVideoTrack } from 'livekit-client'
import type { Participant, RemoteParticipant, LocalVideoTrack } from 'livekit-client'
import { FunctionsHttpError, FunctionsFetchError } from '@supabase/supabase-js'
import {
  AudioLines,
  Headphones,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  Volume2,
  Square,
  Upload,
  Pencil,
  Trash2,
  Users,
  Signal,
  Maximize,
  Minimize,
  X,
  Radio,
  Video,
  VideoOff,
} from 'lucide-react'
import { check, db, errorText } from '../lib/supabase'
import { addSound, deleteSound } from '../lib/files'
import { Soundboard } from '../lib/soundboard'
import type { Channel, Profile, Sound } from '../lib/types'
import { Avatar, IconButton } from './ui'

function MediaTrack({
  track,
  camera = false,
  mirror = false,
}: {
  track: Track
  camera?: boolean
  mirror?: boolean
}) {
  const element = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const media = track.attach()
    if (track.kind === Track.Kind.Video) {
      ;(media as HTMLVideoElement).playsInline = true
      media.muted = true
    }
    element.current?.appendChild(media)
    return () => {
      track.detach(media)
      media.remove()
    }
  }, [track])
  return (
    <div
      className={
        track.kind === Track.Kind.Video
          ? `${camera ? 'camera-stream' : 'screen-stream'} ${mirror ? 'mirrored' : ''}`
          : 'audio-stream'
      }
      ref={element}
    />
  )
}

export function Voice({
  channel,
  me,
  profiles,
  initialVolume,
  report,
  leave,
}: {
  channel: Channel
  me: Profile
  profiles: Profile[]
  initialVolume: number
  report: (s: string) => void
  leave: () => void
}) {
  const [room] = useState(
    () => new Room({ adaptiveStream: true, dynacast: true, disconnectOnPageLeave: true }),
  )
  const [state, setState] = useState<ConnectionState>(ConnectionState.Disconnected),
    [joining, setJoining] = useState(false),
    [joined, setJoined] = useState(false),
    [, setVersion] = useState(0)
  const [sounds, setSounds] = useState<Sound[]>([]),
    [volume, setVolume] = useState(initialVolume),
    [quality, setQuality] = useState('1080'),
    [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [soundboardOpen, setSoundboardOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [startWithMic, setStartWithMic] = useState(true)
  const [previewCamera, setPreviewCamera] = useState<LocalVideoTrack | null>(null)
  const [cameraBusy, setCameraBusy] = useState(false)
  const [qualityBusy, setQualityBusy] = useState(false)
  const previewCameraRef = useRef<LocalVideoTrack | null>(null)
  const panel = useRef<HTMLElement>(null)
  const soundboardToggle = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement === panel.current)
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && soundboardOpen) {
        setSoundboardOpen(false)
        soundboardToggle.current?.focus()
      }
    }
    document.addEventListener('fullscreenchange', changed)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('fullscreenchange', changed)
      document.removeEventListener('keydown', escape)
    }
  }, [soundboardOpen])
  const board = useRef<Soundboard | null>(null),
    input = useRef<HTMLInputElement>(null),
    mounted = useRef(true)
  const run = async (action: () => Promise<void>) => {
    try {
      await action()
    } catch (e) {
      report(errorText(e))
    }
  }
  const loadSounds = async () =>
    setSounds(
      check(
        await db().from('soundboard_sounds').select('*').eq('ready', true).order('name'),
      ) as Sound[],
    )
  useEffect(() => {
    mounted.current = true
    const update = () => setVersion((v) => v + 1)
    room.on(RoomEvent.ConnectionStateChanged, setState)
    for (const event of [
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.TrackSubscribed,
      RoomEvent.TrackUnsubscribed,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.ActiveSpeakersChanged,
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
      RoomEvent.AudioPlaybackStatusChanged,
    ])
      room.on(event, update)
    void loadSounds().catch((e) => report(errorText(e)))
    const sub = db()
      .channel(`sounds:${me.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'soundboard_sounds',
          filter: `owner_id=eq.${me.id}`,
        },
        () => {
          void loadSounds().catch((e) => report(errorText(e)))
        },
      )
      .subscribe()
    return () => {
      mounted.current = false
      previewCameraRef.current?.stop()
      previewCameraRef.current = null
      room.removeAllListeners()
      void board.current?.dispose()
      void room.disconnect()
      void db().removeChannel(sub)
    }
  }, [room, me.id, report])
  // Recheck server authorization while connected. Tokens alone do not evict existing media sessions.
  useEffect(() => {
    if (!joined) return
    const checkAccess = async () => {
      const { data, error } = await db()
        .from('channels')
        .select('id')
        .eq('id', channel.id)
        .eq('archived', false)
        .maybeSingle()
      if (error || !data) {
        await room.disconnect()
        report('Acesso ao canal encerrado.')
        leave()
      }
    }
    const timer = setInterval(() => void checkAccess(), 15000)
    return () => clearInterval(timer)
  }, [joined, room, channel.id, report, leave])
  async function togglePreviewCamera() {
    if (previewCameraRef.current) {
      previewCameraRef.current.stop()
      previewCameraRef.current = null
      setPreviewCamera(null)
      return
    }
    setCameraBusy(true)
    try {
      const track = await createLocalVideoTrack({ resolution: { width: 1280, height: 720 } })
      if (!mounted.current) {
        track.stop()
        return
      }
      previewCameraRef.current = track
      setPreviewCamera(track)
    } catch {
      report(
        'Não foi possível abrir a câmera. Verifique a permissão do navegador e se ela está disponível.',
      )
    } finally {
      setCameraBusy(false)
    }
  }
  async function changeScreenQuality(value: string) {
    setQualityBusy(true)
    try {
      const dimensions = { width: value === '1080' ? 1920 : 1280, height: Number(value) }
      const local = room.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track
      if (local)
        await local.mediaStreamTrack.applyConstraints({
          width: { ideal: dimensions.width, max: dimensions.width },
          height: { ideal: dimensions.height, max: dimensions.height },
          frameRate: { max: 15 },
        })
      for (const participant of room.remoteParticipants.values())
        participant.getTrackPublication(Track.Source.ScreenShare)?.setVideoDimensions(dimensions)
      setQuality(value)
    } finally {
      setQualityBusy(false)
    }
  }
  async function connect() {
    setJoining(true)
    try {
      const requestToken = () =>
        db().functions.invoke('livekit-token', {
          body: { channel_id: channel.id },
        })
      let response = await requestToken()
      if (response.error instanceof FunctionsHttpError && response.error.context.status === 401) {
        const { error } = await db().auth.refreshSession()
        if (!error) response = await requestToken()
      }
      const { data, error } = response
      if (error instanceof FunctionsHttpError) {
        const messages: Record<number, string> = {
          401: 'Sua sessão expirou. Entre na sua conta novamente para participar.',
          403: 'Você não tem acesso a este canal ou ele foi encerrado.',
          429: 'Muitas tentativas de conexão. Aguarde um momento e tente novamente.',
          503: 'O serviço de voz está indisponível. Tente novamente em instantes.',
        }
        throw new Error(
          messages[error.context.status] || 'Não foi possível iniciar a chamada. Tente novamente.',
        )
      }
      if (error instanceof FunctionsFetchError)
        throw new Error(
          'Não foi possível alcançar o serviço de voz. Verifique a conexão e tente novamente.',
        )
      if (error) throw new Error('O serviço de voz não respondeu. Tente novamente em instantes.')
      if (!data?.token || !data?.url)
        throw new Error('O serviço de voz retornou uma resposta inválida.')
      if (!mounted.current) return
      await room.connect(data.url, data.token)
      if (!mounted.current) {
        await room.disconnect()
        return
      }
      board.current = new Soundboard(room)
      setJoined(true)
      await room.startAudio()
      if (!mounted.current) return
      if (previewCameraRef.current) {
        const track = previewCameraRef.current
        previewCameraRef.current = null
        setPreviewCamera(null)
        try {
          await room.localParticipant.publishTrack(track, { source: Track.Source.Camera })
        } catch {
          track.stop()
          report('Você entrou sem câmera. Tente ligá-la novamente nos controles da chamada.')
        }
      }
      try {
        if (startWithMic) await room.localParticipant.setMicrophoneEnabled(true)
      } catch {
        report(
          'Você entrou com o microfone desligado. Permita o acesso ao microfone no navegador para falar.',
        )
      }
    } finally {
      setJoining(false)
    }
  }
  const people: Participant[] = joined
    ? [room.localParticipant, ...room.remoteParticipants.values()]
    : []
  const tracks = people.flatMap((p) =>
    [...p.trackPublications.values()]
      .filter(
        (pub) =>
          pub.track &&
          (pub.source === Track.Source.ScreenShare ||
            (!p.isLocal && pub.kind === Track.Kind.Audio)),
      )
      .map((pub) => ({ track: pub.track!, name: p.name || p.identity, sid: pub.trackSid })),
  )
  const screens = tracks.filter(({ track }) => track.kind === Track.Kind.Video)
  const cameras = people.flatMap((person) => {
    const publication = person.getTrackPublication(Track.Source.Camera)
    return publication?.track && !publication.isMuted
      ? [
          {
            track: publication.track,
            name: person.name || person.identity,
            sid: publication.trackSid,
            local: person.isLocal,
          },
        ]
      : []
  })
  const featuredCamera = screens.length === 0 && cameras.length === 1 ? cameras[0] : null
  const connected = state === ConnectionState.Connected
  const status = joining
    ? 'Conectando…'
    : state === ConnectionState.Reconnecting
      ? 'Reconectando…'
      : connected
        ? 'Voz conectada'
        : joined
          ? 'Conexão encerrada'
          : 'Canal de voz'
  const toggleSoundboard = () => setSoundboardOpen((open) => !open)
  return (
    <section
      className={`voice-panel ${soundboardOpen ? 'soundboard-open' : ''}`}
      ref={panel}
      aria-label="Sala de chamada"
    >
      <header className="call-header">
        <div className="call-heading">
          <span className="call-channel-icon">
            <Headphones size={20} />
          </span>
          <div>
            <h1>{channel.name}</h1>
            <span className={`call-status ${connected ? 'connected' : ''}`} role="status">
              <Signal size={12} />
              {status}
            </span>
          </div>
        </div>
        <div className="call-header-actions">
          {joined && (
            <span className="call-count">
              <Users size={15} />
              {people.length}
              <span className="sr-only"> participantes</span>
            </span>
          )}
          <IconButton
            label={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
            onClick={() =>
              void run(async () => {
                if (document.fullscreenElement) await document.exitFullscreen()
                else await panel.current?.requestFullscreen()
              })
            }
          >
            {fullscreen ? <Minimize size={19} /> : <Maximize size={19} />}
          </IconButton>
        </div>
      </header>
      <div className={`call-stage ${screens.length || featuredCamera ? 'has-screen' : ''}`}>
        {!joined ? (
          <div className="call-lobby">
            <div className="call-preview">
              <span className="preview-badge">SUA PRÉVIA</span>
              {previewCamera ? (
                <MediaTrack track={previewCamera} camera mirror />
              ) : (
                <div className="preview-orbit">
                  <Avatar profile={me} />
                </div>
              )}
              <span className="preview-name">
                {me.display_name}
                <span>você</span>
              </span>
              <span className="preview-mic">
                {startWithMic ? <Mic size={17} /> : <MicOff size={17} />}
              </span>
            </div>
            <div className="preview-settings" aria-label="Como entrar na chamada">
              <button
                className={startWithMic ? '' : 'off'}
                disabled={joining}
                aria-pressed={startWithMic}
                onClick={() => setStartWithMic((value) => !value)}
              >
                {startWithMic ? <Mic size={18} /> : <MicOff size={18} />}
                <span>Microfone {startWithMic ? 'ligado' : 'desligado'}</span>
              </button>
              <button
                className={previewCamera ? '' : 'off'}
                disabled={joining || cameraBusy}
                aria-pressed={Boolean(previewCamera)}
                onClick={() => void togglePreviewCamera()}
              >
                {previewCamera ? <Video size={18} /> : <VideoOff size={18} />}
                <span>
                  {cameraBusy
                    ? 'Abrindo câmera…'
                    : `Câmera ${previewCamera ? 'ligada' : 'desligada'}`}
                </span>
              </button>
            </div>
            <div className="lobby-copy">
              <h2>O melhor lugar é junto.</h2>
              <p>
                Entre em <strong>{channel.name}</strong> para conversar
                <br />
                ou compartilhar o que está na sua tela.
              </p>
            </div>
          </div>
        ) : (
          <>
            {featuredCamera && (
              <div className="streams featured-camera">
                <div className="screen-card">
                  <div className="stream-label">
                    <Video size={14} />
                    <span>Câmera de {featuredCamera.name}</span>
                    <b>AO VIVO</b>
                  </div>
                  <MediaTrack track={featuredCamera.track} camera mirror={featuredCamera.local} />
                </div>
              </div>
            )}
            {screens.length > 0 && (
              <div className="streams">
                {screens.map(({ track, name, sid }) => (
                  <div className="screen-card" key={sid}>
                    <div className="stream-label">
                      <MonitorUp size={14} />
                      <span>Tela de {name}</span>
                      <b>AO VIVO</b>
                    </div>
                    <MediaTrack track={track} />
                  </div>
                ))}
              </div>
            )}
            <div className={`participants ${people.length === 1 ? 'solo' : ''}`}>
              {people.map((person) => {
                const profile = person.isLocal ? me : profiles.find((p) => p.id === person.identity)
                const name = person.name || profile?.display_name || 'Participante'
                const camera = person.getTrackPublication(Track.Source.Camera)
                return (
                  <div
                    key={person.identity}
                    className={`participant ${person.isSpeaking ? 'speaking' : ''}`}
                  >
                    {person.isSpeaking && (
                      <span className="speaking-indicator">
                        <AudioLines size={13} />
                        Falando
                      </span>
                    )}
                    {camera?.track && !camera.isMuted && camera.trackSid !== featuredCamera?.sid ? (
                      <MediaTrack track={camera.track} camera mirror={person.isLocal} />
                    ) : (
                      <div className="participant-avatar">
                        <Avatar profile={profile} />
                      </div>
                    )}
                    <div className="participant-bottom">
                      <span className="participant-name">
                        {name}
                        {person.isLocal && <small>você</small>}
                      </span>
                      <span
                        className={`participant-mic ${!person.isMicrophoneEnabled ? 'muted' : ''}`}
                        aria-label={
                          person.isMicrophoneEnabled ? 'Microfone ligado' : 'Microfone desligado'
                        }
                      >
                        {person.isMicrophoneEnabled ? <Mic size={15} /> : <MicOff size={15} />}
                      </span>
                    </div>
                    {!person.isLocal && (
                      <label className="participant-volume">
                        <Volume2 size={14} />
                        <input
                          aria-label={`Volume de ${name}`}
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          defaultValue="1"
                          onChange={(e) =>
                            (person as RemoteParticipant).setVolume(Number(e.target.value))
                          }
                        />
                      </label>
                    )}
                  </div>
                )
              })}
            </div>
            {people.length === 1 && (
              <p className="call-alone">
                Você chegou primeiro. A sala está aberta para a conversa.
              </p>
            )}
          </>
        )}
      </div>
      <div className="call-audio" aria-hidden="true">
        {tracks
          .filter(({ track }) => track.kind === Track.Kind.Audio)
          .map(({ track, sid }) => (
            <MediaTrack key={sid} track={track} />
          ))}
      </div>
      {joined && !room.canPlaybackAudio && (
        <button className="call-audio-notice" onClick={() => void run(() => room.startAudio())}>
          <Volume2 size={16} />
          Clique para ativar o áudio
        </button>
      )}
      <footer className="call-footer">
        {!joined ? (
          <div className="call-join-row">
            <button
              className="call-join"
              disabled={joining || cameraBusy}
              onClick={() => void run(connect)}
            >
              <Headphones size={21} />
              {joining ? 'Conectando…' : 'Entrar na chamada'}
            </button>
            <button
              ref={soundboardToggle}
              className={`call-control ${soundboardOpen ? 'active' : ''}`}
              title="Soundboard"
              aria-label="Soundboard"
              aria-expanded={soundboardOpen}
              aria-controls="call-soundboard"
              onClick={toggleSoundboard}
            >
              <AudioLines size={22} />
            </button>
          </div>
        ) : (
          <div className="voice-controls">
            <div className="call-control-group">
              <button
                className={`call-control ${!room.localParticipant.isMicrophoneEnabled ? 'is-muted' : ''}`}
                disabled={!connected || joining}
                title={
                  room.localParticipant.isMicrophoneEnabled
                    ? 'Desligar microfone'
                    : 'Ligar microfone'
                }
                aria-label={
                  room.localParticipant.isMicrophoneEnabled
                    ? 'Desligar microfone'
                    : 'Ligar microfone'
                }
                aria-pressed={room.localParticipant.isMicrophoneEnabled}
                onClick={() =>
                  void run(async () => {
                    await room.localParticipant.setMicrophoneEnabled(
                      !room.localParticipant.isMicrophoneEnabled,
                    )
                    setVersion((v) => v + 1)
                  })
                }
              >
                {room.localParticipant.isMicrophoneEnabled ? (
                  <Mic size={23} />
                ) : (
                  <MicOff size={23} />
                )}
              </button>
              <span>Microfone</span>
            </div>
            <div className="call-control-group">
              <button
                className={`call-control ${room.localParticipant.isCameraEnabled ? 'active' : ''}`}
                disabled={!connected || joining || cameraBusy}
                title={room.localParticipant.isCameraEnabled ? 'Desligar câmera' : 'Ligar câmera'}
                aria-label={
                  room.localParticipant.isCameraEnabled ? 'Desligar câmera' : 'Ligar câmera'
                }
                aria-pressed={room.localParticipant.isCameraEnabled}
                onClick={() =>
                  void run(async () => {
                    setCameraBusy(true)
                    try {
                      const enabled = !room.localParticipant.isCameraEnabled
                      await room.localParticipant.setCameraEnabled(enabled, {
                        resolution: { width: 1280, height: 720 },
                      })
                      setVersion((v) => v + 1)
                    } catch {
                      throw new Error(
                        'Não foi possível alterar a câmera. Verifique a permissão do navegador e tente novamente.',
                      )
                    } finally {
                      setCameraBusy(false)
                    }
                  })
                }
              >
                {room.localParticipant.isCameraEnabled ? (
                  <Video size={23} />
                ) : (
                  <VideoOff size={23} />
                )}
              </button>
              <span>Câmera</span>
            </div>
            <div className="call-control-group">
              <button
                className={`call-control ${room.localParticipant.isScreenShareEnabled ? 'active' : ''}`}
                disabled={!connected || joining}
                title={
                  room.localParticipant.isScreenShareEnabled
                    ? 'Parar transmissão'
                    : 'Compartilhar tela'
                }
                aria-label={
                  room.localParticipant.isScreenShareEnabled
                    ? 'Parar transmissão'
                    : 'Compartilhar tela'
                }
                aria-pressed={room.localParticipant.isScreenShareEnabled}
                onClick={() =>
                  void run(async () => {
                    await room.localParticipant.setScreenShareEnabled(
                      !room.localParticipant.isScreenShareEnabled,
                      {
                        audio: true,
                        resolution: {
                          width: quality === '1080' ? 1920 : 1280,
                          height: Number(quality),
                          frameRate: 15,
                        },
                      },
                    )
                    setVersion((v) => v + 1)
                  })
                }
              >
                <MonitorUp size={23} />
              </button>
              <span>Tela</span>
            </div>
            <div className="call-control-group">
              <button
                ref={soundboardToggle}
                className={`call-control ${soundboardOpen ? 'active' : ''}`}
                title="Soundboard"
                aria-label="Soundboard"
                aria-expanded={soundboardOpen}
                aria-controls="call-soundboard"
                onClick={toggleSoundboard}
              >
                <AudioLines size={23} />
              </button>
              <span>Sons</span>
            </div>
            <span className="call-control-divider" />
            <div className="call-control-group">
              <button
                className="call-control hangup"
                title="Sair da chamada"
                aria-label="Sair da chamada"
                onClick={leave}
              >
                <PhoneOff size={23} />
              </button>
              <span>Desconectar</span>
            </div>
          </div>
        )}
        <div className="call-footer-meta">
          <span>
            <Radio size={12} />
            {joined
              ? status
              : `${startWithMic ? 'Microfone ligado' : 'Microfone desligado'} · ${previewCamera ? 'Câmera ligada' : 'Câmera desligada'} ao entrar`}
          </span>
          {joined && screens.length > 0 && (
            <label className="call-quality">
              Qualidade da tela
              <select
                aria-label="Qualidade de transmissão"
                value={quality}
                onChange={(e) => void run(() => changeScreenQuality(e.target.value))}
                disabled={qualityBusy || !connected}
              >
                <option value="1080">1080p</option>
                <option value="720">720p</option>
              </select>
            </label>
          )}
        </div>
      </footer>
      <aside
        className="soundboard"
        id="call-soundboard"
        aria-label="Soundboard"
        hidden={!soundboardOpen}
      >
        <header>
          <div>
            <h2>
              <AudioLines size={20} /> Soundboard
            </h2>
            <p>Seus sons. A sala inteira ouvindo.</p>
          </div>
          <IconButton
            label="Fechar soundboard"
            onClick={() => {
              setSoundboardOpen(false)
              soundboardToggle.current?.focus()
            }}
          >
            <X size={19} />
          </IconButton>
        </header>
        <div className="soundboard-upload">
          <input
            type="file"
            ref={input}
            hidden
            accept="audio/mpeg,audio/wav,audio/x-wav,audio/ogg"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file)
                void run(async () => {
                  setUploadProgress(0)
                  try {
                    await addSound(file, me.id, setUploadProgress)
                    await loadSounds()
                  } finally {
                    setUploadProgress(null)
                  }
                })
            }}
          />
          <button
            className="secondary"
            disabled={uploadProgress !== null}
            onClick={() => input.current?.click()}
          >
            <Upload size={16} />
            Adicionar som
          </button>
        </div>
        {uploadProgress !== null && <progress value={uploadProgress} max={100} />}
        <div className="sound-grid">
          {sounds.map((sound, i) => (
            <div className="sound-tile" key={sound.id}>
              <button
                className="sound-play"
                disabled={!joined || state !== ConnectionState.Connected}
                onClick={() =>
                  void run(async () => {
                    await board.current!.play(async () => {
                      const blob = check(await db().storage.from('sounds').download(sound.path))
                      return blob.arrayBuffer()
                    }, volume)
                  })
                }
              >
                <AudioLines size={25} />
                <strong>{sound.name}</strong>
                <small>{String(i + 1).padStart(2, '0')}</small>
              </button>
              <div className="sound-actions">
                <IconButton
                  label={`Renomear ${sound.name}`}
                  onClick={() => {
                    const name = window.prompt('Nome do som', sound.name)
                    if (name?.trim())
                      void run(async () => {
                        check(
                          await db()
                            .from('soundboard_sounds')
                            .update({ name: name.trim().slice(0, 64) })
                            .eq('id', sound.id),
                        )
                        await loadSounds()
                      })
                  }}
                >
                  <Pencil size={13} />
                </IconButton>
                <IconButton
                  label={`Excluir ${sound.name}`}
                  onClick={() => {
                    if (window.confirm(`Excluir ${sound.name}?`))
                      void run(async () => {
                        await deleteSound(sound)
                        await loadSounds()
                      })
                  }}
                >
                  <Trash2 size={13} />
                </IconButton>
              </div>
            </div>
          ))}
        </div>
        {!sounds.length && (
          <p className="sound-empty">
            Sua biblioteca está esperando o primeiro som. Adicione MP3, WAV ou OGG de até 10 MB.
          </p>
        )}
        <footer>
          <label>
            <Volume2 size={16} />
            Volume
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              onChange={(e) => {
                setVolume(Number(e.target.value))
                board.current?.setVolume(Number(e.target.value))
              }}
              onPointerUp={() =>
                void run(async () => {
                  check(
                    await db()
                      .from('user_settings')
                      .update({ soundboard_volume: volume })
                      .eq('user_id', me.id),
                  )
                })
              }
            />
          </label>
          <button className="secondary" onClick={() => board.current?.stop()}>
            <Square size={14} />
            Parar sons
          </button>
        </footer>
      </aside>
    </section>
  )
}
