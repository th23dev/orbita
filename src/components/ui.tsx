import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode, ButtonHTMLAttributes } from 'react'
import { X } from 'lucide-react'
import { signedUrl } from '../lib/files'
import type { Profile } from '../lib/types'

export function Logo() {
  return (
    <svg className="logo" viewBox="310 168 1580 420" role="img" aria-label="Órbita">
      <image href={`${import.meta.env.BASE_URL}orbita-logo.png`} width="2172" height="724" />
    </svg>
  )
}
export function IconButton({
  label,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" className="icon-button" title={label} aria-label={label} {...props}>
      {children}
    </button>
  )
}
export function Avatar({
  profile,
  online = false,
  small = false,
}: {
  profile?: Profile
  online?: boolean
  small?: boolean
}) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    let live = true
    setUrl('')
    if (profile?.avatar_path)
      signedUrl('avatars', profile.avatar_path)
        .then((u) => {
          if (live) setUrl(u)
        })
        .catch(() => { })
    return () => {
      live = false
    }
  }, [profile?.avatar_path])
  const hue = ((profile?.id.charCodeAt(0) || 30) * 11) % 360
  return (
    <span
      className={`avatar ${small ? 'small' : ''}`}
      style={{ background: `hsl(${hue} 25% 25%)`, color: `hsl(${hue} 70% 80%)` }}
    >
      {url ? <img src={url} alt="" /> : (profile?.display_name || '?').slice(0, 2).toUpperCase()}
      <i className={`status-dot ${online ? profile?.status || 'online' : 'offline'}`} />
    </span>
  )
}
export function Modal({
  title,
  children,
  close,
  className = '',
}: {
  title: string
  children: ReactNode
  close: () => void
  className?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    ref.current?.showModal()
    const dialog = ref.current
    return () => dialog?.close()
  }, [])
  return (
    <dialog
      ref={ref}
      className={`modal ${className}`}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault()
        close()
      }}
      onClick={(e) => {
        if (e.target === ref.current) close()
      }}
    >
      <div className="modal-inner">
        <header>
          <h2 id={titleId}>{title}</h2>
          <IconButton label="Fechar" onClick={close}>
            <X size={20} />
          </IconButton>
        </header>
        {children}
      </div>
    </dialog>
  )
}
export function Empty({
  icon,
  title,
  children,
}: {
  icon: ReactNode
  title: string
  children?: ReactNode
}) {
  return (
    <div className="empty">
      <span className="empty-icon">{icon}</span>
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  )
}
