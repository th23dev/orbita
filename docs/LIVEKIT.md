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

```powershell
node scripts/verify-livekit.mjs --live
```

O teste usa a CLI Supabase autenticada para obter credenciais administrativas somente em memória. Cria três contas confirmadas de teste sem enviar e-mail e um servidor temporário. Verifica emissão e escopo de tokens, bloqueio de não membros, canais de texto, origens desconhecidas, sessões inválidas e canais arquivados.

Depois conecta dois navegadores ao LiveKit real e transmite um tom por uma faixa de áudio independente do microfone. O receptor mede o sinal decodificado. Contas e servidor temporários são removidos ao terminar. Requer Edge no Windows ou Chromium do Playwright nos demais sistemas; consome uma pequena quantidade da franquia LiveKit.

Esse teste valida transporte de áudio e autenticação. A captura de microfone/tela, a interface da soundboard e a reprodução física em dispositivos diferentes continuam no [roteiro de aceitação](TESTES.md).
