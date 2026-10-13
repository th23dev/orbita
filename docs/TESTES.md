# Aceitação e evidências

## O que pode ser verificado sem serviços externos

`npm test` valida arquivos vazios/grandes, formatos de avatar/soundboard e bloqueio de prévias ativas de HTML/SVG/PDF.

`npm run test:db` executa a migration em um motor PostgreSQL real em WebAssembly (PGlite). Os schemas `auth`, `storage` e `realtime` têm estruturas mínimas para exercitar SQL, privilégios e políticas. São 22 cenários com Alice, Bob e Eve. Isso valida RLS, mas **não substitui** Supabase Auth, Storage HTTP ou replicação Realtime de um projeto real.

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

Validações locais: build TypeScript/Vite, 4 testes de arquivos, 22 cenários SQL e 4 verificações Playwright de interface. Auditoria npm das dependências de produção: sem vulnerabilidades reportadas na execução.

**Pendente:** login real, replicação Supabase, armazenamento HTTP, fluxo de e-mail, voz entre dispositivos, tela e áudio remoto da soundboard. O usuário optou por preparar um novo projeto Supabase; ele e a instância LiveKit ainda precisam ser configurados.
