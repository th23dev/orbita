# Voz e áudio

## Som de outros aplicativos ao ligar o microfone

Se jogos, músicas ou vídeos ficam mais baixos ao ativar o microfone, confira no
Windows **Som → Mais configurações de som → Comunicações → Não fazer nada**.
O Windows pode reduzir automaticamente o volume de sessões que não são de comunicação;
isso é independente do volume de saída do aplicativo. Consulte a
[documentação da Microsoft sobre atenuação de áudio](https://learn.microsoft.com/en-us/windows/win32/coreaudio/stream-attenuation).

Se houver distorção mesmo com essa opção desativada, compare o perfil **Estúdio**
(sem processamento de voz) com o perfil habitual e confira o dispositivo de entrada.
Esse teste ajuda a separar processamento do navegador de comportamento do driver;
não identifica sozinho a causa. Em dispositivos Bluetooth, usar o microfone também
pode alterar o modo de reprodução, conforme o suporte do dispositivo e do sistema.

Nas chamadas, silenciar o microfone agora encerra a captura do dispositivo, permitindo
que o sistema saia do modo de comunicação. Ao reativá-lo, o SDK readquire a entrada
e reinicia o processamento de voz. Não há alteração automática nas preferências do Windows.

## Configurações

Abra os menus de microfone e fone ao lado do perfil, ou **Configurações → Voz e áudio**. Na sala, clique no indicador de conexão no rodapé para abrir **Ajustes da chamada → Voz e áudio**. Esse painel também mostra o estado do tratamento de voz e as opções de qualidade da transmissão. As preferências ficam neste navegador e são aplicadas durante a chamada.

- Entrada: dispositivo, volume de 0 a 200% e teste com medidor do sinal tratado. **Ouvir minha voz** ativa a reprodução local; use fones. Fechar o painel ou parar o teste libera a captura. Trocar a entrada encerra o teste para que você o reinicie no novo dispositivo.
- Saída: dispositivo e volume de 0 a 100% das faixas recebidas na chamada, incluindo compartilhamento e soundboard remoto. O volume individual de cada participante continua sendo respeitado.
- **Foco na voz**: supressão neural RNNoise, cancelamento de eco e ganho automático do navegador.
- **Estúdio**: desliga filtros de voz, redução de ruído, eco e ganho automático; mantém o volume de entrada escolhido.
- **Personalizado**: supressão equilibrada, intensa ou desligada; sensibilidade automática ou limiar manual; controles de eco e ganho automático.

O teste é local e não grava nem envia áudio. O microfone da chamada é capturado e tratado separadamente; testar não altera o estado de mudo da chamada.

## Processamento

O `VoiceMicrophone` configura uma faixa LiveKit antes de publicá-la. O `VoiceProcessor` produz uma faixa mono de 48 kHz para o envio. Se o contexto do SDK tiver outra taxa, cria um contexto próprio de 48 kHz e o Web Audio reamostra a captura. O contexto do SDK nunca é encerrado pelo processador.

1. Captura com os controles de eco, ganho e supressão nativos escolhidos.
2. Filtro passa-altas de 75 Hz (equilibrada) ou 100 Hz (intensa).
3. RNNoise em WebAssembly/AudioWorklet, com quadros de 480 amostras. Atua também sobre ruído sobreposto à fala. A probabilidade de voz do modelo controla uma atenuação adicional nas pausas, com abertura de 3 ms, sustentação de 200 ms e fechamento de 150 ms.
4. Expansor suave para resíduos baixos, com sensibilidade automática ou limiar manual.
5. Compressor suave para conter picos, seguido do volume de entrada.

O modelo e os worklets são servidos com o aplicativo, sem CDN e sem envio do áudio para serviços de IA. A inicialização tem confirmação do worklet: o estado **Supressão neural ativa** só aparece depois que o WASM foi instanciado e o estado do modelo foi criado. O adaptador `rnnoise.ts` usa a API C do binário fixado em `@shiguredo/rnnoise-wasm@2022.2.0`; não depende de DOM ou de fetch dentro da thread de áudio. Licenças distribuídas em `public/licenses/`.

O modo desligado usa um caminho direto, preservando o volume. Mudanças usam transições suaves. O processamento atua somente no microfone local, sem filtrar soundboard ou compartilhamento de tela. Todos os participantes que usam este cliente podem tratar o próprio envio.

É uma implementação neural RNNoise, não o Krisp proprietário do Discord. A redução varia com o ambiente: ruído branco muito intenso sem fala e outras vozes podem continuar audíveis; vozes baixas podem ser atenuadas no modo intenso. A qualidade perceptiva precisa ser conferida com microfones e ambientes reais.

## Compatibilidade e recuperação

Use HTTPS ou localhost. A seleção de saída depende de `HTMLMediaElement.setSinkId`, das permissões e dos dispositivos expostos pelo navegador. Quando indisponível, o seletor é desabilitado e o painel orienta a usar a saída do sistema. **Permitir acesso e atualizar dispositivos** solicita a permissão para revelar nomes, liberando a captura logo depois.

Se o download do modelo, a inicialização ou o AudioWorklet falhar, um caminho direto mantém o áudio e o volume; o processamento nativo disponível continua funcionando. O painel informa a indisponibilidade do filtro neural. A saída padrão é usada quando a seleção falha. Durante a chamada, desconectar um dispositivo restaura a seleção padrão e mostra um aviso. Trocas e ajustes não devem desmutar o microfone. Reconexões recriam a faixa com as preferências atuais. Os menus rápidos e o painel completo compartilham a lista de dispositivos e a atualizam ao abrir, autorizar ou conectar um dispositivo.

## Validação

`npm test` verifica redução de sinais fracos, preservação de sinais de voz sintéticos e finais de palavras, bypass, limiar manual, persistência validada, publicação após processamento, captura tardia cancelada, falha de publicação e troca de dispositivo sem desmutar.

`npm run test:e2e -- tests/audio.spec.ts tests/community.spec.ts tests/stream.spec.ts --workers=2` verifica o modelo real no Chromium, volume zero, bypass, reinicialização, fallback, liberação de recursos e os controles em desktop e viewport móvel. Uma conexão WebRTC local mede ruído de ventilador no áudio recebido. Outra medição compara o espectro de fala sintetizada com ruído branco antes/depois do filtro, somente durante trechos falados, com compensação de atraso e ganho. Os resultados são anexados ao relatório Playwright. Não substituem uma chamada entre dispositivos físicos e avaliação por escuta.

## Transmissão e celular

O botão **Tela cheia da transmissão** usa a Fullscreen API no player do vídeo; barras do aplicativo e participantes ficam fora da tela cheia. Há saída pelo botão ou Escape, e suporte ao player nativo do Safari móvel quando disponível. Falhas do navegador são informadas, sem simular tela cheia com CSS.

No celular, os painéis de áudio ocupam a largura disponível, respeitam a área segura, permitem rolagem e têm controles de toque maiores. Há testes em 320 px e após rotação.

Referências: [RNNoise WASM](https://github.com/shiguredo/rnnoise-wasm), [processadores de áudio LiveKit](https://github.com/livekit/track-processors-js/blob/main/processor-docs/audio-processors.md), [captura LiveKit](https://docs.livekit.io/reference/client-sdk-js/interfaces/AudioCaptureOptions.html), [seleção de saída](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/setSinkId).
