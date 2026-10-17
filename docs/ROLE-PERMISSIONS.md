# Permissões por cargo

Em Configurações do servidor → Cargos → Permissões, o proprietário configura acesso ao chat, envio de mensagens/anexos/reações, entrada em voz, microfone, câmera, transmissão de tela, configuração de canais e banimentos.

As permissões dos cargos são somadas. Uma opção desligada não bloqueia a permissão concedida por outro cargo. Membros sem cargos conservam chat e chamadas, sem configuração de canais ou banimentos. Proprietário e administradores conservam acesso total. Para restringir alguém, atribua um cargo com as opções desejadas e remova outros cargos que concedam essas ações.

O cargo padrão é único por servidor e atribuído a novos membros por um trigger, inclusive ao aceitar convites. A troca do padrão não altera membros existentes. A exclusão de um cargo remove suas atribuições; membros que ficarem sem cargos voltam às permissões básicas.

Configurar canais permite editar, arquivar e excluir canais acessíveis. Não concede administração do servidor, criação de canais ou gerenciamento de participantes. Banir remove a associação ao servidor e bloqueia novas entradas por qualquer convite. O painel de membros permite revogar o banimento; isso não reinscreve a pessoa automaticamente. Proprietário e administradores não podem ser banidos.

## Ativação

Aplicar a migração `20261017012119_role_permissions.sql` antes de publicar o frontend e publicar também a função `livekit-token`. Sem a RPC nova, o cliente bloqueia ações dependentes de permissões. Nenhum segredo adicional é necessário.

Mensagens e configuração de canais são protegidas por RLS. Banimentos e cargo padrão usam RPCs com verificação de autoridade. Tokens LiveKit limitam as fontes de publicação autorizadas. Clientes normais revalidam permissões de voz a cada 15 segundos e desligam mídias revogadas. Tokens e sessões já emitidos não são invalidados no servidor automaticamente; revogação forçada contra clientes modificados exige integração com a API administrativa LiveKit, conforme SEGURANCA.md.

## Verificação

`npm run test:db` cobre autorização real em PostgreSQL/PGlite, incluindo leitura sem envio, bloqueio de leitura, soma e revogação de cargos, cargo padrão, banimentos, reentrada e proteção contra autoelevação. `npx playwright test tests/roles.spec.ts --project=desktop` verifica o editor e o salvamento das permissões e do cargo padrão.
