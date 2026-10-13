import { useState } from 'react'
import type { FormEvent } from 'react'
import {
  ArrowRight,
  AudioLines,
  Check,
  MessageCircle,
  MonitorUp,
  Orbit,
  ShieldCheck,
} from 'lucide-react'
import { check, configured, db, errorText, redirectUrl } from '../lib/supabase'
import { Logo } from './ui'

export function Auth({
  recovery = false,
  recovered,
}: {
  recovery?: boolean
  recovered: () => void
}) {
  const [mode, setMode] = useState<'login' | 'signup' | 'reset'>('login')
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [name, setName] = useState('')
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(''),
    [error, setError] = useState('')
  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      if (recovery) {
        check(await db().auth.updateUser({ password }))
        recovered()
      } else if (mode === 'login') check(await db().auth.signInWithPassword({ email, password }))
      else if (mode === 'signup') {
        check(
          await db().auth.signUp({
            email,
            password,
            options: { data: { display_name: name }, emailRedirectTo: redirectUrl() },
          }),
        )
        setNotice('Confira seu e-mail para confirmar o cadastro. Abra o link neste navegador.')
      } else {
        check(await db().auth.resetPasswordForEmail(email, { redirectTo: redirectUrl() }))
        setNotice('Se o e-mail estiver cadastrado, você receberá um link. Abra-o neste navegador.')
      }
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="auth-page">
      <section className="auth-story">
        <Logo />
        <div className="story-content">
          <span className="eyebrow">
            <span className="pulse" /> CONEXÕES QUE ACONTECEM
          </span>
          <h1>
            Perto, mesmo
            <br />
            de <span>longe.</span>
          </h1>
          <p>
            Um lugar para suas pessoas.
            <br />
            Conversas, ideias e momentos na mesma órbita.
          </p>
          <div className="orbit-art" aria-hidden="true">
            <div className="orbit-ring one" />
            <div className="orbit-ring two" />
            <div className="planet">
              <Orbit size={68} strokeWidth={1.2} />
            </div>
            <span className="satellite sat-one">
              <AudioLines />
            </span>
            <span className="satellite sat-two">
              <MessageCircle />
            </span>
            <span className="satellite sat-three">
              <MonitorUp />
            </span>
            <span className="star star-one">✦</span>
            <span className="star star-two">✧</span>
          </div>
          <div className="story-tags">
            <span>
              <Check size={14} /> Sua comunidade
            </span>
            <span>
              <Check size={14} /> Voz e tela
            </span>
            <span>
              <Check size={14} /> Em tempo real
            </span>
          </div>
        </div>
        <footer>
          MENOS DISTÂNCIA. MAIS CONEXÃO.<span>© {new Date().getFullYear()} Órbita</span>
        </footer>
      </section>
      <section className="auth-form-panel">
        <div className="auth-mobile-logo">
          <Logo />
        </div>
        <div className="auth-form-wrap">
          <span className="eyebrow">SEU PRÓXIMO PONTO DE ENCONTRO</span>
          <h2>
            {recovery
              ? 'Uma nova senha.'
              : mode === 'signup'
                ? 'Entre na nossa órbita.'
                : mode === 'reset'
                  ? 'Vamos recuperar o acesso.'
                  : 'Bom ter você por aqui.'}
          </h2>
          <p className="muted">
            {recovery
              ? 'Escolha uma senha com pelo menos 10 caracteres.'
              : mode === 'signup'
                ? 'Crie sua conta e comece uma boa conversa.'
                : mode === 'reset'
                  ? 'Enviaremos um link de recuperação para seu e-mail.'
                  : 'Entre na sua conta. Sua comunidade está logo ali.'}
          </p>
          {!configured && (
            <div className="setup-note" role="status">
              <ShieldCheck size={20} />
              <div>
                <strong>A conexão ainda não foi configurada</strong>
                <p>
                  Defina a URL e a chave pública do Supabase no arquivo .env.local e aplique a
                  migration. O guia de instalação está no README do projeto.
                </p>
              </div>
            </div>
          )}
          <form onSubmit={submit}>
            {mode === 'signup' && !recovery && (
              <label>
                Como podemos chamar você?
                <input
                  autoComplete="name"
                  required
                  maxLength={64}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Seu nome"
                />
              </label>
            )}
            {!recovery && (
              <label>
                E-mail
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="voce@exemplo.com"
                />
              </label>
            )}
            {(mode !== 'reset' || recovery) && (
              <label>
                Senha
                <input
                  type="password"
                  autoComplete={recovery || mode === 'signup' ? 'new-password' : 'current-password'}
                  required
                  minLength={mode === 'signup' || recovery ? 10 : 1}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Sua senha"
                />
              </label>
            )}
            {mode === 'login' && !recovery && (
              <button
                type="button"
                className="text-button forgot"
                onClick={() => {
                  setMode('reset')
                  setError('')
                  setNotice('')
                }}
              >
                Esqueceu a senha?
              </button>
            )}
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            {notice && (
              <div className="success" role="status">
                {notice}
              </div>
            )}
            <button className="primary auth-submit" disabled={!configured || busy}>
              {busy
                ? 'Só um instante…'
                : recovery
                  ? 'Salvar nova senha'
                  : mode === 'signup'
                    ? 'Criar minha conta'
                    : mode === 'reset'
                      ? 'Enviar link de recuperação'
                      : 'Entrar na Órbita'}
              <ArrowRight size={18} />
            </button>
          </form>
          {!recovery && (
            <p className="auth-switch">
              {mode === 'signup'
                ? 'Já tem uma conta?'
                : mode === 'reset'
                  ? 'Lembrou a senha?'
                  : 'Primeira vez por aqui?'}{' '}
              <button
                className="text-button"
                onClick={() => {
                  setMode(mode === 'login' ? 'signup' : 'login')
                  setError('')
                  setNotice('')
                }}
              >
                {mode === 'login' ? 'Crie sua conta' : 'Entre aqui'}
              </button>
            </p>
          )}
          <div className="auth-divider" />
          <p className="auth-bottom">
            <ShieldCheck size={15} /> Um espaço seu, feito para compartilhar.
          </p>
        </div>
        <span className="auth-version">ÓRBITA / 01</span>
      </section>
    </main>
  )
}
