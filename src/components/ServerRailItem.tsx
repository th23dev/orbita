import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Headphones, MicOff, MonitorUp, Video } from 'lucide-react'
import type { Channel, Profile, Server } from '../lib/types'
import type { VoiceMember } from '../lib/voice-roster'
import { Avatar } from './ui'
import { ServerLogo } from './ServerLogo'

export function ServerRailItem({ server, index, active, channels, rosters, profiles, onSelect, unreadCount = 0 }: {
  unreadCount?: number
  server: Server
  index: number
  active: boolean
  channels: Channel[]
  rosters: Record<string, VoiceMember[]>
  profiles: Profile[]
  onSelect: () => void
}) {
  const id = useId()
  const button = useRef<HTMLButtonElement>(null)
  const tooltip = useRef<HTMLDivElement>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0, arrow: 24 })
  const rooms = channels.filter((channel) => channel.server_id === server.id &&
    channel.kind === 'voice' && rosters[channel.id]?.length)
  const count = new Set(rooms.flatMap((room) => rosters[room.id].map((member) => member.userId))).size
  const keepOpen = () => { clearTimeout(hideTimer.current); setOpen(true) }
  const closeSoon = () => { hideTimer.current = setTimeout(() => setOpen(false), 120) }
  useEffect(() => () => clearTimeout(hideTimer.current), [])
  useLayoutEffect(() => {
    if (!open) return
    const update = () => {
      if (!button.current || !tooltip.current) return
      const anchor = button.current.getBoundingClientRect()
      const box = tooltip.current.getBoundingClientRect()
      const top = Math.max(8, Math.min(anchor.top, window.innerHeight - box.height - 8))
      setPosition({
        left: Math.max(8, Math.min(anchor.right + 12, window.innerWidth - box.width - 8)),
        top,
        arrow: Math.max(16, Math.min(anchor.top + anchor.height / 2 - top, box.height - 16)),
      })
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(tooltip.current!)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    window.addEventListener('keydown', escape)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('keydown', escape)
    }
  }, [open])
  return <>
    <button ref={button}
      className={`server-icon color-${index % 4} ${active ? 'active' : ''}`}
      aria-label={server.name} aria-describedby={open ? id : undefined}
      onMouseEnter={keepOpen} onMouseLeave={closeSoon}
      onFocus={keepOpen} onBlur={() => setOpen(false)}
      onClick={() => { setOpen(false); onSelect() }}>
      <ServerLogo server={server} />
      {unreadCount > 0 && <span className="server-unread-badge" aria-label={`${unreadCount} mensagens não lidas`}>
        {unreadCount > 99 ? '99+' : unreadCount}
      </span>}
    </button>
    {open && createPortal(
      <div ref={tooltip} id={id} role="tooltip" className="server-preview"
        style={{ left: position.left, top: position.top }}
        onMouseEnter={keepOpen} onMouseLeave={closeSoon}>
        <span className="server-preview-arrow" style={{ top: position.arrow }} />
        <strong className="server-preview-title">{server.name}</strong>
        <div className="server-preview-rooms">
          {count ? <>
            <p className="server-preview-summary"><Headphones size={14} />
              {count} {count === 1 ? 'pessoa em voz' : 'pessoas em voz'}
            </p>
            {rooms.map((room) => <section key={room.id} className="server-preview-room">
              <h3><Headphones size={13} />{room.name}</h3>
              <ul>
                {rosters[room.id].slice(0, 6).map((member) => {
                  const profile = profiles.find((person) => person.id === member.userId)
                  return <li key={member.userId} className={member.speaking ? 'speaking' : ''}>
                    <Avatar profile={profile} small />
                    <span>{profile?.display_name || 'Membro'}</span>
                    {member.screen && <MonitorUp size={13} aria-label="Transmitindo tela" />}
                    {member.camera && <Video size={13} aria-label="Câmera ligada" />}
                    {member.muted && <MicOff size={13} aria-label="Microfone desligado" />}
                  </li>
                })}
              </ul>
              {rosters[room.id].length > 6 && <small>+{rosters[room.id].length - 6} participantes</small>}
            </section>)}
          </> : <p className="server-preview-empty">Ninguém em chamada de voz agora.</p>}
        </div>
      </div>, document.body,
    )}
  </>
}
