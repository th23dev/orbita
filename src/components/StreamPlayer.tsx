import { useEffect, useRef, useState } from 'react'
import { Eye, EyeOff, Maximize, Minimize, MonitorUp, Video } from 'lucide-react'
import type { Track } from 'livekit-client'

type NativeVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void }

export function StreamPlayer({
  track,
  name,
  camera = false,
  mirror = false,
  local = false,
  report,
}: {
  track: Track
  name: string
  camera?: boolean
  mirror?: boolean
  local?: boolean
  report: (message: string) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const video = useRef<NativeVideo | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [fullscreen, setFullscreen] = useState(false)
  const [controls, setControls] = useState(true)
  const [showPreview, setShowPreview] = useState(false)
  const ownScreen = local && !camera
  const previewHidden = ownScreen && !showPreview
  // A monitor/window can contain this app; the capture API cannot reliably tell
  // which monitor currently contains our fullscreen element. Keep local screen
  // previews inline. Remote streams and cameras still support native fullscreen.
  const canFullscreen = !ownScreen
  useEffect(() => {
    if (previewHidden) return
    const host = container.current
    const element = track.attach() as NativeVideo
    element.playsInline = true
    element.muted = true
    video.current = element
    container.current?.querySelector('.stream-video')?.appendChild(element)
    return () => {
      if (document.fullscreenElement === host) void document.exitFullscreen().catch(() => {})
      track.detach(element)
      element.remove()
      video.current = null
    }
  }, [track, previewHidden])
  useEffect(() => {
    if (video.current) video.current.className = mirror ? 'mirrored-video' : ''
  }, [mirror, track, previewHidden])
  useEffect(() => {
    const changed = () => {
      setFullscreen(document.fullscreenElement === container.current)
      setControls(true)
    }
    document.addEventListener('fullscreenchange', changed)
    return () => {
      document.removeEventListener('fullscreenchange', changed)
      clearTimeout(hideTimer.current)
    }
  }, [])
  const revealControls = () => {
    setControls(true)
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => {
      if (!container.current?.contains(document.activeElement)) setControls(false)
    }, 2500)
  }
  const toggleFullscreen = async () => {
    if (!canFullscreen) return
    try {
      if (document.fullscreenElement === container.current) await document.exitFullscreen()
      else if (container.current?.requestFullscreen && document.fullscreenEnabled) {
        await container.current.requestFullscreen({ navigationUI: 'hide' })
        revealControls()
      } else if (video.current?.webkitEnterFullscreen) video.current.webkitEnterFullscreen()
      else report('Este navegador não oferece tela cheia para transmissões.')
    } catch {
      report(
        'Não foi possível abrir a transmissão em tela cheia. Tente novamente pelo botão da transmissão.',
      )
    }
  }
  return (
    <div
      className={`screen-card stream-player ${fullscreen ? 'is-fullscreen' : ''} ${controls ? '' : 'controls-hidden'}`}
      ref={container}
      onPointerMove={revealControls}
      onPointerDown={revealControls}
      onDoubleClick={() => void toggleFullscreen()}
      onFocusCapture={revealControls}
    >
      <div className="stream-label">
        {camera ? <Video size={14} /> : <MonitorUp size={14} />}
        <span>
          {camera ? 'Câmera' : 'Tela'} de {name}
        </span>
        <b>AO VIVO</b>
        {ownScreen && (
          <button
            className="stream-fullscreen-button"
            aria-label={showPreview ? 'Ocultar minha prévia' : 'Mostrar minha prévia'}
            title={showPreview ? 'Ocultar minha prévia' : 'Mostrar minha prévia'}
            aria-pressed={showPreview}
            onClick={() => setShowPreview((value) => !value)}
          >
            {showPreview ? <EyeOff size={19} /> : <Eye size={19} />}
          </button>
        )}
        {canFullscreen && (
          <button
            className="stream-fullscreen-button"
            aria-label={
              fullscreen ? 'Sair da tela cheia da transmissão' : 'Tela cheia da transmissão'
            }
            title={fullscreen ? 'Sair da tela cheia' : 'Tela cheia da transmissão'}
            onDoubleClick={(event) => event.stopPropagation()}
            onClick={async (event) => {
              event.stopPropagation()
              const button = event.currentTarget
              const pointer = event.detail > 0
              await toggleFullscreen()
              if (pointer) button.blur()
            }}
          >
            {fullscreen ? <Minimize size={19} /> : <Maximize size={19} />}
          </button>
        )}
      </div>
      <div className="stream-video" hidden={previewHidden} />
      {previewHidden && (
        <div className="stream-own-placeholder">
          <MonitorUp size={30} />
          <strong>Sua tela está sendo transmitida</strong>
          <p>
            A prévia está oculta para evitar que a imagem se repita. As outras pessoas continuam
            assistindo normalmente.
          </p>
          <button className="secondary" onClick={() => setShowPreview(true)}>
            <Eye size={16} /> Mostrar minha prévia
          </button>
        </div>
      )}
      {ownScreen && showPreview && (
        <div className="stream-own-notice">
          Se a imagem se repetir, o app está dentro da tela capturada. Oculte a prévia ou
          compartilhe somente a janela do jogo.
        </div>
      )}
    </div>
  )
}
