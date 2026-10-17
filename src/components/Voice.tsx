import { useShortcut } from '../lib/shortcuts'
import { useEffect, useRef, useState } from 'react'
import {
  ConnectionState,
  DisconnectReason,
  Room,
  RoomEvent,
  Track,
  createLocalVideoTrack,
} from 'livekit-client'
import type { Participant, LocalVideoTrack } from 'livekit-client'
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
  Video,
  VideoOff,
  Settings2,
  ChevronRight,
} from 'lucide-react'
import { check, db, errorText } from '../lib/supabase'
import { addSound, deleteSound } from '../lib/files'
import { Soundboard } from '../lib/soundboard'
import { playCallSound, unlockCallSounds } from '../lib/call-sounds'
import { useDialogs } from './Dialogs'
import type { Channel, Profile, Sound } from '../lib/types'
import { Avatar, IconButton } from './ui'
import { featuredStream } from '../lib/call-layout'
import type { VoicePresence } from '../hooks/useVoicePresence'
import { VoiceMicrophone } from '../lib/voice-microphone'
import { useServerPermissions } from '../hooks/useServerPermissions'
import { StreamPlayer } from './StreamPlayer'
import { CallOptions } from './CallOptions'
import { cameraCaptureOptions, useVideoPreferences } from '../lib/video-preferences'
import {
  changePublishedScreenQuality,
  defaultScreenQuality,
  screenCaptureOptions,
  screenPublishOptions,
  screenQualities,
  setReceivedScreenQuality,
  type ScreenQuality,
} from '../lib/screen-quality'
import {
  canSelectAudioOutput,
  getAudioPreferences,
  processingPreferences,
  updateAudioPreferences,
  useAudioPreferences,
} from '../lib/audio-preferences'

function MediaTrack({
  track,
  camera = false,
  mirror = false,
  volume = 1,
}: {
  track: Track
  camera?: boolean
  mirror?: boolean
  volume?: number
}) {
  const element = useRef<HTMLDivElement>(null)
  const mediaElement = useRef<HTMLMediaElement | null>(null)
  useEffect(() => {
    const media = track.attach()
    mediaElement.current = media
    if (track.kind === Track.Kind.Video) {
      ;(media as HTMLVideoElement).playsInline = true
      media.muted = true
    }
    element.current?.appendChild(media)
    return () => {
      track.detach(media)
      media.remove()
      mediaElement.current = null
    }
  }, [track])
  useEffect(() => {
    if (mediaElement.current && track.kind === Track.Kind.Audio)
      mediaElement.current.volume = volume
  }, [volume, track])
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
  onPresenceChange,
  openAudioSettings,
}: {
  channel: Channel
  me: Profile
  profiles: Profile[]
  initialVolume: number
  report: (s: string) => void
  leave: () => void
  onPresenceChange: (presence: VoicePresence | null) => void
  openAudioSettings: () => void
}) {
  const dialogs = useDialogs()
  const permissions = useServerPermissions(channel.server_id)
  const [room] = useState(
    () => new Room({ adaptiveStream: true, dynacast: true, disconnectOnPageLeave: true }),
  )
  const audioPreferences = useAudioPreferences()
  const videoPreferences = useVideoPreferences()
  const [enhancedAudio, setEnhancedAudio] = useState<boolean | null>(null)
  const [microphone] = useState(
    () => new VoiceMicrophone(room, getAudioPreferences(), setEnhancedAudio),
  )
  const [microphoneBusy, setMicrophoneBusy] = useState(false)
  const [participantVolumes, setParticipantVolumes] = useState<Record<string, number>>({})
  const [state, setState] = useState<ConnectionState>(ConnectionState.Disconnected),
    [joining, setJoining] = useState(false),
    [joined, setJoined] = useState(false),
    [, setVersion] = useState(0)
  const [sounds, setSounds] = useState<Sound[]>([]),
    [volume, setVolume] = useState(initialVolume),
    [quality, setQuality] = useState<ScreenQuality>(defaultScreenQuality),
    [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [soundboardOpen, setSoundboardOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [startWithMic, setStartWithMic] = useState(true)
  const [previewCamera, setPreviewCamera] = useState<LocalVideoTrack | null>(null)
  const [cameraBusy, setCameraBusy] = useState(false)
  const [qualityBusy, setQualityBusy] = useState(false)
  const [receiveQuality, setReceiveQuality] = useState<ScreenQuality>(defaultScreenQuality)
  const screenBusy = useRef(false)
  useEffect(() => {
    const update = () => setReceivedScreenQuality(room, receiveQuality)
    update()
    room.on(RoomEvent.TrackSubscribed, update)
    return () => {
      room.off(RoomEvent.TrackSubscribed, update)
    }
  }, [room, receiveQuality])
  const [selectedStream, setSelectedStream] = useState<string | null>(null)
  const [showParticipants, setShowParticipants] = useState(true)
  const [playingSound, setPlayingSound] = useState<string | null>(null)
  const [activeSound, setActiveSound] = useState<string | null>(null)
  const [soundError, setSoundError] = useState('')
  const soundSequence = useRef(0)
  const hadJoined = useRef(false)
  const connecting = useRef(false)
  const microphoneWanted = useRef(true)
  const reconnect = useRef<() => Promise<void>>(async () => {})
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
    const announce = () => {
      const connected =
        room.state === ConnectionState.Connected || room.state === ConnectionState.Reconnecting
      const local = room.localParticipant
      if (room.state === ConnectionState.Connected)
        microphoneWanted.current = local.isMicrophoneEnabled
      onPresenceChange(
        connected
          ? {
              channelId: channel.id,
              muted: !local.isMicrophoneEnabled,
              speaking: local.isSpeaking,
              camera: local.isCameraEnabled,
              screen: local.isScreenShareEnabled,
            }
          : null,
      )
    }
    room.on(RoomEvent.ConnectionStateChanged, setState)
    room.on(RoomEvent.ConnectionStateChanged, announce)
    room.on(RoomEvent.ParticipantConnected, () => playCallSound('join'))
    room.on(RoomEvent.ParticipantDisconnected, () => playCallSound('leave'))
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
    ]) {
      room.on(event, update)
      room.on(event, announce)
    }
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
      microphone.cancelPending()
      onPresenceChange(null)
      previewCameraRef.current?.stop()
      previewCameraRef.current = null
      room.removeAllListeners()
      if (hadJoined.current) playCallSound('leave')
      hadJoined.current = false
      void board.current?.dispose().catch(() => {})
      void room.disconnect()
      void db().removeChannel(sub)
    }
  }, [room, me.id, report, onPresenceChange, channel.id])
  useEffect(() => {
    let current = true
    void microphone.configure(audioPreferences).catch(() => {
      if (current) {
        const {
          outputDevice: _outputDevice,
          outputVolume: _outputVolume,
          ...previous
        } = microphone.getPreferences()
        if (
          Object.keys(previous).some(
            (key) =>
              previous[key as keyof typeof previous] !==
              audioPreferences[key as keyof typeof previous],
          )
        )
          updateAudioPreferences(previous)
        report(
          'Não foi possível aplicar os ajustes do microfone. Restauramos os ajustes anteriores; confira o dispositivo nas configurações de voz.',
        )
      }
    })
    return () => {
      current = false
    }
  }, [microphone, audioPreferences, report])
  useEffect(() => {
    if (!canSelectAudioOutput()) return
    let current = true
    void room.switchActiveDevice('audiooutput', audioPreferences.outputDevice).catch(() => {
      if (!current) return
      report('A saída selecionada está indisponível. Usando a saída padrão do sistema.')
      if (audioPreferences.outputDevice !== 'default')
        updateAudioPreferences({ outputDevice: 'default' })
    })
    return () => {
      current = false
    }
  }, [room, audioPreferences.outputDevice, report])
  useEffect(() => {
    const devicesChanged = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices()
        if (!mounted.current || !devices.some((device) => device.label)) return
        const preferences = getAudioPreferences()
        const patch: Partial<typeof preferences> = {}
        if (
          preferences.inputDevice !== 'default' &&
          !devices.some(
            (device) => device.kind === 'audioinput' && device.deviceId === preferences.inputDevice,
          )
        )
          patch.inputDevice = 'default'
        if (
          preferences.outputDevice !== 'default' &&
          !devices.some(
            (device) =>
              device.kind === 'audiooutput' && device.deviceId === preferences.outputDevice,
          )
        )
          patch.outputDevice = 'default'
        if (Object.keys(patch).length) {
          updateAudioPreferences(patch)
          report('Um dispositivo de áudio foi desconectado. Selecionamos o padrão do sistema.')
        }
      } catch {
        /* Device enumeration is optional. */
      }
    }
    navigator.mediaDevices?.addEventListener('devicechange', devicesChanged)
    return () => navigator.mediaDevices?.removeEventListener('devicechange', devicesChanged)
  }, [report])
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
      // A suspended tab or temporary fetch failure is not a permission revocation.
      if (!mounted.current || error) return
      if (!data) {
        hadJoined.current = false
        await room.disconnect()
        report('Acesso ao canal encerrado.')
        leave()
        return
      }
      const { data: allowed, error: permissionError } = await db().rpc('server_permissions', { s: channel.server_id })
      if (!mounted.current || permissionError || !allowed) return
      if (!allowed.connect_voice) {
        hadJoined.current = false
        await room.disconnect()
        report('Seu cargo não permite mais participar desta chamada.')
        leave()
        return
      }
      if (!allowed.speak) { await microphone.setEnabled(false); await board.current?.dispose(); board.current = null }
      if (!allowed.use_camera && room.localParticipant.isCameraEnabled) await room.localParticipant.setCameraEnabled(false)
      if (!allowed.share_screen && room.localParticipant.isScreenShareEnabled) await room.localParticipant.setScreenShareEnabled(false)
    }
    const verify = () => {
      if (!document.hidden && navigator.onLine) void checkAccess().catch(() => {})
    }
    const timer = setInterval(verify, 15000)
    document.addEventListener('visibilitychange', verify)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', verify)
    }
  }, [joined, room, channel.id, report, leave])
  useEffect(() => {
    const resume = () => {
      if (document.hidden || !navigator.onLine || !hadJoined.current || connecting.current) return
      if (room.state === ConnectionState.Disconnected)
        void reconnect.current().catch((e) => report(errorText(e)))
      else if (room.state === ConnectionState.Connected) void room.startAudio().catch(() => {})
    }
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('pageshow', resume)
    window.addEventListener('online', resume)
    const disconnected = (reason?: DisconnectReason) => {
      if (
        reason !== undefined &&
        [
          DisconnectReason.CLIENT_INITIATED,
          DisconnectReason.PARTICIPANT_REMOVED,
          DisconnectReason.ROOM_DELETED,
          DisconnectReason.DUPLICATE_IDENTITY,
        ].includes(reason)
      ) {
        hadJoined.current = false
        setJoined(false)
        return
      }
      resume()
    }
    room.on(RoomEvent.Disconnected, disconnected)
    return () => {
      document.removeEventListener('visibilitychange', resume)
      window.removeEventListener('pageshow', resume)
      window.removeEventListener('online', resume)
      room.off(RoomEvent.Disconnected, disconnected)
    }
  }, [room, report])
  useEffect(() => {
    if (!joined || !('mediaSession' in navigator)) return
    navigator.mediaSession.metadata = new MediaMetadata({
      title: channel.name,
      artist: 'Chamada na Órbita',
    })
    navigator.mediaSession.playbackState = 'playing'
    try {
      navigator.mediaSession.setActionHandler('stop', leave)
    } catch {
      /* Unsupported on some browsers. */
    }
    return () => {
      navigator.mediaSession.metadata = null
      navigator.mediaSession.playbackState = 'none'
      try {
        navigator.mediaSession.setActionHandler('stop', null)
      } catch {
        /* Optional action. */
      }
    }
  }, [joined, channel.name, leave])
  async function togglePreviewCamera() {
    if (previewCameraRef.current) {
      previewCameraRef.current.stop()
      previewCameraRef.current = null
      setPreviewCamera(null)
      return
    }
    setCameraBusy(true)
    try {
      const track = await createLocalVideoTrack(cameraCaptureOptions())
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
  async function changeScreenQuality(value: ScreenQuality) {
    if (screenBusy.current || value === quality) return
    screenBusy.current = true
    setQualityBusy(true)
    try {
      await changePublishedScreenQuality(room, value)
      setQuality(value)
    } finally {
      screenBusy.current = false
      setQualityBusy(false)
    }
  }
  async function connect() {
    if (!permissions.connect_voice) throw new Error('Seu cargo não permite entrar em chamadas.')
    if (connecting.current) return
    connecting.current = true
    unlockCallSounds()
    const resuming = hadJoined.current
    const enableMicrophone = permissions.speak && (resuming ? microphoneWanted.current : startWithMic)
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
      await board.current?.dispose().catch(() => {})
      board.current = new Soundboard(room)
      hadJoined.current = true
      if (!resuming) playCallSound('join')
      setJoined(true)
      await room.startAudio().catch(() => {})
      if (!mounted.current) return
      if (previewCameraRef.current && permissions.use_camera) {
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
        if (enableMicrophone) await microphone.setEnabled(true)
      } catch {
        report(
          'Você entrou com o microfone desligado. Permita o acesso ao microfone no navegador para falar.',
        )
      }
    } finally {
      connecting.current = false
      setJoining(false)
    }
  }
  reconnect.current = connect
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
      .map((pub) => ({
        track: pub.track!,
        name: p.name || p.identity,
        sid: pub.trackSid,
        local: p.isLocal,
        identity: p.identity,
      })),
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
  const streams = [
    ...screens.map((stream) => ({ ...stream, kind: 'screen' as const })),
    ...cameras.map((stream) => ({ ...stream, kind: 'camera' as const })),
  ]
  const featured = featuredStream(streams, selectedStream)
  const participantsHidden = Boolean(featured && !showParticipants)
  const streamKey = streams.map((stream) => stream.sid).join(',')
  useEffect(() => {
    if (selectedStream && !streamKey.split(',').includes(selectedStream)) setSelectedStream(null)
  }, [streamKey, selectedStream])
  const microphoneButton = useRef<HTMLButtonElement>(null)
  const cameraButton = useRef<HTMLButtonElement>(null)
  useShortcut('microphone', () => microphoneButton.current?.click())
  useShortcut('camera', () => cameraButton.current?.click())
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
  useShortcut('soundboard', () => toggleSoundboard())
  const toggleSoundboard = () => {
    if (!soundboardOpen) {
      setSoundError('')
      board.current ??= new Soundboard(joined ? room : undefined)
      // Negotiate the dedicated audio track before the user selects a short clip.
      void board.current.prepare().catch((error) => setSoundError(errorText(error)))
    }
    setSoundboardOpen((open) => !open)
  }
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
          {joined && featured ? (
            <button
              className="call-count participants-toggle"
              onClick={() => setShowParticipants((visible) => !visible)}
              aria-label={participantsHidden ? 'Mostrar participantes' : 'Ocultar participantes'}
              title={participantsHidden ? 'Mostrar participantes' : 'Ocultar participantes'}
              aria-expanded={!participantsHidden}
              aria-controls="call-participants"
            >
              <Users size={18} />
              {people.length}
            </button>
          ) : (
            joined && (
              <span className="call-count">
                <Users size={15} />
                {people.length}
                <span className="sr-only"> participantes</span>
              </span>
            )
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
      <div
        className={`call-stage ${featured ? 'has-screen' : ''} ${participantsHidden ? 'participants-hidden' : ''}`}
      >
        {!joined ? (
          <div className="call-lobby">
            <div className="call-preview">
              <span className="preview-badge">SUA PRÉVIA</span>
              {previewCamera ? (
                <MediaTrack track={previewCamera} camera mirror={videoPreferences.mirror} />
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
                disabled={joining || !permissions.speak}
                aria-pressed={startWithMic}
                onClick={() => setStartWithMic((value) => !value)}
              >
                {startWithMic ? <Mic size={18} /> : <MicOff size={18} />}
                <span>Microfone {startWithMic ? 'ligado' : 'desligado'}</span>
              </button>
              <button
                className={previewCamera ? '' : 'off'}
                disabled={joining || cameraBusy || !permissions.use_camera}
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
            {streams.length > 1 && (
              <div className="stream-picker" aria-label="Transmissões ativas">
                {streams.map((stream) => (
                  <button
                    key={stream.sid}
                    type="button"
                    aria-pressed={featured?.sid === stream.sid}
                    aria-label={`Destacar ${stream.kind === 'screen' ? 'tela' : 'câmera'} de ${stream.name}`}
                    onClick={() => setSelectedStream(stream.sid)}
                  >
                    {stream.kind === 'screen' ? <MonitorUp size={17} /> : <Video size={17} />}
                    <span>
                      <small>{stream.kind === 'screen' ? 'Tela' : 'Câmera'}</small>
                      {stream.name}
                    </span>
                  </button>
                ))}
                {selectedStream && (
                  <button
                    type="button"
                    className="reset-focus"
                    onClick={() => setSelectedStream(null)}
                  >
                    Destaque automático
                  </button>
                )}
              </div>
            )}
            {featured && (
              <div className={`streams ${featured.kind === 'camera' ? 'featured-camera' : ''}`}>
                <StreamPlayer
                  key={featured.sid}
                  track={featured.track}
                  name={featured.name}
                  camera={featured.kind === 'camera'}
                  local={featured.local}
                  mirror={featured.kind === 'camera' && featured.local && videoPreferences.mirror}
                  report={report}
                />
              </div>
            )}
            <div
              id="call-participants"
              className={`participants ${people.length === 1 ? 'solo' : ''}`}
              hidden={participantsHidden}
            >
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
                    {camera?.track && !camera.isMuted && camera.trackSid !== featured?.sid ? (
                      <MediaTrack
                        track={camera.track}
                        camera
                        mirror={person.isLocal && videoPreferences.mirror}
                      />
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
                          value={participantVolumes[person.identity] ?? 1}
                          onChange={(e) =>
                            setParticipantVolumes((values) => ({
                              ...values,
                              [person.identity]: Number(e.target.value),
                            }))
                          }
                        />
                      </label>
                    )}
                  </div>
                )
              })}
            </div>
            {people.length === 1 && !featured && (
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
          .map(({ track, sid, identity }) => (
            <MediaTrack
              key={sid}
              track={track}
              volume={audioPreferences.outputVolume * (participantVolumes[identity] ?? 1)}
            />
          ))}
      </div>
      {joined && !room.canPlaybackAudio && (
        <button className="call-audio-notice" onClick={() => void run(() => room.startAudio())}>
          <Volume2 size={16} />
          Clique para ativar o áudio
        </button>
      )}
      {joined && state === ConnectionState.Disconnected && (
        <button className="call-audio-notice" disabled={joining} onClick={() => void run(connect)}>
          <Signal size={17} />{' '}
          {joining ? 'Reconectando…' : 'Conexão interrompida · Tentar reconectar'}
        </button>
      )}
      <footer className="call-footer">
        {!joined ? (
          <div className="call-join-row">
            <button
              className="call-join"
              disabled={joining || cameraBusy || !permissions.connect_voice}
              onClick={() => void run(connect)}
            >
              <Headphones size={21} />
              {!permissions.connect_voice ? 'Seu cargo não permite chamadas' : joining ? 'Conectando…' : 'Entrar na chamada'}
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
                ref={microphoneButton}
                className={`call-control ${!room.localParticipant.isMicrophoneEnabled ? 'is-muted' : ''}`}
                disabled={!connected || joining || microphoneBusy || !permissions.speak}
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
                    setMicrophoneBusy(true)
                    try {
                      await microphone.setEnabled(!room.localParticipant.isMicrophoneEnabled)
                      setVersion((v) => v + 1)
                    } finally {
                      setMicrophoneBusy(false)
                    }
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
                ref={cameraButton}
                className={`call-control ${room.localParticipant.isCameraEnabled ? 'active' : ''}`}
                disabled={!connected || joining || cameraBusy || !permissions.use_camera}
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
                      // Release the old capture so the next enable uses the saved device and quality.
                      const previous = room.localParticipant.getTrackPublication(
                        Track.Source.Camera,
                      )?.track
                      if (previous) await room.localParticipant.unpublishTrack(previous, true)
                      if (enabled)
                        await room.localParticipant.setCameraEnabled(true, cameraCaptureOptions())
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
                disabled={!connected || joining || qualityBusy || !permissions.share_screen}
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
                    if (screenBusy.current) return
                    screenBusy.current = true
                    setQualityBusy(true)
                    try {
                      await room.localParticipant.setScreenShareEnabled(
                        !room.localParticipant.isScreenShareEnabled,
                        screenCaptureOptions(quality),
                        screenPublishOptions(quality),
                      )
                      setVersion((v) => v + 1)
                    } finally {
                      screenBusy.current = false
                      setQualityBusy(false)
                    }
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
        <CallOptions status={status} connected={connected}>
          <div className="call-options-audio">
            <span className="call-options-label">Áudio</span>
            <button
              className="call-audio-settings"
              onClick={(event) => {
                event.currentTarget.closest<HTMLElement>('[popover]')?.hidePopover()
                openAudioSettings()
              }}
              title="Configurar dispositivos, volumes e tratamento de voz"
            >
              <Settings2 size={14} /> Voz e áudio
              <ChevronRight size={14} />
            </button>
            <span role="status">
              {processingPreferences(audioPreferences).noiseSuppression === 'off'
                ? 'Supressão desligada'
                : enhancedAudio === false
                  ? 'Supressão neural indisponível · filtro do navegador'
                  : enhancedAudio === true
                    ? 'Supressão neural ativa'
                    : 'Tratamento de voz ao ligar o microfone'}
            </span>
          </div>
          {!joined && (
            <p className="call-options-preview">
              {`${startWithMic ? 'Microfone ligado' : 'Microfone desligado'} · ${previewCamera ? 'Câmera ligada' : 'Câmera desligada'} ao entrar`}
            </p>
          )}
          {joined && (
            <label className="call-quality">
              Minha transmissão
              <select
                aria-label="Qualidade de transmissão"
                value={quality}
                onChange={(e) =>
                  void run(() => changeScreenQuality(e.target.value as ScreenQuality))
                }
                disabled={qualityBusy || !connected}
                title="Reduza a resolução ou os fps se a transmissão travar."
              >
                {Object.entries(screenQualities).map(([value, preset]) => (
                  <option key={value} value={value}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {joined && screens.some((screen) => !screen.local) && (
            <label className="call-quality">
              Assistir em
              <select
                aria-label="Qualidade para assistir"
                value={receiveQuality}
                onChange={(event) => setReceiveQuality(event.target.value as ScreenQuality)}
                title="Reduza se sua internet estiver lenta. A qualidade depende de quem transmite."
              >
                {Object.entries(screenQualities).map(([value, preset]) => (
                  <option key={value} value={value}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </CallOptions>
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
        {soundError && (
          <p role="alert" className="sound-empty">
            {soundError}
          </p>
        )}
        <div className="sound-grid">
          {sounds.map((sound, i) => (
            <div className="sound-tile" key={sound.id}>
              <button
                className="sound-play"
                disabled={playingSound !== null || (joined && (state !== ConnectionState.Connected || !permissions.speak))}
                aria-label={`${joined ? 'Tocar' : 'Prévia de'} ${sound.name}`}
                onClick={() =>
                  void run(async () => {
                    setPlayingSound(sound.id)
                    setSoundError('')
                    setActiveSound(null)
                    const sequence = ++soundSequence.current
                    board.current ??= new Soundboard(joined ? room : undefined)
                    try {
                      const started = await board.current.play(
                        async () => {
                          const blob = check(await db().storage.from('sounds').download(sound.path))
                          return blob.arrayBuffer()
                        },
                        volume,
                        () => {
                          if (sequence === soundSequence.current) setActiveSound(null)
                        },
                      )
                      if (started && sequence === soundSequence.current) setActiveSound(sound.id)
                    } catch (error) {
                      setSoundError(`Não foi possível tocar o som: ${errorText(error)}`)
                    } finally {
                      setPlayingSound(null)
                    }
                  })
                }
              >
                <AudioLines size={25} />
                <strong>{sound.name}</strong>
                <small>
                  {playingSound === sound.id
                    ? 'Carregando…'
                    : activeSound === sound.id
                      ? 'Reproduzindo…'
                      : joined
                        ? String(i + 1).padStart(2, '0')
                        : 'Ouvir prévia'}
                </small>
              </button>
              <div className="sound-actions">
                <IconButton
                  label={`Renomear ${sound.name}`}
                  onClick={async () => {
                    const name = await dialogs.prompt({
                      title: 'Renomear som',
                      value: sound.name,
                      message: 'Escolha um nome fácil de encontrar na sua biblioteca.',
                    })
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
                  onClick={async () => {
                    if (
                      await dialogs.confirm({
                        title: 'Excluir som?',
                        message: `“${sound.name}” será removido da sua biblioteca.`,
                        confirm: 'Excluir',
                        danger: true,
                      })
                    )
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
            Sua biblioteca está esperando o primeiro som. Adicione MP3, WAV ou OGG de até 10 MB e 30
            segundos.
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
          <button
            className="secondary"
            onClick={() => {
              soundSequence.current++
              board.current?.stop()
              setActiveSound(null)
            }}
          >
            <Square size={14} />
            Parar sons
          </button>
        </footer>
      </aside>
    </section>
  )
}
