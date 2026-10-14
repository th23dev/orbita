import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { MessageCircle, ShieldQuestion } from 'lucide-react'
import { Modal } from './ui'

type Request = {
  title: string
  message?: string
  value?: string
  confirm?: string
  danger?: boolean
}
type Dialogs = {
  confirm: (request: Request) => Promise<boolean>
  prompt: (request: Request) => Promise<string | null>
}
const Context = createContext<Dialogs | null>(null)
export function useDialogs() {
  const dialogs = useContext(Context)
  if (!dialogs) throw new Error('DialogsProvider ausente')
  return dialogs
}
export function DialogsProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<(Request & { input: boolean }) | null>(null)
  const [value, setValue] = useState('')
  const resolve = useRef<((value: string | boolean | null) => void) | null>(null)
  const finish = (result: string | boolean | null) => {
    resolve.current?.(result)
    resolve.current = null
    setRequest(null)
  }
  useEffect(() => () => resolve.current?.(null), [])
  const ask = (options: Request, input: boolean) =>
    new Promise<string | boolean | null>((done) => {
      resolve.current?.(null)
      resolve.current = done
      setValue(options.value || '')
      setRequest({ ...options, input })
    })
  return (
    <Context.Provider
      value={{
        confirm: async (options) => (await ask(options, false)) === true,
        prompt: async (options) => {
          const result = await ask(options, true)
          return typeof result === 'string' ? result : null
        },
      }}
    >
      {children}
      {request && (
        <Modal title={request.title} close={() => finish(null)}>
          <form
            className="decision-dialog"
            onSubmit={(event) => {
              event.preventDefault()
              finish(request.input ? value.trim() : true)
            }}
          >
            <span className={`decision-icon ${request.danger ? 'danger' : ''}`}>
              {request.input ? <MessageCircle /> : <ShieldQuestion />}
            </span>
            {request.message && <p>{request.message}</p>}
            {request.input && (
              <label>
                Novo nome
                <input
                  autoFocus
                  required
                  maxLength={64}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              </label>
            )}
            <footer className="dialog-actions">
              <button type="button" className="secondary" onClick={() => finish(null)}>
                Cancelar
              </button>
              <button
                autoFocus={!request.input}
                className={request.danger ? 'danger-button' : 'primary'}
                disabled={request.input && !value.trim()}
              >
                {request.confirm || (request.input ? 'Salvar' : 'Confirmar')}
              </button>
            </footer>
          </form>
        </Modal>
      )}
    </Context.Provider>
  )
}
