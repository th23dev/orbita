import { useEffect, useState } from 'react'
import { Copy, Plus, Search, Shield, Trash2, Users } from 'lucide-react'
import { check, db, errorText } from '../lib/supabase'
import type { Profile, Role } from '../lib/types'
import { Avatar } from './ui'
import { useDialogs } from './Dialogs'
import { defaultPermissions } from '../lib/permissions'
import { RolePermissions } from './RolePermissions'

const colors = ['#b7f36b', '#57f287', '#3ba5ff', '#5865f2', '#9b59b6', '#eb459e', '#ed4245', '#faa61a', '#fee75c', '#99aab5']
const emojis = ['👑', '🛡️', '⭐', '💎', '🎮', '🎨', '🎵', '🚀', '🔥', '🌱', '🤖', '💻']
const themes = [
  { name: '🛡️ Moderação', color: '#57f287', label: 'Moderação' },
  { name: '💎 VIP', color: '#9b59b6', label: 'VIP' },
  { name: '🎮 Jogadores', color: '#3ba5ff', label: 'Jogadores' },
  { name: '🎨 Criadores', color: '#eb459e', label: 'Criadores' },
  { name: '🌱 Novatos', color: '#b7f36b', label: 'Novatos' },
]
const withoutEmoji = (name: string) => {
  const prefix = emojis.find(emoji => name.startsWith(`${emoji} `))
  return prefix ? name.slice(prefix.length + 1) : name
}
const matches = (value: string, query: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().includes(query.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase())
export function ServerRoles({ serverId, people, refresh, canEdit }: { serverId: string; people: Profile[]; refresh: () => Promise<void>; canEdit: boolean }) {
  const dialogs = useDialogs()
  const [roles, setRoles] = useState<Role[]>([])
  const [assignments, setAssignments] = useState<{ role_id: string; user_id: string }[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, { name: string; color: string }>>({})
  const [tab, setTab] = useState<'appearance' | 'permissions' | 'members'>('appearance')
  const [query, setQuery] = useState('')
  const [memberQuery, setMemberQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [hex, setHex] = useState('')
  async function load() {
    const [r, a] = await Promise.all([db().from('roles').select('*').eq('server_id', serverId).order('name'), db().from('member_roles').select('role_id,user_id').eq('server_id', serverId)])
    setRoles(check(r) as Role[]); setAssignments(check(a))
  }
  useEffect(() => { void load().catch(e => setError(errorText(e))).finally(() => setLoading(false)) }, [serverId])
  async function run(action: () => Promise<void>) {
    if (busy || !canEdit) return
    setBusy(true); setError(''); setNotice('')
    try { await action(); await load(); await refresh() } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  const role = roles.find(r => r.id === selected) || roles[0]
  const draft = role && (drafts[role.id] || { name: role.name, color: role.color })
  const dirty = Boolean(role && draft && (draft.name !== role.name || draft.color !== role.color))
  useEffect(() => { setHex(draft?.color || '') }, [role?.id, draft?.color])
  const count = (id: string) => assignments.filter(a => a.role_id === id).length
  return <div className="roles-manager">
    <div className="roles-toolbar"><span><strong>{roles.length}</strong> {roles.length === 1 ? 'cargo' : 'cargos'} no servidor</span><button className="primary" disabled={busy || loading || !canEdit} onClick={() => void run(async () => {
      const created = check(await db().from('roles').insert({ server_id: serverId, name: 'Novo cargo', color: colors[0] }).select('*').single()) as Role
      setSelected(created.id); setQuery(''); setTab('appearance'); setNotice('Cargo criado. Personalize o nome e a cor.')
    })}><Plus size={16} /> Criar cargo</button></div>
    {!canEdit && <p className="muted">Somente o proprietário pode editar cargos e seus membros.</p>}
    {error && <p className="error" role="alert">{error}</p>}
    <p className="roles-notice" role="status">{loading ? 'Carregando cargos…' : notice}</p>
    {!loading && !roles.length ? <div className="roles-empty"><Shield size={36} /><h3>Organize sua comunidade</h3><p>Crie um cargo, escolha uma cor e adicione os membros.</p></div> : role && draft && <div className="roles-layout">
      <aside className="roles-list" aria-label="Lista de cargos">
        <label className="roles-search"><Search size={16} /><input aria-label="Buscar cargos" placeholder="Buscar cargos" value={query} onChange={e => setQuery(e.target.value)} /></label>
        {roles.filter(r => matches(r.name, query)).map(r => <button key={r.id} className="role-choice" aria-current={r.id === role.id ? 'true' : undefined} onClick={() => { setSelected(r.id); setMemberQuery(''); setNotice('') }}>
          <Shield size={17} style={{ color: r.color }} /><span>{r.name}{drafts[r.id] && (drafts[r.id].name !== r.name || drafts[r.id].color !== r.color) ? ' •' : ''}</span><small>{r.is_default ? 'Padrão · ' : ''}{count(r.id)}</small>
        </button>)}
        {!roles.some(r => matches(r.name, query)) && <p className="muted">Nenhum cargo encontrado.</p>}
      </aside>
      <div className="role-editor">
        <header><div><small>EDITAR CARGO</small><h3><Shield size={18} style={{ color: draft.color }} />{draft.name || 'Novo cargo'}</h3></div><div className="role-header-actions"><button className="icon-button" title="Duplicar aparência salva, sem membros ou acessos" aria-label={`Duplicar cargo ${role.name}`} disabled={busy || !canEdit} onClick={() => void run(async () => {
          const name = `${Array.from(role.name).slice(0, 24).join('')} (cópia)`
          const created = check(await db().from('roles').insert({ server_id: serverId, name, color: role.color }).select('*').single()) as Role
          setSelected(created.id); setQuery(''); setTab('appearance'); setNotice('Cargo duplicado com nome e cor salvos. Membros e acessos não foram copiados.')
        })}><Copy size={17} /></button><button className="icon-button danger-text" aria-label={`Excluir cargo ${role.name}`} disabled={busy || !canEdit} onClick={async () => {
          if (!await dialogs.confirm({ title: `Excluir cargo ${role.name}?`, message: 'O cargo será removido de todos os membros e deixará de conceder acesso aos canais associados. Esta ação não pode ser desfeita.', confirm: 'Excluir cargo', danger: true })) return
          void run(async () => { check(await db().from('roles').delete().eq('server_id', serverId).eq('id', role.id).select('id').single()); setSelected(null); setNotice('Cargo excluído.') })
        }}><Trash2 size={17} /></button></div></header>
        <nav className="role-tabs" aria-label="Edição do cargo"><button aria-pressed={tab === 'appearance'} onClick={() => setTab('appearance')}>Aparência</button><button aria-pressed={tab === 'permissions'} onClick={() => setTab('permissions')}>Permissões</button><button aria-pressed={tab === 'members'} onClick={() => setTab('members')}><Users size={15} /> Membros <span>{count(role.id)}</span></button></nav>
        {tab === 'appearance' ? <form className="role-appearance" onSubmit={e => { e.preventDefault(); void run(async () => {
          check(await db().from('roles').update({ name: draft.name.trim(), color: draft.color }).eq('server_id', serverId).eq('id', role.id).select('id').single())
          setDrafts(previous => { const next = { ...previous }; delete next[role.id]; return next }); setNotice('Alterações salvas.')
        }) }}>
          <label>Nome do cargo<input aria-label="Nome do cargo" required maxLength={32} disabled={busy || !canEdit} value={draft.name} onChange={e => setDrafts({ ...drafts, [role.id]: { ...draft, name: e.target.value } })} /></label>
          <fieldset disabled={busy || !canEdit}><legend>Emoji do cargo</legend><p className="muted">Adicione um símbolo ao início do nome. Ele acompanha o cargo em qualquer lista.</p><div className="role-emojis">{emojis.map(emoji => <button type="button" key={emoji} aria-label={`Usar emoji ${emoji}`} aria-pressed={draft.name.startsWith(`${emoji} `)} onClick={() => {
            const name = `${emoji} ${withoutEmoji(draft.name)}`
            if (name.length > 32) { setNotice('Encurte o nome para adicionar o emoji (limite de 32 caracteres).'); return }
            setDrafts({ ...drafts, [role.id]: { ...draft, name } }); setNotice('')
          }}>{emoji}</button>)}<button type="button" onClick={() => setDrafts({ ...drafts, [role.id]: { ...draft, name: withoutEmoji(draft.name) } })}>Sem emoji</button></div></fieldset>
          <fieldset disabled={busy || !canEdit}><legend>Temas prontos</legend><p className="muted">Aplica um nome e uma cor. Você pode ajustar antes de salvar.</p><div className="role-themes">{themes.map(theme => <button type="button" key={theme.label} onClick={() => setDrafts({ ...drafts, [role.id]: { name: theme.name, color: theme.color } })}><i style={{ backgroundColor: theme.color }} />{theme.label}</button>)}</div></fieldset>
          <fieldset disabled={busy || !canEdit}><legend>Cor do cargo</legend><p className="muted">Escolha uma cor para identificar este cargo.</p><div className="role-colors">{colors.map(color => <button key={color} type="button" style={{ backgroundColor: color }} aria-label={`Usar cor ${color}`} aria-pressed={draft.color.toLowerCase() === color} onClick={() => setDrafts({ ...drafts, [role.id]: { ...draft, color } })} />)}<input type="color" aria-label="Cor personalizada" value={draft.color} onChange={e => setDrafts({ ...drafts, [role.id]: { ...draft, color: e.target.value } })} /></div></fieldset>
          <label>Código da cor<input aria-label="Código hexadecimal da cor" value={hex} maxLength={7} pattern="#[0-9a-fA-F]{6}" required spellCheck={false} placeholder="#5865f2" disabled={busy || !canEdit} onChange={e => {
            const value = e.target.value; setHex(value)
            if (/^#[0-9a-fA-F]{6}$/.test(value)) setDrafts({ ...drafts, [role.id]: { ...draft, color: value } })
          }} /><small className="muted">Use # seguido de seis dígitos, como #5865f2.</small></label>
          <div className="role-preview"><small>PRÉVIA</small><span style={{ color: draft.color }}><Shield size={14} />{draft.name || 'Novo cargo'}</span></div>
          <p className="muted">O acesso a canais privados é configurado em Canais e acesso. Configure as ações permitidas na aba Permissões.</p>
          {dirty && <div className="role-save"><span>Alterações não salvas</span><button type="button" disabled={busy} onClick={() => setDrafts(previous => { const next = { ...previous }; delete next[role.id]; return next })}>Redefinir</button><button className="primary" disabled={busy || !canEdit || !draft.name.trim()}>Salvar alterações</button></div>}
        </form> : tab === 'permissions' ? <RolePermissions role={role} disabled={busy || !canEdit} saving={busy}
          setDefault={enabled => void run(async () => {
            check(await db().rpc('set_default_role', { s: serverId, r: enabled ? role.id : null }))
            setNotice('Cargo padr\u00e3o atualizado.')
          })}
          change={(permission, enabled) => void run(async () => {
            check(await db().from('roles').update({ permissions: { ...(role.permissions || defaultPermissions), [permission]: enabled } }).eq('server_id', serverId).eq('id', role.id).select('id').single())
            setNotice('Permiss\u00e3o salva.')
          })}
        /> : <div className="role-members"><label className="roles-search"><Search size={16} /><input aria-label="Buscar membros do cargo" placeholder="Buscar membros" value={memberQuery} onChange={e => setMemberQuery(e.target.value)} /></label><p className="muted">Marque as pessoas que devem receber este cargo. As alterações são salvas automaticamente.</p>
          {people.filter(p => matches(`${p.display_name} ${p.username}`, memberQuery)).map(person => <label className="role-member" key={person.id}><Avatar profile={person} small /><span><strong>{person.display_name}</strong><small>@{person.username}</small></span><input type="checkbox" aria-label={`Cargo ${role.name} para ${person.display_name}`} checked={assignments.some(a => a.role_id === role.id && a.user_id === person.id)} disabled={busy || !canEdit} onChange={e => { const enabled = e.target.checked; void run(async () => {
            if (enabled) check(await db().from('member_roles').insert({ server_id: serverId, role_id: role.id, user_id: person.id }))
            else check(await db().from('member_roles').delete().eq('server_id', serverId).eq('role_id', role.id).eq('user_id', person.id).select('user_id').single())
            setNotice(enabled ? 'Membro adicionado ao cargo.' : 'Membro removido do cargo.')
          }) }} /></label>)}
          {!people.some(p => matches(`${p.display_name} ${p.username}`, memberQuery)) && <p className="roles-empty">Nenhum membro encontrado.</p>}
        </div>}
      </div>
    </div>}
  </div>
}
