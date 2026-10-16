import { useEffect, useState } from 'react'
import { Keyboard, RotateCcw, X } from 'lucide-react'
import { defaultBindings, keyboardBinding, saveBindings, shortcutActions, useBindings } from '../lib/shortcuts'
import type { ShortcutAction } from '../lib/shortcuts'

export function ShortcutSettings() {
  const bindings = useBindings()
  const [recording, setRecording] = useState<ShortcutAction | null>(null)
  const [message, setMessage] = useState('')
  useEffect(() => {
    if (!recording) return
    const record = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.key === 'Escape') { setRecording(null); setMessage('Gravação cancelada.'); return }
      if (event.repeat || event.isComposing || event.getModifierState('AltGraph')) return
      const binding = keyboardBinding(event)
      if (!binding) return
      if (Object.entries(bindings).some(([action, value]) => action !== recording && value === binding)) {
        setMessage('Essa combinação já está em uso. Escolha outra.'); return
      }
      saveBindings({ ...bindings, [recording]: binding })
      setRecording(null)
      setMessage('Atalho salvo.')
    }
    const cancel = () => setRecording(null)
    window.addEventListener('keydown', record, true)
    window.addEventListener('blur', cancel)
    return () => { window.removeEventListener('keydown', record, true); window.removeEventListener('blur', cancel) }
  }, [recording, bindings])
  return <section className="shortcut-settings">
    <h2>Atalhos de teclado</h2>
    <p className="muted">Controle a chamada e navegue com combinações de teclas.</p>
    <div className="shortcut-notice"><Keyboard size={20} /><span>Funcionam com esta aba em foco, fora dos campos de texto e dos menus de configuração. Alguns atalhos podem ser reservados pelo navegador ou sistema.</span></div>
    <div className="shortcut-list">
      {(Object.keys(shortcutActions) as ShortcutAction[]).map(action => <div className="shortcut-row" key={action}>
        <div><strong>{shortcutActions[action].label}</strong><small>{shortcutActions[action].detail}</small></div>
        <div className="shortcut-controls">
          <button className={`shortcut-binding ${recording === action ? 'recording' : ''}`} aria-label={`Configurar atalho: ${shortcutActions[action].label}`} aria-pressed={recording === action} onClick={() => { setRecording(recording === action ? null : action); setMessage('') }}>
            {recording === action ? 'Pressione as teclas…' : bindings[action] ? bindings[action]!.split('+').map((key, i) => <kbd key={i}>{key}</kbd>) : 'Definir atalho'}
          </button>
          <button className="icon-button" aria-label={`Remover atalho: ${shortcutActions[action].label}`} disabled={!bindings[action]} onClick={() => { setRecording(null); saveBindings({ ...bindings, [action]: null }); setMessage('Atalho removido.') }}><X size={16} /></button>
        </div>
      </div>)}
    </div>
    <p className="muted">Use Ctrl, Alt ou ⌘ junto de uma letra ou número. Shift é opcional. Esc cancela a gravação.</p>
    <p role="status" className="shortcut-feedback">{message || (recording ? 'Aguardando uma combinação de teclas…' : 'Salvo automaticamente neste navegador.')}</p>
    <button className="shortcut-reset" onClick={() => { setRecording(null); saveBindings({ ...defaultBindings }); setMessage('Atalhos padrão restaurados.') }}><RotateCcw size={16} /> Restaurar padrões</button>
  </section>
}
