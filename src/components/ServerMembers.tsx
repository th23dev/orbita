import { useEffect, useState } from 'react'
import { Check, Copy, Link, Search, Share2, Trash2, UserPlus } from 'lucide-react'
import { check, db, errorText } from '../lib/supabase'
import { invitationLink } from '../lib/invitations'
import type { Profile, Server } from '../lib/types'
import { Avatar, IconButton } from './ui'

type Invitation = { id: string; code: string; uses: number; max_uses: number; expires_at: string }

export function ServerMembers({
  server,
  people,
  refresh,
  report,
  canCreateLinks = true,
}: {
  server: Server
  people: Profile[]
  refresh: () => Promise<void>
  report: (message: string) => void
  canCreateLinks?: boolean
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Profile[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [invites, setInvites] = useState<Invitation[]>([])
  const [loading, setLoading] = useState(true)
  const load = async () =>
    setInvites(
      check(
        await db()
          .from('invitations')
          .select('id,code,uses,max_uses,expires_at')
          .eq('server_id', server.id)
          .order('expires_at', { ascending: false }),
      ),
    )
  useEffect(() => {
    void load()
      .catch((e) => report(errorText(e)))
      .finally(() => setLoading(false))
  }, [server.id])
  useEffect(() => {
    let active = true
    setResults([])
    setSearchError('')
    const term = query.trim().replace(/^@/, '')
    if (term.length < 2) {
      setSearching(false)
      return
    }
    setSearching(true)
    const timer = setTimeout(async () => {
      try {
        const pattern = `%${term.replace(/[\\%_]/g, '\\$&')}%`
        const responses = await Promise.all([
          db()
            .from('profiles')
            .select('*')
            .ilike('display_name', pattern)
            .order('display_name')
            .limit(12),
          db().from('profiles').select('*').ilike('username', pattern).order('username').limit(12),
        ])
        const profiles = [
          ...new Map(
            responses.flatMap((response) => check(response) as Profile[]).map((p) => [p.id, p]),
          ).values(),
        ]
        if (active) setResults(profiles.slice(0, 12))
      } catch (error) {
        if (active) setSearchError(errorText(error))
      } finally {
        if (active) setSearching(false)
      }
    }, 300)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [query])
  async function run(action: () => Promise<void>) {
    setBusy(true)
    setNotice('')
    try {
      await action()
      await load()
      await refresh()
    } catch (error) {
      report(errorText(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="server-members-manager">
      <section>
        <h3>
          <UserPlus size={18} /> Convidar por nome
        </h3>
        <p className="muted">
          Encontre uma pessoa pelo nome ou @usuário. Ela precisa aceitar o convite antes de entrar.
        </p>
        <label className="member-search">
          <Search size={18} />
          <input
            aria-label="Buscar pessoas para o servidor"
            placeholder="Nome ou @usuário"
            value={query}
            maxLength={64}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="member-search-results" aria-live="polite" aria-busy={searching}>
          {searching ? (
            <p className="muted">Buscando pessoas…</p>
          ) : searchError ? (
            <p role="alert">{searchError}</p>
          ) : query.trim().replace(/^@/, '').length < 2 ? (
            <p className="muted">Digite pelo menos 2 caracteres.</p>
          ) : !results.length ? (
            <p className="muted">Nenhuma pessoa encontrada. Tente o @usuário.</p>
          ) : (
            results.map((person) => {
              const member = people.some((p) => p.id === person.id)
              return (
                <div className="member-search-result" key={person.id}>
                  <Avatar profile={person} small />
                  <div>
                    <strong>{person.display_name}</strong>
                    <small>@{person.username}</small>
                  </div>
                  <button
                    className="secondary"
                    disabled={busy || member}
                    aria-label={
                      member
                        ? `${person.display_name} já é membro`
                        : `Convidar ${person.display_name} ao servidor`
                    }
                    onClick={() =>
                      void run(async () => {
                        check(
                          await db().rpc('invite_member', { s: server.id, target_user: person.id }),
                        )
                        setNotice(
                          `Convite enviado para ${person.display_name}. Aguardando aceitação.`,
                        )
                      })
                    }
                  >
                    {member ? (
                      <>
                        <Check size={16} /> Membro
                      </>
                    ) : (
                      <>
                        <UserPlus size={16} /> Convidar
                      </>
                    )}
                  </button>
                </div>
              )
            })
          )}
        </div>
      </section>
      {canCreateLinks && (
        <section>
          <h3>
            <Link size={18} /> Convidar por link
          </h3>
          <p className="muted">
            Compartilhe um link por onde preferir. Cada convite vale por 7 dias e permite 25
            entradas.
          </p>
          <button
            className="primary"
            disabled={busy || loading}
            onClick={() =>
              void run(async () => {
                check(
                  await db()
                    .from('invitations')
                    .insert({ server_id: server.id, created_by: server.owner_id }),
                )
                setNotice('Link criado. Copie ou compartilhe abaixo.')
              })
            }
          >
            <Link size={17} /> Criar link de convite
          </button>
          <div className="invitation-list">
            {invites.map((invite) => {
              const expired =
                Date.parse(invite.expires_at) <= Date.now() || invite.uses >= invite.max_uses
              const url = invitationLink(invite.code)
              return (
                <div className={`invitation-card ${expired ? 'expired' : ''}`} key={invite.id}>
                  <input
                    readOnly
                    aria-label="Link de convite"
                    value={url}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <div className="invitation-actions">
                    <small>
                      {expired
                        ? 'Convite encerrado'
                        : `${invite.uses}/${invite.max_uses} entradas · até ${new Date(invite.expires_at).toLocaleDateString('pt-BR')}`}
                    </small>
                    <IconButton
                      label="Copiar link de convite"
                      disabled={expired || busy}
                      onClick={() =>
                        void run(async () => {
                          await navigator.clipboard.writeText(url)
                          setNotice('Link copiado!')
                        })
                      }
                    >
                      <Copy size={18} />
                    </IconButton>
                    {typeof navigator.share === 'function' && (
                      <IconButton
                        label="Compartilhar convite"
                        disabled={expired || busy}
                        onClick={() =>
                          void run(async () => {
                            try {
                              await navigator.share({
                                title: `Entre em ${server.name}`,
                                text: 'Vamos conversar na Órbita?',
                                url,
                              })
                            } catch (error) {
                              if (!(error instanceof DOMException && error.name === 'AbortError'))
                                throw error
                            }
                          })
                        }
                      >
                        <Share2 size={18} />
                      </IconButton>
                    )}
                    <IconButton
                      label="Revogar convite"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          check(await db().from('invitations').delete().eq('id', invite.id))
                          setNotice('Convite revogado.')
                        })
                      }
                    >
                      <Trash2 size={18} />
                    </IconButton>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}
      {notice && (
        <p className="member-notice" role="status">
          <Check size={16} />
          {notice}
        </p>
      )}
    </div>
  )
}
