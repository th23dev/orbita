# Modelo de autorização

Os dados persistentes ficam no PostgreSQL/Storage. Sessões são gerenciadas por Supabase Auth com PKCE e renovação automática. Não há cópia de mensagens, servidores ou arquivos em localStorage. O SDK pode persistir tokens de sessão no navegador; não há renderização de HTML fornecido pelos usuários.

## Regras

- `profiles`: diretório autenticado com nome, bio, status e avatar, sem e-mails; somente o próprio usuário edita.
- `user_settings`: somente o proprietário lê/escreve.
- `servers`/`server_members`: membros leem; criação adiciona proprietário por gatilho. Não há inserção direta de membros pelo cliente.
- `channels`: membros autorizados leem; somente proprietário cria/altera. Canal privado exige cargo autorizado, salvo o proprietário.
- `roles`, `member_roles`, `channel_permissions`: alterações reservadas ao proprietário; chaves estrangeiras compostas impedem mistura de cargos/canais de servidores diferentes.
- `invitations`: proprietário cria/lê/revoga; resgate ocorre em transação com lock e verifica validade/limite.
- `friendships`: solicitante cria; somente destinatário aceita; qualquer lado desfaz a relação.
- `direct_conversations`: criação transacional admite apenas amigos aceitos; integrantes leem. Desfazer amizade não remove o histórico da conversa já existente.
- `messages`: contexto único canal/DM. Somente autor edita/exclui logicamente; grants por coluna impedem mudar autor, canal, data ou resposta após criação.
- `attachments`/`message_reactions`: contexto derivado da mensagem no banco. Apenas autor anexa; membros autorizados reagem. Não há referência entre conversas.
- `soundboard_sounds`: biblioteca privada por proprietário. Compartilhamento ocorre pela faixa de áudio publicada, não por liberar o arquivo a todos.
- Storage: buckets privados, limite de tamanho, caminhos com ID do proprietário e UUID. Não há upsert. Nome original nunca vira caminho no bucket.

Funções `SECURITY DEFINER` ficam em `private`, com search_path vazio, escopo de usuário nas operações chamadas pelo cliente e execução revogada por padrão. As únicas exceções sem usuário corrente são gatilhos internos de provisionamento Auth; eles usam o ID de `NEW`, não metadados para autorização. RPCs públicos são wrappers `SECURITY INVOKER` com EXECUTE apenas para `authenticated`.

## Verificação no projeto remoto

No SQL Editor, confira RLS e políticas:

```sql
select c.relname, c.relrowsecurity
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r';

select schemaname, tablename, policyname, roles, cmd
from pg_policies
where schemaname in ('public','storage','realtime')
order by schemaname,tablename;

select schemaname,tablename from pg_publication_tables
where pubname='supabase_realtime';

select id,public,file_size_limit from storage.buckets
where id in ('attachments','sounds','avatars');
```

Todas as 16 tabelas públicas devem ter RLS; os três buckets devem ter `public=false`. Use o Security Advisor para detectar divergências de grants/configuração. Faça as tentativas REST do roteiro com JWTs de usuários comuns, nunca com sessão administrativa/SQL Editor, que pode ignorar RLS.

## Tempo de revogação

Consultas REST/Postgres Changes aplicam RLS. A autorização de Broadcast/Presence é armazenada em cache por conexão e renovada com JWT; esses eventos carregam apenas IDs e estados transitórios, nunca mensagens persistentes. Defina expiração curta de JWT.

URLs de prévia são assinadas por 60 segundos e continuam utilizáveis até expirar. Downloads autenticados passam pelas políticas no momento da requisição. Arquivos já baixados não podem ser revogados.

LiveKit verifica a permissão na emissão/entrada. Um token curto não desconecta uma sessão já estabelecida. O aplicativo revalida o canal a cada 15 segundos e encerra a chamada ao perder acesso, mas esse controle no cliente não substitui expulsão no servidor. Caso seja exigida revogação imediata contra clientes modificados, implemente uma rotina administrativa no backend que, após remover o cargo/permissão, use a API `RoomServiceClient.removeParticipant(room, userId)` com o segredo LiveKit. Esse mecanismo de expulsão forçada **não faz parte desta entrega**. Não prometa revogação instantânea de mídia.

## Operação

Mantenha segredos LiveKit somente no Supabase. Configure SMTP, confirmação de e-mail e limites Auth. Ajuste quotas do banco/Storage/LiveKit e observe erros antes de abrir a uma comunidade grande. O SQL limita conteúdo, tipo, tamanho e propriedade; limites de frequência por usuário e antivírus requerem mecanismos adicionais.

Uploads interrompidos podem deixar objetos/referências `ready=false`. Inspecione e limpe periodicamente, excluindo primeiro objetos pela API Storage, depois referências, após confirmar que não há envio ativo. Exclusão lógica de mensagens limpa o texto e bloqueia arquivos, mas não apaga o objeto físico; retenção/limpeza deve ser definida pelo operador.
