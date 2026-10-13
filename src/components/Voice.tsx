import { useEffect, useRef, useState } from 'react'
import { ConnectionState, Room, RoomEvent, Track } from 'livekit-client'
import type { Participant, RemoteParticipant } from 'livekit-client'
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
} from 'lucide-react'
import { check, db, errorText } from '../lib/supabase'
import { addSound, deleteSound } from '../lib/files'
import { Soundboard } from '../lib/soundboard'
import type { Channel, Profile, Sound } from '../lib/types'
import { Avatar, Empty, IconButton } from './ui'

function MediaTrack({ track }: { track: Track }) {
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
      className={track.kind === Track.Kind.Video ? 'screen-stream' : 'audio-stream'}
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
  async function connect() {
    setJoining(true)
    try {
      const { data, error } = await db().functions.invoke('livekit-token', {
        body: { channel_id: channel.id },
      })
      if (error)
        throw new Error(
          'Não foi possível entrar na chamada. Configure a função livekit-token e as credenciais LiveKit no Supabase.',
        )
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
      await room.localParticipant.setMicrophoneEnabled(true)
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
  return (
    <section className="voice-panel">
      <div className="voice-heading">
        <span className="eyebrow">ESPAÇO PARA ESTAR JUNTO</span>
        <h1>
          <Headphones size={30} /> {channel.name}
        </h1>
        <p>
          {state === ConnectionState.Reconnecting
            ? 'Reconectando à chamada…'
            : state === ConnectionState.Connected
              ? `${people.length} participante${people.length === 1 ? '' : 's'} na sala`
              : joined
                ? 'Conexão encerrada. Saia e entre novamente para reconectar.'
                : 'Sua próxima conversa está a um clique.'}
        </p>
      </div>
      {!joined ? (
        <Empty icon={<AudioLines size={34} />} title="Pode chegar. A sala é sua.">
          Converse por voz, compartilhe sua tela e dê play nos seus sons.
          <button className="primary" disabled={joining} onClick={() => void run(connect)}>
            {joining ? 'Conectando…' : 'Entrar na chamada'}
            <Headphones size={18} />
          </button>
        </Empty>
      ) : (
        <>
          <div className="participants">
            {people.map((person) => (
              <div
                key={person.identity}
                className={`participant ${person.isSpeaking ? 'speaking' : ''}`}
              >
                <Avatar profile={profiles.find((p) => p.id === person.identity)} />
                <strong>
                  {person.name ||
                    profiles.find((p) => p.id === person.identity)?.display_name ||
                    'Participante'}
                  {person.isLocal ? ' (você)' : ''}
                </strong>
                <span>
                  {person.isSpeaking
                    ? 'Falando…'
                    : person.isMicrophoneEnabled
                      ? 'Na conversa'
                      : 'Microfone desligado'}
                </span>
                {!person.isLocal && (
                  <label>
                    <Volume2 size={14} />
                    <input
                      aria-label={`Volume de ${person.name}`}
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
            ))}
          </div>
          <div className="streams">
            {tracks.map(({ track, name, sid }) => (
              <div key={sid}>
                {track.kind === Track.Kind.Video && (
                  <span className="stream-label">Tela de {name}</span>
                )}
                <MediaTrack track={track} />
              </div>
            ))}
          </div>
          <div className="voice-controls">
            <button
              className="secondary"
              onClick={() =>
                void run(async () => {
                  await room.localParticipant.setMicrophoneEnabled(
                    !room.localParticipant.isMicrophoneEnabled,
                  )
                  setVersion((v) => v + 1)
                })
              }
            >
              {room.localParticipant.isMicrophoneEnabled ? <Mic size={18} /> : <MicOff size={18} />}
              Microfone
            </button>
            <button
              className="secondary"
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
              <MonitorUp size={18} />
              {room.localParticipant.isScreenShareEnabled
                ? 'Parar transmissão'
                : 'Compartilhar tela'}
            </button>
            <select
              aria-label="Qualidade de transmissão"
              value={quality}
              onChange={(e) => setQuality(e.target.value)}
            >
              <option value="1080">1080p</option>
              <option value="720">720p</option>
            </select>
            <button className="danger" onClick={leave}>
              <PhoneOff size={18} />
              Sair
            </button>
          </div>
          {!room.canPlaybackAudio && (
            <button className="primary" onClick={() => void run(() => room.startAudio())}>
              Ativar áudio da chamada
            </button>
          )}
        </>
      )}
      <div className="soundboard">
        <header>
          <div>
            <h2>
              <AudioLines size={20} /> Sua soundboard
            </h2>
            <p>Um som, a sala inteira ouvindo. Até 30 segundos por áudio.</p>
          </div>
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
        </header>
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
      </div>
    </section>
  )
}
