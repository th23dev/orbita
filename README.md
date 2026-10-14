# Órbita

**Perto, mesmo de longe.** Plataforma de comunicação com React, Vite, TypeScript, Tailwind CSS, Supabase e LiveKit. Interface em português, temas claro/escuro e layout responsivo.

- Repositório: https://github.com/th23dev/orbita
- Frontend: https://th23dev.github.io/orbita/
- Hospedagem estática pelo GitHub Actions; banco, identidade e arquivos no Supabase; mídia no LiveKit.

## Estado da entrega

Atualização de canais, convites com aceitação, cargos, respostas, DMs e áudio: veja [COMMUNITY-UPDATE.md](docs/COMMUNITY-UPDATE.md), incluindo a migração aplicada e os limites de chamadas em segundo plano.

O código das funcionalidades está implementado. O frontend está vinculado ao projeto Supabase **orbita**, na organização **th23dev**, região São Paulo. As variáveis públicas de conexão estão configuradas no GitHub Actions. Não há usuários, mensagens, sons ou chamadas fictícios.

**Projeto Supabase criado:** [abrir painel](https://supabase.com/dashboard/project/wjzirjfoaabpmyehzbtb). As 16 tabelas com RLS, os três buckets privados, a publicação Realtime e a função `livekit-token` foram aplicados e verificados. O projeto anterior `th23dev` não foi alterado.

**LiveKit configurado:** projeto `orbita` conectado ao Supabase; tokens e transmissão de áudio entre dois navegadores validados. Veja [LIVEKIT.md](docs/LIVEKIT.md).

**Pendências de ativação:** URLs de autenticação, configuração de envio de e-mail e opção de acesso público Realtime. Veja [ATIVACAO.md](docs/ATIVACAO.md). Captura de microfone/tela e testes em dispositivos diferentes continuam pendentes.

## Rodar localmente

Requer Node.js 24 e npm. As versões estão fixadas em `package.json` e `package-lock.json`.

```sh
npm ci
```

Copie `.env.example` para `.env.local` e preencha **apenas valores públicos**:

```dotenv
VITE_SUPABASE_URL=https://SEU_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_SUA_CHAVE_PUBLICA
VITE_BASE_PATH=/
```

```sh
npm run dev
```

O acesso local é `http://127.0.0.1:5173`. Sem configuração, é possível abrir as telas de entrada, cadastro e recuperação, mas nenhuma autenticação é simulada.

## Etapas de configuração e desenvolvimento

### 1. React e GitHub Pages

O frontend gera somente arquivos estáticos. A navegação usa fragmentos `#/channel/UUID` e `#/dm/UUID`, preservando o funcionamento ao atualizar a página e evitando 404 no Pages. O caminho base vem de `VITE_BASE_PATH`; o workflow define `/orbita/` automaticamente a partir do nome do repositório.

Validação: `npm run build` e `npm run test:e2e -- tests/interface.spec.ts`.

### 2. Novo projeto Supabase

Crie um projeto vazio no [painel Supabase](https://supabase.com/dashboard). Guarde a senha do banco no seu gerenciador de senhas. Em **Connect / API Keys**, copie a URL e a chave **publishable**, nunca `service_role` ou `sb_secret_*`.

O frontend aceita a chave moderna `sb_publishable_*`. A função de voz usa a variável interna `SUPABASE_ANON_KEY` disponibilizada pelo runtime Supabase, com o JWT do usuário; ela não usa uma chave administrativa para consultar canais.

### 3. PostgreSQL, migrations e RLS

Autentique a CLI e associe o projeto novo:

```sh
npx supabase login
npx supabase link --project-ref SEU_PROJECT_REF
npx supabase db push --dry-run
npx supabase db push
```

A migration `supabase/migrations/20261013021045_orbita.sql` cria 16 tabelas: as 15 entidades solicitadas mais `user_settings`. Inclui relacionamentos, índices, busca textual, gatilhos, grants por coluna e RLS. A migration seguinte otimiza índices e políticas. **Ambas já estão aplicadas no projeto orbita**; os passos de criação do banco são para reproduzir o ambiente em outro projeto vazio.

Alternativa sem CLI: execute todo o arquivo da migration no SQL Editor do projeto novo. Escolha **um** método; não execute o mesmo SQL duas vezes. Se optar pelo SQL Editor, ajuste o histórico antes de voltar a usar migrations pela CLI.

Em **Realtime Settings**, desative **Allow public access** para Broadcast/Presence. A migration adiciona as tabelas à publicação `supabase_realtime`; não adicione novamente. O schema `private` não deve fazer parte dos schemas expostos na Data API. Mantenha `public` exposto; os grants necessários já fazem parte do SQL.

Em **Storage**, os buckets `attachments`, `sounds` e `avatars` são criados **privados** pelo SQL. Não os torne públicos.

Validação local: `npm run test:db`. Após aplicar no projeto, execute o SQL de verificação de [docs/SEGURANCA.md](docs/SEGURANCA.md) e consulte o Security Advisor do Supabase.

### 4. Autenticação e perfis

Em **Authentication → URL Configuration**:

- Site URL: `https://th23dev.github.io/orbita/`
- Redirect URLs: `https://th23dev.github.io/orbita/`, `http://127.0.0.1:5173/` e `http://localhost:5173/`.

Ative o provedor de e-mail e confirmação de e-mail. Configure SMTP para envio aos usuários. Configure expiração de JWT de 900 segundos no ambiente remoto; o `config.toml` local não altera automaticamente as opções do painel remoto.

Cadastro cria perfil e preferências por gatilho. Ajuste o nome de usuário nas configurações para seus amigos encontrarem você. Há login/logout, recuperação de senha, foto, descrição, status e preferências. O fluxo PKCE exige abrir o link de confirmação/recuperação no mesmo navegador que iniciou a solicitação.

Validação: cadastre duas contas com e-mails distintos, confirme os e-mails e teste sessão persistente após recarregar.

### 5. Servidores, canais, cargos e convites

O botão `+` na barra de servidores cria um servidor, com canal `geral` e sala de voz iniciais. O proprietário gerencia canais, convites, cargos e permissões no menu do servidor.

Use **Adicionar membros** na lista de canais para buscar uma conta pelo nome ou `@usuário` e adicioná-la diretamente. Só o proprietário tem essa permissão. Na mesma janela, **Criar link de convite** gera um link que pode ser copiado ou compartilhado pelo menu nativo do celular, quando disponível. O convite expira em 7 dias e permite até 25 entradas; o proprietário pode revogá-lo. Quem abre o link faz login e confirma **Entrar no servidor**. Também é possível colar o link completo ou o código em **Entrar com convite**. Links copiados no ambiente local apontam para o Pages público para funcionar em outros dispositivos.

No celular, a barra inferior dá acesso a **Servidores**, **Amigos**, **Chamada** e **Perfil**. Servidores/canais e membros abrem em painéis separados, com fechamento pelo botão ou pelo fundo escuro. As opções de cada mensagem ficam no botão **⋯**, preservando espaço para o texto.

Os canais de voz mostram abaixo do nome quem está na chamada, com avatar, microfone desligado e indicadores de câmera/tela. A lista é atualizada por presença Realtime e só aparece para quem tem acesso ao canal; não é necessário entrar na chamada para consultá-la.

Canais privados exigem um cargo autorizado ou acesso individual em **Gerenciar servidor → Canais e acesso → Permissões por usuário**; o proprietário conserva acesso. Para retirar um acesso herdado, remova o cargo ou a permissão desse cargo. Essas permissões permitem ver o canal e participar da conversa; a administração cabe ao proprietário. Arquivar remove o canal da navegação; o histórico continua no banco. Restaurar exige uma alteração administrativa de `archived` para `false`.

Em **Gerenciar servidor → Identidade do servidor**, o proprietário pode editar nome/descrição e enviar, substituir ou remover um logo JPG, PNG ou WebP de até 2 MB. O logo aparece na barra de servidores e é armazenado em um bucket privado acessível aos membros. O botão **Membros** no cabeçalho esconde ou mostra a lista lateral e lembra a preferência neste navegador.

Validação: [cenários de acesso](docs/TESTES.md), incluindo um terceiro usuário sem convite.

### 6. Chat em tempo real

Mensagens, edições, exclusões lógicas, respostas, reações e metadados usam Postgres Changes. Presence indica membros conectados ao servidor aberto; Broadcast envia digitação temporária em tópicos privados. O histórico é paginado em 50 mensagens. A busca usa índice GIN/`tsvector` com consultas `websearch`, limitada a 50 resultados por pesquisa.

As conversas privadas e grupos são criados pela lista de amigos; grupos aceitam até 9 convidados confirmados mais o criador. Notificações de novas mensagens podem ser ativadas nas configurações e aparecem quando a aba não está visível. O navegador precisa permitir notificações; não são push notifications com o site fechado.

### 7. Arquivos

Anexe pelo botão ou arraste arquivos. Até 5 por mensagem, 25 MB cada. O progresso vem dos bytes enviados pelo XHR. Imagens comuns, vídeo MP4/WebM e áudio compatível têm prévia; PDFs, documentos, planilhas, ZIP, código-fonte, HTML e SVG são baixados como arquivos, sem execução no aplicativo.

Os caminhos são UUIDs, independentes do nome fornecido. A referência é criada antes do upload e marcada `ready` depois. Falhas tentam remover metadados/objetos incompletos. Downloads passam pelas políticas Storage; prévias usam links assinados de 60 segundos.

Validação: upload de arquivo, visualização por outro membro, download, bloqueio por não membro e rejeição de tamanho excedido.

### 8. Voz e Edge Function

Crie um projeto no [LiveKit Cloud](https://cloud.livekit.io/) ou configure uma instância SFU própria com HTTPS/WSS e conectividade TURN conforme a [documentação LiveKit](https://docs.livekit.io/transport/self-hosting/). Supabase não transporta áudio/vídeo.

Em **Supabase → Edge Functions → Secrets**, defina:

| Nome | Valor |
| --- | --- |
| `LIVEKIT_URL` | `wss://SUA_INSTANCIA.livekit.cloud` |
| `LIVEKIT_API_KEY` | Chave da instância LiveKit |
| `LIVEKIT_API_SECRET` | Segredo da instância LiveKit |
| `ALLOWED_ORIGINS` | `https://th23dev.github.io,http://127.0.0.1:5173,http://localhost:5173` |

Origens não contêm caminho nem barra final. Os segredos LiveKit nunca devem usar prefixo `VITE_`, nem entrar no GitHub ou no bundle público.

```sh
npx supabase functions deploy livekit-token --use-api
```

`verify_jwt = false` desativa somente a verificação legada do gateway. O handler **exige e valida** o bearer token com `auth.getUser()`, consulta o canal sob RLS, verifica seu tipo e emite token LiveKit de cinco minutos, restrito à sala. Requisições anônimas não recebem tokens. Dê permissão de microfone ao navegador. Para voz, cada pessoa usa sua própria conta e identidade.

Validação estática da função:

```sh
npx deno check --config supabase/functions/deno.json supabase/functions/livekit-token/index.ts
```

### 9. Tela

Antes de entrar, use **Sua prévia** para escolher microfone ligado/desligado e câmera ligada/desligada. Ligar a câmera mostra a imagem local; desligá-la ou sair libera a captura. Dentro da chamada, os controles permitem alternar microfone e câmera, compartilhar tela, abrir a soundboard e desconectar. Uma única câmera ocupa a área principal; com várias câmeras, os vídeos ficam em grade. A tela compartilhada tem prioridade na área principal.

As miniaturas usam proporção 16:9 e largura limitada. A transmissão em destaque ocupa a área principal disponível, preservando a proporção do vídeo; em telas grandes, as miniaturas ficam na lateral. Quando houver mais de uma câmera ou tela, use o seletor de transmissões acima do vídeo para escolher o destaque. A escolha é individual e não altera o que os outros assistem. **Destaque automático** restaura a prioridade da tela; se a transmissão escolhida terminar, outra disponível assume o lugar.

Clique **Compartilhar tela**. O seletor 720p/1080p só aparece enquanto você ou outra pessoa transmite a tela. O navegador determina quais telas/janelas/abas e áudio podem ser compartilhados. Para áudio de aba, selecione a opção correspondente no diálogo do navegador. Os demais participantes recebem a faixa dentro da sala. Pare pelo botão do app ou pelo controle nativo do navegador.

### 10. Soundboard

Adicione MP3, WAV ou OGG de até 10 MB. O player limita a duração a 30 segundos. Os arquivos ficam na biblioteca privada do usuário. Você pode renomear, excluir, ajustar o volume e interromper o som.

Ao reproduzir em uma chamada, Web Audio decodifica o arquivo, passa por um `GainNode` e chega a um `MediaStreamAudioDestinationNode`. Essa faixa é publicada com `localParticipant.publishTrack()` no LiveKit; os demais participantes a recebem como áudio remoto. O som também é monitorado localmente. **Desligar o microfone não desliga a soundboard.** Use **Parar sons** para interrompê-la.

### 11. Testes e publicação

```sh
npm test
npm run test:db
npx playwright install chromium
npm run test:e2e
npm run build
```

No Windows com Edge instalado, você pode definir `PLAYWRIGHT_CHANNEL=msedge` antes dos testes, evitando baixar Chromium. A suíte `live.spec.ts` só executa quando as quatro variáveis de conta descritas em [docs/TESTES.md](docs/TESTES.md) estiverem configuradas.

Em **GitHub → Settings → Secrets and variables → Actions → Variables**, adicione:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

São valores públicos usados pelo frontend. Em **Settings → Pages**, selecione **GitHub Actions**. Execute o workflow **Build, verify and deploy Órbita** ou faça push na branch `main`. Ative **Enforce HTTPS**. Depois de alterar variáveis é necessário um novo build/deploy.

O workflow executa validações de arquivos, autorização PostgreSQL e interface antes de publicar `dist/`. Pull requests executam checks sem publicar. Enquanto as variáveis estiverem ausentes, publica somente o frontend com o aviso de configuração pendente.

## Estrutura

```text
src/
  App.tsx                 navegação, sessão, layout
  components/             autenticação, chat, amigos, perfis, administração, voz
  hooks/                  consultas, Postgres Changes, Presence, Broadcast
  lib/                    cliente, tipos, uploads e faixa da soundboard
  styles.css              Tailwind + identidade Órbita e responsividade
supabase/
  config.toml
  migrations/             modelo, índices, grants, RLS, Storage, Realtime
  functions/livekit-token/ autenticação e token da sala de voz
scripts/test-db.mjs        cenários de segurança em PostgreSQL/PGlite
tests/                    interface e duas sessões reais Playwright
docs/                     segurança e aceitação em dispositivos distintos
.github/workflows/        build e publicação Pages
```

## Limites conhecidos

- O carregamento inicial de perfis está limitado a 1.000 registros, adequado a comunidades pequenas. Para crescer, use consultas por IDs visíveis e busca paginada do diretório.
- Presence representa o servidor atualmente aberto; status online em outros servidores não é uma lista global de conexões.
- Autorizações Realtime são verificadas na entrada/renovação de JWT. Links assinados continuam válidos por até 60 segundos. Tokens LiveKit expirados não expulsam participantes já conectados. O cliente verifica acesso de voz a cada 15 segundos; para expulsão resistente a clientes adulterados, um backend de moderação deve chamar `RoomServiceClient.removeParticipant` ao revogar acesso. Ver [segurança](docs/SEGURANCA.md).
- O app não faz varredura antivírus de arquivos, exclusão definitiva de contas, administração delegada, moderação automática ou recuperação visual de canais arquivados. Esses itens não devem ser presumidos como implementados.
- A mídia depende de microfone, permissões do sistema/navegador e conectividade com o SFU. Safari/mobile podem restringir compartilhamento de tela/áudio.

## Referências oficiais

[RLS Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security), [autorização Realtime](https://supabase.com/docs/guides/realtime/authorization), [Storage](https://supabase.com/docs/guides/storage/security/access-control), [tokens LiveKit](https://docs.livekit.io/frontends/reference/tokens-grants/), [publicação de mídia](https://docs.livekit.io/transport/media/publish/), [compartilhamento de tela](https://docs.livekit.io/transport/media/screenshare/) e [Vite no GitHub Pages](https://vite.dev/guide/static-deploy.html#github-pages).
