# LiveKit da Órbita

O projeto LiveKit Cloud `orbita` está conectado ao Supabase `wjzirjfoaabpmyehzbtb`.

- URL pública de sinalização: `wss://orbita-v7obpsup.livekit.cloud`.
- Token emitido pela Edge Function `livekit-token`, após validar a sessão Supabase e o acesso ao canal por RLS.
- Token válido por cinco minutos para entrar na sala `orbita-<UUID do canal>`.
- Voz, tela e faixa independente da soundboard usam o mesmo servidor LiveKit.
- Segredos ficam nas Edge Functions: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` e `ALLOWED_ORIGINS`.
- Origens autorizadas: `https://th23dev.github.io`, `http://127.0.0.1:5173` e `http://localhost:5173`.

O campo Data region do painel LiveKit foi definido como United States para os dados de análise. Isso não altera a região São Paulo do banco Supabase.

## Reconfigurar ou trocar credenciais

As ferramentas locais foram autenticadas pelo navegador. O LiveKit CLI oficial está em `.tools/livekit/lk.exe` (versão 2.19.0, SHA256 conferido com a publicação oficial). A pasta `.tools/` é ignorada pelo Git.

```powershell
# Apenas se precisar autenticar novamente:
npx supabase login --agent no --output-format text
.\.tools\livekit\lk.exe cloud auth

# Importa o projeto autorizado e verifica os segredos gravados:
node scripts/configure-livekit.mjs orbita
```

Em outro computador, [instale a CLI oficial](https://docs.livekit.io/reference/developer-tools/livekit-cli/) e defina `LIVEKIT_CLI` com o caminho do executável. O script testa as credenciais no servidor, cria um arquivo temporário ignorado pelo Git, envia os valores ao Supabase, remove o arquivo e compara os hashes remotos. Nenhuma chave é impressa ou inserida nos argumentos do processo.

As chaves atuais foram emitidas pela autorização da CLI. Revogar essa autorização revoga também essas chaves: [documentação oficial](https://docs.livekit.io/reference/developer-tools/livekit-cli/projects/). Ao rotacionar, configure as novas chaves no Supabase antes de revogar as anteriores.

## Validação com serviços reais

### Qualidade de transmissão

A tela inicia em 1080p com alvo de 60 fps e limite de 8 Mbps para a camada principal.
O menu **Minha transmissão** permite selecionar 720p60 (4 Mbps), 720p30 (2,5 Mbps)
ou 480p30 (1 Mbps), inclusive antes de compartilhar. A mudança reutiliza a captura
e republica apenas o vídeo da tela; o áudio compartilhado, a câmera e o microfone
permanecem independentes. Se a publicação falhar, tenta restaurar a configuração anterior.

O menu **Assistir em** limita a resolução/fps recebidos sem alterar a transmissão
dos outros participantes. Essa preferência também vale para telas que começarem depois.
Simulcast, adaptive stream e dynacast continuam habilitados. O encoder prioriza
fluidez quando a conexão piora. Os 60 fps dependem da captura, do navegador,
do dispositivo e da rede; o menu representa o alvo, não uma medição.
As opções seguem a [API de publicação do LiveKit](https://docs.livekit.io/reference/client-sdk-js/interfaces/TrackPublishOptions.html).

Com o app local em `http://127.0.0.1:5173`, execute:

```powershell
node scripts/verify-stream.mjs --live
```

Esse teste usa duas contas temporárias e uma tela sintética animada, verifica o
encoder 1080p60 e os quadros recebidos pelo LiveKit real, reduz/restaura a qualidade,
confere que a permissão de captura não é solicitada novamente e testa a exclusão
do servidor pela API (dono permitido, membro bloqueado). Todos os dados temporários
são removidos. Não substitui testar a captura real em dispositivos diferentes.

### Autenticação e áudio

```powershell
node scripts/verify-livekit.mjs --live
```

O teste usa a CLI Supabase autenticada para obter credenciais administrativas somente em memória. Cria três contas confirmadas de teste sem enviar e-mail e um servidor temporário. Verifica emissão e escopo de tokens, bloqueio de não membros, canais de texto, origens desconhecidas, sessões inválidas e canais arquivados.

Depois conecta dois navegadores ao LiveKit real e transmite um tom por uma faixa de áudio independente do microfone. O receptor mede o sinal decodificado. Contas e servidor temporários são removidos ao terminar. Requer Edge no Windows ou Chromium do Playwright nos demais sistemas; consome uma pequena quantidade da franquia LiveKit.

Esse teste valida transporte de áudio e autenticação. A captura de microfone/tela, a interface da soundboard e a reprodução física em dispositivos diferentes continuam no [roteiro de aceitação](TESTES.md).
