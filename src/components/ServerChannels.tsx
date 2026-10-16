import { useState } from 'react'
import { ChevronRight, Hash, Headphones, LockKeyhole, Search, Users, X } from 'lucide-react'
import type { Channel } from '../lib/types'

export function ServerChannels({
  channels,
  manage,
}: {
  channels: Channel[]
  manage: (channel: Channel) => void
}) {
  const [query, setQuery] = useState('')
  const active = channels.filter((channel) => !channel.archived)
  const privateCount = active.filter((channel) => channel.is_private).length
  const normalize = (value: string) =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('pt-BR')
  const term = normalize(query.trim())
  const visible = active.filter((channel) =>
    normalize(`${channel.name} ${channel.topic}`).includes(term),
  )

  return (
    <div className="server-channels">
      <div className="server-channels-summary" aria-label="Resumo dos canais">
        <span>
          <strong>{active.length}</strong> {active.length === 1 ? 'canal' : 'canais'}
        </span>
        <span>
          <Users size={14} />
          {active.length - privateCount} públicos
        </span>
        <span>
          <LockKeyhole size={14} />
          {privateCount} privados
        </span>
      </div>
      <div className="server-channels-search">
        <Search size={18} aria-hidden="true" />
        <input
          aria-label="Buscar canais do servidor"
          placeholder="Buscar canal por nome ou descrição"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query && (
          <button type="button" aria-label="Limpar busca de canais" onClick={() => setQuery('')}>
            <X size={16} />
          </button>
        )}
      </div>
      {(['text', 'voice'] as const).map((kind) => {
        const group = visible.filter((channel) => channel.kind === kind)
        const Icon = kind === 'text' ? Hash : Headphones
        if (!group.length) return null
        return (
          <section
            className="server-channel-group"
            key={kind}
            aria-label={kind === 'text' ? 'Canais de texto' : 'Canais de voz'}
          >
            <div className="server-channel-group-heading">
              <h3>{kind === 'text' ? 'Canais de texto' : 'Canais de voz'}</h3>
              <span>{group.length}</span>
            </div>
            <div className="server-channel-list">
              {group.map((channel) => (
                <button
                  type="button"
                  className="server-channel-card"
                  key={channel.id}
                  aria-label={`Configurações de ${channel.name}`}
                  onClick={() => manage(channel)}
                >
                  <span className={`server-channel-kind ${kind}`}>
                    <Icon size={21} />
                  </span>
                  <span className="server-channel-details">
                    <strong>{channel.name}</strong>
                    <small>
                      {channel.topic ||
                        (kind === 'text'
                          ? 'Mensagens e conversas da comunidade'
                          : 'Converse por voz e compartilhe sua tela')}
                    </small>
                  </span>
                  <span className={`server-channel-access ${channel.is_private ? 'private' : ''}`}>
                    {channel.is_private ? <LockKeyhole size={13} /> : <Users size={13} />}
                    {channel.is_private ? 'Privado' : 'Público'}
                  </span>
                  <ChevronRight className="server-channel-arrow" size={18} aria-hidden="true" />
                </button>
              ))}
            </div>
          </section>
        )
      })}
      {!visible.length && (
        <div className="server-channels-empty" role="status">
          {term ? <Search size={28} /> : <Hash size={28} />}
          <strong>{term ? 'Nenhum canal encontrado' : 'Seu servidor ainda não tem canais'}</strong>
          <p>
            {term
              ? 'Tente outro nome ou uma palavra da descrição.'
              : 'Use o botão de criar canal na barra lateral para começar.'}
          </p>
          {term && (
            <button className="secondary" onClick={() => setQuery('')}>
              Limpar busca
            </button>
          )}
        </div>
      )}
      <div className="server-channels-note">
        <LockKeyhole size={17} aria-hidden="true" />
        <p>
          Selecione um canal para editar suas informações, ajustar a privacidade e gerenciar
          participantes.
        </p>
      </div>
    </div>
  )
}
