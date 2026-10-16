import { useState } from 'react'
import {
  Camera,
  Headphones,
  LogOut,
  Moon,
  Sun,
  UserRound,
  Palette,
  Check,
  Video,
} from 'lucide-react'
import { check, db, errorText } from '../lib/supabase'
import { upload, validateFile } from '../lib/files'
import type { Profile, Settings as Preferences } from '../lib/types'
import { Avatar, Modal } from './ui'
import { AudioSettingsContent } from './AudioSettings'
import { VideoSettings } from './VideoSettings'

const sections = {
  profile: { label: 'Meu perfil', icon: UserRound },
  audio: { label: 'Voz e áudio', icon: Headphones },
  video: { label: 'Vídeo', icon: Video },
  appearance: { label: 'Aparência', icon: Palette },
}

export function Settings({
  me,
  settings,
  close,
  refresh,
  report,
}: {
  me: Profile
  settings: Preferences
  close: () => void
  refresh: () => Promise<void>
  report: (s: string) => void
}) {
  const [section, setSection] = useState<keyof typeof sections>('profile')
  const [name, setName] = useState(me.display_name),
    [username, setUsername] = useState(me.username),
    [bio, setBio] = useState(me.bio),
    [status, setStatus] = useState(me.status),
    [busy, setBusy] = useState(false)
  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    try {
      await action()
      await refresh()
    } catch (e) {
      report(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={sections[section].label} close={close} className="user-settings-modal">
      <aside className="user-settings-sidebar">
        <button className="user-settings-identity" onClick={() => setSection('profile')}>
          <Avatar profile={me} />
          <span>
            <strong>{me.display_name}</strong>
            <small>Editar perfil</small>
          </span>
        </button>
        <nav aria-label="Categorias de configurações">
          <div className="user-settings-nav-group">
            <span className="user-settings-nav-label">Conta</span>
            <button
              aria-current={section === 'profile' ? 'page' : undefined}
              onClick={() => setSection('profile')}
            >
              <UserRound size={18} /> Meu perfil
            </button>
          </div>
          <div className="user-settings-nav-group">
            <span className="user-settings-nav-label">Experiência</span>
            {(['audio', 'video', 'appearance'] as const).map((key) => {
              const Icon = sections[key].icon
              return (
                <button
                  key={key}
                  aria-current={section === key ? 'page' : undefined}
                  onClick={() => setSection(key)}
                >
                  <Icon size={18} /> {sections[key].label}
                </button>
              )
            })}
          </div>
          <div className="user-settings-nav-group user-settings-session">
            <button
              className="danger-text"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  check(await db().auth.signOut())
                })
              }
            >
              <LogOut size={18} /> Sair da conta
            </button>
          </div>
        </nav>
      </aside>
      <div className="user-settings-content" key={section}>
        <div className="user-settings-page">
          {section === 'profile' && (
            <>
              <div className="user-settings-intro">
                <h2>Informações do perfil</h2>
                <p>É assim que você aparece para as pessoas na Órbita.</p>
              </div>
              <form
                className="settings-form"
                onSubmit={(e) => {
                  e.preventDefault()
                  void run(async () => {
                    check(
                      await db()
                        .from('profiles')
                        .update({
                          display_name: name.trim(),
                          username: username.toLowerCase(),
                          bio,
                          status,
                        })
                        .eq('id', me.id),
                    )
                    close()
                  })
                }}
              >
                <div className="profile-header">
                  <Avatar profile={me} online />
                  <label className="secondary upload-label">
                    <Camera size={17} />
                    Alterar foto
                    <input
                      type="file"
                      hidden
                      accept="image/jpeg,image/png,image/webp"
                      disabled={busy}
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        e.target.value = ''
                        if (file)
                          void run(async () => {
                            validateFile(file, 'avatar')
                            const path = `${me.id}/${crypto.randomUUID()}`
                            await upload('avatars', path, file, () => {})
                            const result = await db()
                              .from('profiles')
                              .update({ avatar_path: path })
                              .eq('id', me.id)
                            if (result.error) {
                              await db().storage.from('avatars').remove([path])
                              check(result)
                            }
                            if (me.avatar_path)
                              check(await db().storage.from('avatars').remove([me.avatar_path]))
                          })
                      }}
                    />
                  </label>
                  <small>JPG, PNG ou WebP · até 2 MB</small>
                </div>
                <label>
                  Nome de exibição
                  <input
                    required
                    maxLength={64}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <label>
                  Nome de usuário
                  <input
                    required
                    pattern="[a-z0-9_]{3,32}"
                    minLength={3}
                    maxLength={32}
                    value={username}
                    onChange={(e) => setUsername(e.target.value.toLowerCase())}
                  />
                  <small>
                    Letras minúsculas, números e sublinhado. Seus amigos encontram você por este
                    nome.
                  </small>
                </label>
                <label>
                  Sobre você
                  <textarea
                    maxLength={500}
                    rows={3}
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                  />
                </label>
                <label>
                  Status
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as Profile['status'])}
                  >
                    <option value="online">Online</option>
                    <option value="busy">Ocupado</option>
                    <option value="away">Ausente</option>
                    <option value="offline">Invisível</option>
                  </select>
                </label>
                <div className="user-settings-save">
                  <button className="primary" disabled={busy}>
                    {busy ? 'Salvando…' : 'Salvar perfil'}
                  </button>
                </div>
              </form>
            </>
          )}
          {section === 'audio' && <AudioSettingsContent />}
          {section === 'video' && <VideoSettings />}
          {section === 'appearance' && (
            <>
              <div className="user-settings-intro">
                <h2>Aparência</h2>
                <p>Escolha o tema que combina com o seu espaço.</p>
              </div>
              <section className="user-settings-theme" aria-label="Tema da interface">
                <h3>Tema da interface</h3>
                <div className="user-settings-themes">
                  {(['dark', 'light'] as const).map((theme) => (
                    <button
                      key={theme}
                      className={`user-settings-theme-card ${theme}`}
                      aria-pressed={settings.theme === theme}
                      aria-label={theme === 'dark' ? 'Usar tema escuro' : 'Usar tema claro'}
                      disabled={busy}
                      onClick={() => {
                        if (settings.theme === theme) return
                        void run(async () => {
                          check(
                            await db().from('user_settings').update({ theme }).eq('user_id', me.id),
                          )
                        })
                      }}
                    >
                      <span className="user-settings-theme-preview" aria-hidden="true">
                        <i />
                        <span>
                          <i />
                          <i />
                          <i />
                        </span>
                      </span>
                      <span className="user-settings-theme-caption">
                        {theme === 'dark' ? <Moon size={17} /> : <Sun size={17} />}
                        {theme === 'dark' ? 'Escuro' : 'Claro'}
                        {settings.theme === theme && <Check size={17} />}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
