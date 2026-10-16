import { useEffect, useRef, useSyncExternalStore } from 'react'

export const shortcutActions = {
  sidebar: { label: 'Mostrar ou ocultar canais', detail: 'Abre ou recolhe a barra lateral principal.' },
  members: { label: 'Mostrar ou ocultar membros', detail: 'Disponível dentro de um servidor.' },
  soundboard: { label: 'Mostrar ou ocultar painel de sons', detail: 'Disponível na sala de voz.' },
  audioSettings: { label: 'Abrir configurações de áudio', detail: 'Acesse os dispositivos e ajustes de voz.' },
  microphone: { label: 'Ligar ou desligar microfone', detail: 'Durante uma chamada conectada.' },
  camera: { label: 'Ligar ou desligar câmera', detail: 'Durante uma chamada conectada.' },
  settings: { label: 'Abrir configurações', detail: 'Acesse suas preferências rapidamente.' },
}
export type ShortcutAction = keyof typeof shortcutActions
export type Bindings = Record<ShortcutAction, string | null>
export const defaultBindings: Bindings = { microphone: 'Alt+Shift+M', camera: 'Alt+Shift+C', settings: 'Alt+Shift+S', sidebar: null, members: null, soundboard: null, audioSettings: null }
const storageKey = 'orbita:shortcuts'

export function parseBindings(value: unknown): Bindings {
  const result = { ...defaultBindings }
  const used = new Set<string>()
  for (const action of Object.keys(result) as ShortcutAction[]) {
    const v = value && typeof value === 'object' ? (value as Record<string, unknown>)[action] : undefined
    if (v === null || (typeof v === 'string' && /^(?:(?:Ctrl|Alt|Shift|Meta)\+)+[A-Z0-9]$/.test(v))) result[action] = v
    const binding = result[action]
    if (binding && used.has(binding)) result[action] = null
    else if (binding) used.add(binding)
  }
  return result
}
let bindings = { ...defaultBindings }
try { bindings = parseBindings(JSON.parse(localStorage.getItem(storageKey) || '{}')) } catch { /* Defaults remain available. */ }
const listeners = new Set<() => void>()
export function saveBindings(next: Bindings) {
  bindings = parseBindings(next)
  try { localStorage.setItem(storageKey, JSON.stringify(bindings)) } catch { /* Keep session preferences. */ }
  listeners.forEach((listener) => listener())
}
export function useBindings() {
  return useSyncExternalStore((listener) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }, () => bindings)
}
export function keyboardBinding(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>) {
  if (!(event.ctrlKey || event.altKey || event.metaKey) || !/^[a-z0-9]$/i.test(event.key)) return null
  return [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Meta', event.key.toUpperCase()].filter(Boolean).join('+')
}
export function useShortcut(action: ShortcutAction, callback: () => void) {
  const handler = useRef(callback)
  handler.current = callback
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing || event.getModifierState('AltGraph')) return
      if (document.querySelector('dialog[open]')) return
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return
      if (!bindings[action] || keyboardBinding(event) !== bindings[action]) return
      event.preventDefault()
      handler.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [action])
}
