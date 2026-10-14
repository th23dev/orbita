# Canais, convites, mensagens e chamadas

Atualização de 13/10/2026. A migração `20261013232251_community_invites_and_conversation_identity.sql` foi aplicada ao projeto Supabase `wjzirjfoaabpmyehzbtb`, com autorização do usuário. O horário/identificador do arquivo local acompanha a versão registrada no Supabase.

## Participação e configurações

- A criação de servidores e canais aceita descrição e seleção de amigos. Canais também têm tipo e privacidade. A criação e o envio dos convites são uma única transação.
- Convites individuais ficam em **Convites** até serem aceitos ou recusados. Aceitar um convite de canal também inclui a pessoa no servidor informado. Convites expiram em sete dias; convites por link continuam exigindo a ação de entrar.
- A inserção direta de membros de servidor pelo cliente foi revogada. Funções autenticadas validam escopo e permissões; funções privilegiadas ficam no schema privado.
- O proprietário pode promover administradores do servidor. Administradores gerenciam canais e membros comuns. Moderadores do canal podem editar esse canal, convidar e remover participantes comuns, mas não promover administradores.
- A engrenagem de cada canal, na barra lateral, concentra nome, descrição, privacidade e participantes. Canais padrão são editáveis. As categorias de texto e voz podem ser recolhidas, com preferência persistida.
- Membros podem sair de canais e do servidor. O proprietário mantém o acesso administrativo. Canais dos quais alguém saiu ou foi removido exigem novo convite aceito, mesmo que houvesse permissão individual ou por cargo.
- Os perfis mostram foto, nome de exibição, @usuário, bio e disponibilidade configurada pela pessoa. A disponibilidade do perfil não representa uma verificação global de conexão em tempo real.

## Mensagens

- Conversas de duas pessoas são reutilizadas sob trava transacional, inclusive quando abertas pela outra pessoa. Grupos continuam independentes.
- Conversas duplicadas existentes recebem `canonical_id`. Nenhuma conversa ou mensagem é apagada: a interface mostra apenas a conversa principal e consulta também o histórico dos aliases. No projeto em uso, 9 registros passaram a aparecer como 3 conversas, mantendo 6 aliases.
- Respostas exibem autor e trecho da mensagem original. Clicar abre e destaca a origem, mesmo fora das últimas 50 mensagens, em uma janela de contexto com retorno às mensagens recentes.
- Confirmações e renomeações usam dialogs acessíveis, em vez de `window.confirm`/`window.prompt`.

## Áudio e segundo plano

- O soundboard retoma o AudioContext no gesto do usuário, antes das operações de rede, e permite tentar novamente após erro de publicação. Há prévia local antes de entrar na chamada; dentro da chamada, o áudio é publicado em faixa própria.
- Sons sintetizados distintos sinalizam entrada e saída, sem depender de arquivos externos ou copiar áudios do Discord.
- A chamada não é encerrada por falha temporária na consulta de autorização. Uma resposta confirmada sem acesso encerra a conexão. Ao voltar ao site ou recuperar a rede, uma chamada interrompida tenta obter novo token e reconectar, preservando a intenção de microfone.
- Remoção explícita, identidade duplicada e exclusão da sala não disparam reconexão automática. Uma falha de reconexão também pode ser recuperada pelo botão de tentar novamente.
- O navegador recebe metadados de sessão de mídia. A suspensão ou encerramento completo da aba pelo sistema operacional continua fora do controle de uma aplicação web. Continuidade em segundo plano precisa ser validada em aparelhos reais; não equivale a uma garantia de serviço nativo.

## Validação

- `npm run build`: TypeScript e build Vite.
- `npm run test`: inclui áudio com publicação lenta, prévia, repetição após falha e liberação de mídia.
- `npm run test:db`: PostgreSQL via PGlite, incluindo aceite, recusa, acesso privado, cargos, saída, preservação de permissões e identidade de DMs.
- `npx playwright test tests/interface.spec.ts tests/community.spec.ts`: desktop e celular. Os testes de comunidade simulam as respostas HTTP; as regras de banco são exercitadas separadamente no PostgreSQL.
- O cenário real com dois usuários de `tests/live.spec.ts` requer contas de teste configuradas. Chamada com microfone real e retomada após suspensão do sistema não foram validadas nesta atualização.
- O advisor de segurança do Supabase não encontrou novas falhas de RLS. Permanece o aviso de configuração de [proteção contra senhas vazadas desativada](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection), fora do escopo desta alteração.
