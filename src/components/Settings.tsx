import { useState } from 'react'
import { Camera, LogOut, Moon, Sun } from 'lucide-react'
import { check, db, errorText } from '../lib/supabase'
import { upload, validateFile } from '../lib/files'
import type { Profile, Settings as Preferences } from '../lib/types'
import { Avatar, Modal } from './ui'

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
    <Modal title="Seu espaço, seu jeito" close={close}>
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
          <input required maxLength={64} value={name} onChange={(e) => setName(e.target.value)} />
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
            Letras minúsculas, números e sublinhado. Seus amigos encontram você por este nome.
          </small>
        </label>
        <label>
          Sobre você
          <textarea maxLength={500} rows={3} value={bio} onChange={(e) => setBio(e.target.value)} />
        </label>
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value as Profile['status'])}>
            <option value="online">Online</option>
            <option value="busy">Ocupado</option>
            <option value="away">Ausente</option>
            <option value="offline">Invisível</option>
          </select>
        </label>
        <div className="preference-row">
          <span>{settings.theme === 'dark' ? <Moon size={18} /> : <Sun size={18} />}Aparência</span>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                check(
                  await db()
                    .from('user_settings')
                    .update({ theme: settings.theme === 'dark' ? 'light' : 'dark' })
                    .eq('user_id', me.id),
                )
              })
            }
          >
            {settings.theme === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'}
          </button>
        </div>
        <button className="primary" disabled={busy}>
          {busy ? 'Salvando…' : 'Salvar perfil'}
        </button>
        <button
          type="button"
          className="text-button danger-text"
          onClick={() =>
            void run(async () => {
              check(await db().auth.signOut())
            })
          }
        >
          <LogOut size={16} />
          Sair da conta
        </button>
      </form>
    </Modal>
  )
}
