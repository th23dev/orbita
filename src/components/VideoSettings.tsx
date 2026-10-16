import { useEffect, useRef, useState } from 'react'
import { Video, VideoOff } from 'lucide-react'
import {
  cameraMediaConstraints,
  cameraQualities,
  updateVideoPreferences,
  useVideoPreferences,
} from '../lib/video-preferences'
import type { VideoPreferences } from '../lib/video-preferences'

export function VideoSettings() {
  const preferences = useVideoPreferences()
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [wanted, setWanted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [active, setActive] = useState(false)
  const [error, setError] = useState('')
  const video = useRef<HTMLVideoElement>(null)
  const supported = Boolean(navigator.mediaDevices?.getUserMedia)

  useEffect(() => {
    let live = true
    const refresh = async () => {
      try {
        const inventory = await navigator.mediaDevices?.enumerateDevices()
        if (live)
          setDevices(
            inventory?.filter((device) => device.kind === 'videoinput' && device.deviceId) || [],
          )
      } catch {
        if (live) setError('Não foi possível listar as câmeras. Tente abrir a prévia novamente.')
      }
    }
    void refresh()
    navigator.mediaDevices?.addEventListener('devicechange', refresh)
    return () => {
      live = false
      navigator.mediaDevices?.removeEventListener('devicechange', refresh)
    }
  }, [active])

  useEffect(() => {
    if (!wanted) return
    let cancelled = false
    let stream: MediaStream | undefined
    const element = video.current
    setBusy(true)
    setActive(false)
    setError('')
    const start = async () => {
      try {
        const captured = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: cameraMediaConstraints(preferences),
        })
        if (cancelled) {
          captured.getTracks().forEach((track) => track.stop())
          return
        }
        stream = captured
        if (element) {
          element.srcObject = captured
          await element.play()
        }
        if (cancelled) return
        captured.getVideoTracks().forEach((track) => {
          track.onended = () => {
            if (cancelled) return
            setError(
              'A câmera foi desconectada ou interrompida. Escolha uma câmera e tente novamente.',
            )
            setWanted(false)
            setActive(false)
          }
        })
        setActive(true)
      } catch (cause) {
        if (cancelled) return
        const name = cause instanceof DOMException ? cause.name : ''
        setError(
          name === 'NotAllowedError'
            ? 'Permita o acesso à câmera nas configurações do navegador e tente novamente.'
            : name === 'NotFoundError' || name === 'OverconstrainedError'
              ? 'A câmera selecionada não está disponível. Escolha outra câmera ou use a padrão.'
              : 'Não foi possível abrir a câmera. Verifique se ela está em uso por outro aplicativo.',
        )
        setWanted(false)
        setActive(false)
      } finally {
        if (!cancelled) setBusy(false)
      }
    }
    void start()
    return () => {
      cancelled = true
      stream?.getTracks().forEach((track) => {
        track.onended = null
        track.stop()
      })
      if (element) element.srcObject = null
    }
    // Mirroring affects only the displayed preview; it must not reacquire the camera.
  }, [wanted, preferences.device, preferences.quality])

  return (
    <>
      <div className="user-settings-intro">
        <h2>Vídeo</h2>
        <p>Escolha sua câmera e confira como você aparece antes de entrar na conversa.</p>
      </div>
      <div className="video-settings-fields">
        <label className="audio-field">
          <span>Câmera</span>
          <select
            aria-label="Câmera"
            value={preferences.device}
            disabled={!supported}
            onChange={(event) => updateVideoPreferences({ device: event.target.value })}
          >
            <option value="default">Câmera padrão do sistema</option>
            {preferences.device !== 'default' &&
              !devices.some((device) => device.deviceId === preferences.device) && (
                <option value={preferences.device}>Câmera salva · indisponível</option>
              )}
            {devices
              .filter((device) => device.deviceId !== 'default')
              .map((device, index) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Câmera ${index + 1}`}
                </option>
              ))}
          </select>
        </label>
        <label className="audio-field">
          <span>Qualidade da câmera</span>
          <select
            aria-label="Qualidade da câmera"
            value={preferences.quality}
            onChange={(event) =>
              updateVideoPreferences({ quality: event.target.value as VideoPreferences['quality'] })
            }
          >
            {Object.entries(cameraQualities).map(([value, preset]) => (
              <option key={value} value={value}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="video-settings-preview">
        <video
          ref={video}
          muted
          playsInline
          className={preferences.mirror ? 'mirrored' : ''}
          aria-label="Prévia da câmera"
        />
        {!active && (
          <div className="video-settings-placeholder">
            <VideoOff size={32} />
            <strong>{busy ? 'Abrindo câmera…' : 'Sua prévia aparece aqui'}</strong>
            <span>O teste fica apenas neste dispositivo.</span>
          </div>
        )}
      </div>
      <div className="video-settings-actions">
        <button
          className={wanted ? 'secondary' : 'primary'}
          disabled={!supported}
          onClick={() => {
            setWanted((value) => !value)
            setActive(false)
            setBusy(false)
          }}
        >
          {wanted ? <VideoOff size={17} /> : <Video size={17} />}
          {wanted ? 'Parar teste de vídeo' : 'Testar vídeo'}
        </button>
        <span role="status">
          {active ? 'Câmera ativa · prévia local' : 'A câmera só é ativada ao testar.'}
        </span>
      </div>
      {!supported && (
        <p role="alert" className="video-settings-error">
          Este navegador não permite acessar a câmera. Use um navegador compatível em uma conexão
          segura.
        </p>
      )}
      {error && (
        <p role="alert" className="video-settings-error">
          {error}
        </p>
      )}
      <label className="audio-toggle video-settings-mirror">
        <span>
          <strong>Espelhar minha prévia</strong>
          <small>
            Altera apenas a imagem que você vê. As outras pessoas recebem a imagem original.
          </small>
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={preferences.mirror}
          onChange={(event) => updateVideoPreferences({ mirror: event.target.checked })}
        />
        <i aria-hidden="true" />
      </label>
      <p className="video-settings-note">
        Preferências salvas neste navegador. Câmera e qualidade são aplicadas ao ligar a câmera
        novamente na chamada. A resolução final depende da câmera e da conexão.
      </p>
    </>
  )
}
