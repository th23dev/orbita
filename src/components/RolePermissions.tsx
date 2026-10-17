import { Check, Headphones, Info, MessageSquare, ShieldCheck, Sparkles } from 'lucide-react'
import { defaultPermissions, permissionOptions, type Permission } from '../lib/permissions'
import type { Role } from '../lib/types'

const groups = [
  { title: 'Texto e conversa', icon: MessageSquare, keys: ['read_chat', 'send_messages'] },
  { title: 'Voz e vídeo', icon: Headphones, keys: ['connect_voice', 'speak', 'share_screen', 'use_camera'] },
  { title: 'Gerenciamento', icon: ShieldCheck, keys: ['manage_channels', 'ban_members'] },
]

export function RolePermissions({ role, disabled, saving, change, setDefault }: {
  role: Role
  disabled: boolean
  saving: boolean
  change: (permission: Permission, enabled: boolean) => void
  setDefault: (enabled: boolean) => void
}) {
  const permissions = role.permissions || defaultPermissions
  const enabledCount = permissionOptions.filter(option => permissions[option.key]).length
  return <div className="role-permissions">
    <div className="permissions-heading">
      <div><h3>O que este cargo pode fazer</h3><p>Escolha os acessos de quem recebe este cargo.</p></div>
      <span className="permissions-save-state"><Check size={13} />{saving ? 'Salvando…' : 'Salvamento automático'}</span>
    </div>
    <label className={`permission-default ${role.is_default ? 'is-default' : ''}`}>
      <span className="permission-default-icon"><Sparkles size={20} /></span>
      <span className="permission-copy"><strong>Cargo padrão para novos usuários</strong><small>Novos membros recebem este cargo automaticamente.</small><span className="permission-default-state">{role.is_default ? 'Padrão deste servidor' : 'Apenas um cargo pode ser o padrão'}</span></span>
      <input className="permission-switch" type="checkbox" aria-label="Cargo padrão para novos usuários" checked={Boolean(role.is_default)} disabled={disabled} onChange={e => setDefault(e.target.checked)} />
    </label>
    <div className="permissions-section-title"><span>PERMISSÕES DO CARGO</span><span>{enabledCount} de {permissionOptions.length} ativas</span></div>
    {groups.map(group => <section className="permission-group" key={group.title} aria-label={group.title}>
      <div className="permission-group-title"><group.icon size={16} /><h4>{group.title}</h4></div>
      {permissionOptions.filter(option => group.keys.includes(option.key)).map(option => <label className="role-permission" key={option.key}>
        <span className="permission-copy"><strong>{option.label}</strong><small>{option.description}</small></span>
        <input className="permission-switch" type="checkbox" aria-label={option.label} checked={permissions[option.key] === true} disabled={disabled} onChange={e => change(option.key, e.target.checked)} />
      </label>)}
    </section>)}
    <details className="permissions-help"><summary><Info size={15} />Como as permissões se combinam</summary>
      <p>As permissões dos cargos se somam. Desativar aqui não remove um acesso concedido por outro cargo. Proprietário e administradores mantêm acesso total.</p>
      <p>Sem cargos, membros podem usar chat e chamadas. O cargo padrão vale apenas para novos membros. Permissões de voz são renovadas ao reconectar à chamada.</p>
    </details>
  </div>
}
