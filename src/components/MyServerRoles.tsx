import { useState } from 'react'
import { Check, Shield, X } from 'lucide-react'
import type { Role } from '../lib/types'
import { permissionOptions, type Permissions } from '../lib/permissions'
import { Modal } from './ui'

export function MyServerRoles({ roles, access, unavailable, serverName, permissionState }: {
  roles: Role[]
  access: 'owner' | 'admin' | 'member'
  unavailable: boolean
  serverName: string
  permissionState: { permissions: Permissions; loading: boolean; error: boolean }
}) {
  const [showPermissions, setShowPermissions] = useState(false)
  const { permissions, loading, error } = permissionState
  return (
    <section className="my-server-roles" aria-label="Seus cargos neste servidor">
      <h3><Shield size={14} /> Seus cargos</h3>
      <ul>
        {access !== 'member' && <li>{access === 'owner' ? 'Proprietário' : 'Administrador'}</li>}
        {!unavailable && roles.map(role => (
          <li key={role.id}><i style={{ backgroundColor: role.color }} aria-hidden="true" />{role.name}</li>
        ))}
        {!unavailable && access === 'member' && roles.length === 0 && <li>Membro</li>}
      </ul>
      {unavailable && <p>Não foi possível carregar seus cargos.</p>}
      <button className="my-permissions-button" onClick={() => setShowPermissions(true)}>
        <Shield size={14} /> Ver minhas permissões
      </button>
      {showPermissions && (
        <Modal title="Suas permissões" close={() => setShowPermissions(false)}>
          <div className="my-permissions">
            <p className="muted">No servidor <strong>{serverName}</strong></p>
            {loading ? <p role="status">Carregando permissões…</p> : error ? (
              <p role="alert">Não foi possível consultar suas permissões. Verifique sua conexão; tentaremos novamente automaticamente.</p>
            ) : (
              <>
                <p>Estes são os acessos concedidos pela combinação dos seus cargos. Canais privados ainda exigem acesso ao canal. Para usar microfone, câmera ou tela, você também precisa poder entrar na chamada.</p>
                <ul className="my-permissions-list">
                  {permissionOptions.map(option => (
                    <li key={option.key}>
                      <div><strong>{option.label}</strong><p>{option.description}</p></div>
                      <span className={`my-permission-status ${permissions[option.key] ? 'allowed' : ''}`}>
                        {permissions[option.key] ? <Check size={15} aria-hidden="true" /> : <X size={15} aria-hidden="true" />}
                        {permissions[option.key] ? 'Permitido' : 'Não permitido'}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="muted">Somente a administração do servidor pode alterar seus cargos. Proprietário e administradores têm todas as permissões acima.</p>
              </>
            )}
          </div>
        </Modal>
      )}
    </section>
  )
}
