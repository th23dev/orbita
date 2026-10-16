import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronUp, Settings2, X } from 'lucide-react'

export function CallOptions({
  status,
  connected,
  children,
}: {
  status: string
  connected: boolean
  children: ReactNode
}) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const popover = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const position = () => {
    const bounds = trigger.current?.getBoundingClientRect()
    if (!bounds || !popover.current) return
    const width = Math.min(320, window.innerWidth - 32)
    Object.assign(popover.current.style, {
      left: `${Math.max(16, Math.min(bounds.x + bounds.width / 2 - width / 2, window.innerWidth - width - 16))}px`,
      bottom: `${window.innerHeight - bounds.top + 8}px`,
      maxHeight: `${Math.max(0, bounds.top - 24)}px`,
    })
  }
  useEffect(() => {
    if (!open) return
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    return () => {
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', position, true)
    }
  }, [open])

  return (
    <div className="call-footer-meta">
      <button
        ref={trigger}
        className="call-options-trigger"
        popoverTarget={id}
        aria-label={`Ajustes da chamada · ${status}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Ajustes da chamada"
      >
        <span className={`call-connection ${connected ? 'connected' : ''}`} role="status">
          <i aria-hidden="true" />
          {status}
        </span>
        <span className="call-options-trigger-icons" aria-hidden="true">
          <Settings2 size={14} />
          <ChevronUp size={12} />
        </span>
      </button>
      <div
        ref={popover}
        id={id}
        className="call-options-popover"
        popover="auto"
        role="dialog"
        aria-labelledby={`${id}-title`}
        onBeforeToggle={(event) => {
          if (event.newState === 'open') position()
        }}
        onToggle={(event) => setOpen(event.newState === 'open')}
      >
        <div className="call-options-heading">
          <h3 id={`${id}-title`}>Ajustes da chamada</h3>
          <button
            className="call-options-close"
            aria-label="Fechar ajustes da chamada"
            popoverTarget={id}
            popoverTargetAction="hide"
          >
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
