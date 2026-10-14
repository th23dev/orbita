import { useState } from 'react'
import { Search } from 'lucide-react'
import type { Profile } from '../lib/types'
import { Avatar } from './ui'

export function FriendPicker({
  people,
  selected,
  change,
}: {
  people: Profile[]
  selected: string[]
  change: (ids: string[]) => void
}) {
  const [query, setQuery] = useState('')
  const matches = people.filter((p) =>
    `${p.display_name} ${p.username}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  )
  return (
    <section className="friend-picker">
      <h3>
        Convidar amigos <small>{selected.length} selecionados</small>
      </h3>
      <p className="muted">Cada pessoa recebe um convite e escolhe se deseja entrar.</p>
      <label className="member-search">
        <Search size={17} />
        <input
          aria-label="Buscar na lista de amigos"
          placeholder="Buscar nome ou @usuário"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="friend-picker-list">
        {matches.map((p) => (
          <label className="picker-person" key={p.id}>
            <Avatar profile={p} small />
            <span>
              <strong>{p.display_name}</strong>
              <small>@{p.username}</small>
            </span>
            <input
              type="checkbox"
              aria-label={`Convidar ${p.display_name}`}
              checked={selected.includes(p.id)}
              onChange={(e) =>
                change(
                  e.target.checked ? [...selected, p.id] : selected.filter((id) => id !== p.id),
                )
              }
            />
          </label>
        ))}
        {!matches.length && (
          <p className="muted">
            {people.length
              ? 'Nenhum amigo encontrado.'
              : 'Adicione amigos para convidá-los por aqui.'}
          </p>
        )}
      </div>
    </section>
  )
}
