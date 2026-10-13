# Aceitação e evidências

## O que pode ser verificado sem serviços externos

`npm test` valida arquivos vazios/grandes, formatos de avatar/soundboard e bloqueio de prévias ativas de HTML/SVG/PDF. Os testes unitários de áudio usam substitutos de AudioContext/LiveKit para verificar publicação da faixa, liberação de recursos e interrupção durante downloads; não provam audibilidade entre dispositivos.

`npm run test:db` executa as migrations em um motor PostgreSQL real em WebAssembly (PGlite). Os schemas `auth`, `storage` e `realtime` têm estruturas mínimas para exercitar SQL, privilégios e políticas. São 26 cenários com Alice, Bob e Eve, incluindo acesso individual a canais e proteção dos logos. Isso valida RLS, mas **não substitui** Supabase Auth, Storage HTTP ou replicação Realtime de um projeto real.

`npm run test:e2e -- tests/interface.spec.ts` abre a interface em desktop e celular, navega entre entrada/cadastro/recuperação, verifica rotas por hash e ausência de overflow horizontal/erros JavaScript.

## Teste automatizado com duas contas reais

Crie duas contas confirmadas em um projeto Supabase exclusivo para testes. Configure `.env.local` com as variáveis públicas desse projeto. Defina, na sessão do terminal, sem versionar:

```text
E2E_ALICE_EMAIL
E2E_ALICE_PASSWORD
E2E_BOB_EMAIL
E2E_BOB_PASSWORD
```

Execute `npm run test:e2e -- tests/live.spec.ts --project=desktop`. Esse teste abre dois contextos de navegador isolados e **não intercepta nem simula chamadas de API**. Cria servidor, convite e mensagens de teste; os dados permanecem no projeto de testes. Valida login, mensagem remota, persistência após reload, edição, reação e upload/download. Para executar contra Pages, defina `E2E_BASE_URL=https://th23dev.github.io/orbita/`.

Sem essas variáveis, o teste é marcado como **skipped**, não aprovado. O workflow público não recebe credenciais de usuários e não executa essa validação externa.

## Roteiro obrigatório em dois dispositivos

Use Alice no computador A e Bob no computador B. Para voz, use fones e contas distintas. Faça primeiro em Wi-Fi compartilhado e depois, quando possível, em redes diferentes para validar TURN. Abra as URLs Pages diretamente.

| Etapa | Ação | Evidência esperada |
| --- | --- | --- |
| Login | Entrar com Alice e Bob e recarregar | Sessões continuam autenticadas |
| Servidor | Alice cria servidor, compartilha código; Bob entra | Mesmo servidor e canais nos dois dispositivos |
| Texto | Alice envia texto; Bob responde | Mensagens aparecem sem atualização manual |
| Persistência | Fechar/reabrir ambas as abas | Histórico preservado |
| Edição/exclusão | Alice edita/exclui sua mensagem | Bob vê mudança/exclusão, sem conteúdo antigo |
| Resposta/reação | Bob responde e reage; remove reação | Resposta e contagem sincronizam |
| Digitação/presença | Digitar sem enviar; sair do servidor | Indicador temporário expira; presença é atualizada |
| Perfil/canal | Mudar nome e criar canal | Outra sessão recebe a atualização |
| Permissões | Criar canal privado, conceder cargo a Bob, retirar | Bob só consulta o canal enquanto autorizado |
| Não membro | Eve tenta IDs conhecidos pela REST API | Não recebe mensagens, anexos ou canais privados |
| Arquivos | Arrastar imagem e TXT/PDF/ZIP; baixar como Bob | Progresso real, prévia segura, bytes íntegros no download |
| Voz | Ambos entram; alternar falantes; mutar | Áudio bilateral, indicação de falante e mute corretos |
| Volume | Bob reduz volume de Alice | Apenas a reprodução de Bob muda |
| Rede | Interromper rede brevemente | Estado de reconexão e retomada quando possível |
| Tela | Alice transmite uma aba; Bob assiste | Vídeo dentro da sala; para ao encerrar transmissão |
| Áudio de aba | Compartilhar com áudio habilitado no navegador | Bob ouve quando plataforma/navegador suportarem |
| Soundboard | Alice publica som com microfone desligado | **Bob ouve o som**; isso prova transmissão da faixa independente |
| Interrupção | Alice clica Parar sons durante reprodução | Áudio remoto cessa; sair encerra tracks e captura |
| Segurança de voz | Eve solicita token do canal privado | Edge Function responde 403 |
| Saída | Sair da chamada e fazer logout | Microfone/tela param; sessão termina |
| Pages | Abrir hash de canal diretamente em janela nova | Site carrega via HTTPS, sem erro 404 |

Registre navegador/versão, sistema, dispositivo, rede, URL e horário para cada teste. Marque bloqueios de mídia do navegador separadamente de defeitos do aplicativo.

## Situação nesta entrega

Validações locais: build TypeScript/Vite, 10 testes unitários (4 de arquivos, 3 do ciclo de áudio e 3 de convites), 26 cenários SQL e 4 verificações Playwright de interface. Auditoria npm das dependências de produção: sem vulnerabilidades reportadas na execução.

**Provisionamento remoto verificado:** projeto `orbita` ativo em São Paulo; 17 tabelas com RLS, quatro buckets privados e 16 tabelas na publicação Realtime. Auth HTTP acessível com confirmação de e-mail habilitada; leitura anônima de perfis negada com HTTP 401. Security Advisor sem apontamentos de SQL/RLS, mas com alerta de proteção contra senhas vazadas desativada no Auth (ver guia de ativação). Índice composto e políticas redundantes corrigidos após Performance Advisor; restam apenas informações de índices ainda não usados em um banco novo.

**LiveKit validado em 13/10/2026 UTC:** projeto `orbita` conectado ao Supabase, quatro segredos conferidos por hash, preflight HTTP 204 e requisição sem sessão HTTP 401. `node scripts/verify-livekit.mjs --live` autenticou contas temporárias reais, validou tokens limitados à sala e cinco minutos, bloqueou não membro/canal de texto/origem desconhecida/sessão inválida/canal arquivado. Dois contextos Edge conectaram ao LiveKit Cloud e um tom transmitido por faixa independente foi recebido e decodificado no outro contexto, com nível de sinal medido por Web Audio. Contas e servidor de teste removidos ao final. Nenhuma resposta HTTP ou conexão WebRTC foi simulada.

**Interface validada em 13/10/2026 (Fortaleza):** `node scripts/verify-call-ui.mjs --live`, com o Vite em `http://127.0.0.1:5173/` e a CLI Supabase autenticada, cria duas contas confirmadas temporárias e um servidor, removidos ao final. Valida login pela interface, upload/remoção/substituição de logo por HTTP, leitura do logo por outro membro, identidade do servidor e concessão/revogação individual de canal privado. O emissor LiveKit retorna 403 antes/depois da autorização e emite token enquanto autorizado. Valida também ocultação de membros, prévia da câmera e liberação da captura, entrada com microfone desligado, câmera remota, destaque com uma câmera, grade com duas, prioridade da tela, controles de qualidade contextuais, tela cheia, soundboard recolhível e layout móvel. As APIs e o transporte LiveKit são reais; a câmera é sintética do Chromium e o seletor de tela é substituído por um canvas animado. Instale o navegador com `npx playwright install chromium`. O teste não roda sem `--live`; `E2E_BASE_URL` permite apontar para o Pages autorizado.

A nova migração está aplicada no projeto: 17 tabelas com RLS, quatro buckets privados e 16 tabelas Realtime. Advisors de segurança/desempenho não apontaram novos problemas; permanece o alerta preexistente de proteção contra senhas vazadas no Auth.

**Membros e mobile validados em 13/10/2026:** `node scripts/verify-members-ui.mjs --live` cria três contas temporárias e valida busca por nome e @usuário, adição direta pelo proprietário, chegada da associação por Realtime, convite por link preservado através do login, entrada e rejeição de convite revogado. Verifica navegação inferior, abertura/fechamento dos painéis, mensagem remota e ações de mensagem, formulário de convite e ausência de overflow em 320, 390 e 720 px. APIs reais, sem mocks; contas/servidor removidos ao terminar. A chamada também foi revalidada com o novo layout mobile. O seletor de compartilhamento nativo do sistema e o teclado virtual de aparelhos físicos continuam dependendo de verificação manual.

**Ajuste posterior de vídeo e presença:** TypeScript e 26 cenários SQL passaram; sete asserções diretas da seleção de destaque verificaram câmera única, prioridade padrão da tela, escolha individual, retirada da transmissão selecionada e grade de câmeras. O teste SQL inclui a autorização dos tópicos de presença de voz e a negação após revogar acesso privado. O script `verify-call-ui.mjs` foi ampliado para verificar miniaturas 16:9, alternância entre câmera e duas telas e lista de participantes vista por uma aba fora da chamada. Essa ampliação ainda não foi executada no navegador: a revisão automática passou a falhar por limite de uso durante a consulta da publicação. A publicação dessas alterações também está pendente.

**Estabilização da lista e ampliação do destaque:** a presença agora é registrada uma vez por entrada; mudanças de fala/mídia são coalescidas por 300 ms e enviadas por broadcast no mesmo tópico privado, com atualização periódica para novos observadores. Ausências transitórias têm tolerância limitada de 1,5 segundo, sem estender indefinidamente uma saída real. TypeScript e sete asserções diretas passaram, incluindo snapshot vazio transitório, saída definitiva, retorno durante reconexão, estados de mídia e múltiplas sessões do mesmo usuário. O destaque passou a preencher a área disponível, com miniaturas laterais em telas largas. A validação visual e a integração real dessa revisão seguem pendentes.

**Pendente:** fluxo de e-mail, replicação de mensagens e anexos entre usuários, captura e reprodução em dispositivos/redes diferentes, seletor nativo de compartilhamento de tela e uso completo da interface da soundboard. A mídia sintética valida o transporte e os controles, mas não substitui essas verificações de uso. Conclua [a ativação](ATIVACAO.md) antes de executar o roteiro.
