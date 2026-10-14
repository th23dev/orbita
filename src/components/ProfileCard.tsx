import { MessageCircle } from 'lucide-react'
import type { Profile } from '../lib/types'
import { Avatar, Modal } from './ui'

export const statusLabel = {
  online: 'Disponível',
  away: 'Ausente',
  busy: 'Ocupado',
  offline: 'Offline',
}
export function ProfileCard({
  profile,
  close,
  message,
}: {
  profile: Profile
  close: () => void
  message?: () => void
}) {
  return (
    <Modal title="Perfil" close={close}>
      <div className="profile-card">
        <div className="profile-banner" />
        <Avatar profile={profile} online={profile.status !== 'offline'} />
        <h2>{profile.display_name}</h2>
        <p className="muted">@{profile.username}</p>
        <span className={`profile-status ${profile.status}`}>
          <i />
          {statusLabel[profile.status]}
        </span>
        <section>
          <h3>Sobre mim</h3>
          <p>{profile.bio || 'Esta pessoa ainda não escreveu uma bio.'}</p>
        </section>
        {message && (
          <button className="primary" onClick={message}>
            <MessageCircle size={18} /> Enviar mensagem
          </button>
        )}
      </div>
    </Modal>
  )
}
