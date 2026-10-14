import { useState } from 'react'
import { Check, Mail, X } from 'lucide-react'
import type { CommunityInvite, Profile } from '../lib/types'
import { check, db, errorText } from '../lib/supabase'
import { Avatar, Empty, Modal } from './ui'

export function InviteInbox({
  invites,
  profiles,
  close,
  refresh,
  report,
  enter,
}: {
  invites: CommunityInvite[]
  profiles: Profile[]
  close: () => void
  refresh: () => Promise<void>
  report: (s: string) => void
  enter: (server: string, channel: string | null) => void
}) {
  const [busy, setBusy] = useState(false)
  async function respond(invite: CommunityInvite, accept: boolean) {
    setBusy(true)
    try {
      check(await db().rpc('respond_invite', { invite_id: invite.id, accept }))
      await refresh()
      if (accept) {
        enter(invite.server_id, invite.channel_id)
        close()
      }
    } catch (e) {
      report(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title="Seus convites" close={close}>
      <div className="invite-inbox">
        <p className="muted">
          Você decide onde participar. Aceitar um canal também inclui você no servidor indicado.
        </p>
        {!invites.length && (
          <Empty icon={<Mail />} title="Nenhum convite pendente">
            Seus próximos encontros aparecerão aqui.
          </Empty>
        )}
        {invites.map((invite) => {
          const person = profiles.find((p) => p.id === invite.inviter_id)
          const expired = Date.parse(invite.expires_at) <= Date.now()
          return (
            <article className="inbox-card" key={invite.id}>
              <Avatar profile={person} small />
              <div>
                <small>{person?.display_name || 'Um membro'} convidou você</small>
                <h3>{invite.channel_name ? `#${invite.channel_name}` : invite.server_name}</h3>
                <p>
                  {invite.channel_name ? invite.server_name : 'Comunidade'} ·{' '}
                  {expired ? 'Expirado' : 'Aguardando sua decisão'}
                </p>
                <div className="dialog-actions">
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void respond(invite, false)}
                  >
                    <X size={16} />
                    Recusar
                  </button>
                  <button
                    className="primary"
                    disabled={busy || expired}
                    onClick={() => void respond(invite, true)}
                  >
                    <Check size={16} />
                    Aceitar convite
                  </button>
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </Modal>
  )
}
