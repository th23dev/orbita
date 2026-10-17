export const permissionOptions = [
  { key: 'read_chat', label: 'Acessar o chat', description: 'Ler mensagens e histórico dos canais aos quais tem acesso.' },
  { key: 'send_messages', label: 'Enviar mensagens', description: 'Enviar e editar mensagens, reagir e anexar arquivos. Requer acesso ao chat.' },
  { key: 'connect_voice', label: 'Entrar em canais de voz', description: 'Participar e ouvir as chamadas do servidor.' },
  { key: 'speak', label: 'Falar nas chamadas', description: 'Usar o microfone e os sons durante chamadas.' },
  { key: 'share_screen', label: 'Transmitir tela', description: 'Compartilhar a tela e o áudio da transmissão.' },
  { key: 'use_camera', label: 'Usar câmera', description: 'Transmitir vídeo nas chamadas.' },
  { key: 'manage_channels', label: 'Configurar canais', description: 'Editar, arquivar e excluir canais aos quais tem acesso.' },
  { key: 'ban_members', label: 'Banir usuários', description: 'Banir membros e impedir sua reentrada por convite. Administradores e o proprietário são protegidos.' },
] as const
export type Permission = typeof permissionOptions[number]['key']
export type Permissions = Record<Permission, boolean>
export const defaultPermissions: Permissions = { read_chat: true, send_messages: true, connect_voice: true, speak: true, share_screen: true, use_camera: true, manage_channels: false, ban_members: false }
export const noPermissions = Object.fromEntries(permissionOptions.map(p => [p.key, false])) as Permissions
