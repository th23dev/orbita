# Ativação do projeto Órbita

Projeto criado na organização **th23dev**, região **São Paulo (`sa-east-1`)**, com custo de criação informado pelo Supabase de **US$ 0/mês**.

- [Painel Supabase](https://supabase.com/dashboard/project/wjzirjfoaabpmyehzbtb)
- [Site](https://th23dev.github.io/orbita/)
- URL pública da API: `https://wjzirjfoaabpmyehzbtb.supabase.co`

## Aplicado

- Duas migrations versionadas; 16 tabelas, relacionamentos, índices, grants e RLS.
- Buckets privados `attachments`, `sounds` e `avatars`.
- 15 tabelas na publicação `supabase_realtime`.
- Função `livekit-token` publicada, com validação de sessão dentro do handler. LiveKit Cloud `orbita` conectado; `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` e `ALLOWED_ORIGINS` gravados e conferidos no Supabase.
- URL e chave publishable no `.env.local` ignorado pelo Git e nas variáveis públicas do GitHub Actions. Nenhuma chave administrativa no frontend.
- Security Advisor sem apontamentos de SQL/RLS; Auth aponta **proteção contra senhas vazadas desativada**. Confira a [configuração oficial de proteção de senhas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Performance Advisor sem os avisos de índice ausente ou políticas sobrepostas após a correção. As informações de índices ainda não usados são esperadas antes do tráfego: [explicação oficial](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).

## Configurações que ainda precisam ser aplicadas

O conector disponível permite criar projetos, aplicar SQL e publicar funções. A CLI local já foi autenticada e utilizada para configurar os segredos do LiveKit. Os ajustes de Auth/Realtime abaixo continuam pendentes; nenhuma configuração remota foi presumida a partir do arquivo local.

1. Em [Authentication → URL Configuration](https://supabase.com/dashboard/project/wjzirjfoaabpmyehzbtb/auth/url-configuration), defina Site URL como `https://th23dev.github.io/orbita/`. Em Redirect URLs, inclua essa mesma URL, `http://127.0.0.1:5173/` e `http://localhost:5173/`.
2. Configure SMTP para envio de confirmações e recuperação. Mantenha confirmação de e-mail habilitada. O provedor de envio padrão tem restrições; cadastro/envio para endereços arbitrários não foi validado.
3. Em [Realtime Settings](https://supabase.com/dashboard/project/wjzirjfoaabpmyehzbtb/realtime/settings), desative **Allow public access**. A aplicação usa tópicos privados protegidos por RLS.
4. Defina expiração de JWT de 900 segundos no painel de autenticação. Para sincronizar os valores declarados em `supabase/config.toml` pela CLI, autentique localmente e revise o diff:

   ```sh
   npx supabase login
   npx supabase config diff --project-ref wjzirjfoaabpmyehzbtb
   npx supabase config push --project-ref wjzirjfoaabpmyehzbtb
   ```

5. LiveKit já configurado em `wss://orbita-v7obpsup.livekit.cloud`. Consulte [LIVEKIT.md](LIVEKIT.md) para manutenção e validação. Os segredos nunca devem ser enviados ao chat, incluídos no Git ou ter prefixo `VITE_`.
6. Siga [TESTES.md](TESTES.md) com duas contas reais e um terceiro usuário não autorizado para validar microfones, tela e áudio nos dispositivos finais.

As migrations locais correspondem às versões registradas no projeto. Não execute manualmente a migration inicial novamente nesse banco.
