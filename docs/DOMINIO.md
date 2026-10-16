# Domínio orbita.undo.it

O site continuará hospedado no GitHub Pages, no repositório `th23dev/orbita`.
O FreeDNS fornece o subdomínio. Não é necessário mudar a hospedagem.

## Estado

Preparação local concluída; cadastro no FreeDNS e ativação remota pendentes.
O nome anterior, `orbita.mooo.com`, foi recusado como ocupado. O usuário escolheu
`orbita.undo.it`. Como o FreeDNS restringiu CNAME, a configuração usa registros A.
Não executar a ativação antes de o titular confirmar o cadastro do novo nome.
O endereço atual é `https://th23dev.github.io/orbita/`.
O workflow usa assets relativos para que o mesmo build funcione em `/orbita/`
e na raiz do domínio personalizado. Login e convites respeitam o endereço aberto.

## Cadastro pelo titular da conta FreeDNS

Abra [Subdomains no FreeDNS](https://freedns.afraid.org/subdomain/), entre na sua
conta e escolha adicionar um subdomínio. Selecione `undo.it` na lista de domínios.

| Campo | Valor |
| --- | --- |
| Type | `A` |
| Subdomain | `orbita` |
| Domain | `undo.it` |
| Destination | `185.199.108.153` |

Após salvar o primeiro, adicione outros três registros A com o mesmo nome,
um para cada destino: `185.199.109.153`, `185.199.110.153`, `185.199.111.153`.
O FreeDNS permite múltiplos registros A para o mesmo nome na mesma conta.
A ausência de DNS não garante disponibilidade: o FreeDNS confirma ao salvar.

## Ativação após confirmar o cadastro

1. Publicar o build com base relativa, verificando o endereço atual do Pages.
2. Adicionar `https://orbita.undo.it/` às URLs permitidas do Supabase Auth,
   preservando os redirecionamentos existentes. Na ativação, definir essa URL
   como `site_url`. Inspecionar `supabase config diff` antes de aplicar somente
   esses campos; não sobrescrever as demais configurações de autenticação.
3. Adicionar `https://orbita.undo.it` ao secret `ALLOWED_ORIGINS` da função
   `livekit-token`, preservando `https://th23dev.github.io`,
   `http://127.0.0.1:5173` e `http://localhost:5173`. Atualizar também o script
   `scripts/configure-livekit.mjs` para manter a origem em futuras configurações.
4. Executar `node scripts/github.mjs domain`. O comando confirma que os registros
   A apontam somente para IPs do GitHub Pages em dois resolvedores antes de
   configurar o domínio na API do Pages.
5. Consultar `node scripts/github.mjs domain-status` até o certificado estar
   aprovado; executar `node scripts/github.mjs domain-https` para exigir HTTPS.
6. Atualizar a URL de convite usada em desenvolvimento local em
   `src/lib/invitations.ts`, seu teste e o exemplo de link em `src/App.tsx`.
   Atualizar `supabase/config.toml` e a documentação para refletir a ativação.
7. Verificar HTTPS, carregamento dos assets, login, convites e autorização de
   chamadas pela nova origem. Publicar os ajustes finais.

Como a publicação usa GitHub Actions, o domínio deve ser configurado nas
configurações do Pages/API; um arquivo `CNAME` isolado não ativa o domínio.

Referências: [FreeDNS](https://freedns.afraid.org/),
[domínio personalizado no GitHub Pages](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site),
[URLs de redirecionamento do Supabase](https://supabase.com/docs/guides/auth/redirect-urls).
